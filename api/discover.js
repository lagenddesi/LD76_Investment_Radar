"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY v4
 *
 * PRIMARY:
 *   Smet Newly Registered Domains JSON feed
 *
 * SECONDARY:
 *   crt.sh Certificate Transparency
 *
 * FINAL AUTHORITY:
 *   RDAP registration event
 *
 * IMPORTANT:
 *   CT first-seen date is NEVER treated as registration date.
 *
 * A domain is returned only when:
 *
 *   1. It was discovered from a supported source
 *   2. Its TLD matches
 *   3. Its name passes the lightweight relevance filter
 *   4. RDAP returns a registration event
 *   5. RDAP registration date is inside 24H / 48H
 *
 * Every failure is returned as structured JSON.
 */


/* =========================================================
 * CONFIG
 * ========================================================= */

const SMET_TIMEOUT_MS = 12000;
const CRT_TIMEOUT_MS = 12000;
const RDAP_TIMEOUT_MS = 3500;

const SMET_RETRIES = 1;
const CRT_RETRIES = 1;
const RDAP_RETRIES = 1;

/*
 * Keep enough concurrency to finish inside Vercel's
 * serverless execution window without hammering RDAP.
 */
const RDAP_CONCURRENCY = 20;

/*
 * Stop doing new RDAP requests before Vercel's timeout.
 * Already-running requests are allowed to finish.
 */
const DISCOVERY_BUDGET_MS = 70000;

const FUTURE_TOLERANCE_MS =
  5 * 60 * 1000;


/* =========================================================
 * SAFE JSON RESPONSE
 * ========================================================= */

function sendJson(
  res,
  status,
  payload
) {
  try {
    res.status(status);

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.json(payload);

  } catch (error) {
    /*
     * Last-resort fallback.
     *
     * This prevents Vercel from returning an HTML error page
     * that the frontend cannot parse as JSON.
     */

    try {
      return res
        .status(500)
        .end(
          JSON.stringify({
            ok: false,

            stage:
              "response",

            error:
              "Failed to serialize discovery response",

            details:
              error?.message ||
              "Unknown response error"
          })
        );

    } catch {
      return res.end();
    }
  }
}


/* =========================================================
 * ERROR HELPERS
 * ========================================================= */

function errorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  return (
    error.message ||
    String(error)
  );
}


function errorDetails(
  error,
  extra = {}
) {
  return {
    message:
      errorMessage(error),

    name:
      error?.name ||
      "Error",

    ...extra
  };
}


/* =========================================================
 * NORMALIZATION
 * ========================================================= */

function normalizeTld(value) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  let tld =
    value
      .trim()
      .toLowerCase();

  if (!tld) {
    return null;
  }

  if (
    !tld.startsWith(".")
  ) {
    tld =
      "." + tld;
  }

  if (
    !/^\.[a-z0-9-]{2,63}$/.test(
      tld
    )
  ) {
    return null;
  }

  return tld;
}


function normalizePeriod(body) {
  if (
    body?.periodHours !==
    undefined
  ) {
    const hours =
      Number(
        body.periodHours
      );

    if (
      hours === 24 ||
      hours === 48
    ) {
      return hours;
    }
  }

  const period =
    String(
      body?.period ||
      "24h"
    )
      .trim()
      .toLowerCase();

  if (
    period === "48h" ||
    period === "48"
  ) {
    return 48;
  }

  return 24;
}


function normalizeDomain(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  let domain =
    value
      .trim()
      .toLowerCase();

  domain =
    domain.replace(
      /^\*\.\s*/,
      ""
    );

  domain =
    domain.replace(
      /^https?:\/\//,
      ""
    );

  domain =
    domain
      .split("/")[0]
      .split("?")[0]
      .split("#")[0]
      .replace(/\.$/, "");

  if (!domain) {
    return null;
  }

  if (
    domain.length > 253 ||
    /\s|\\/.test(domain)
  ) {
    return null;
  }

  const valid =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  if (
    !valid.test(domain)
  ) {
    return null;
  }

  return domain;
}


/* =========================================================
 * TIME
 * ========================================================= */

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


function dateKeyUTC(
  date
) {
  return date
    .toISOString()
    .slice(0, 10);
}


function addDaysUTC(
  date,
  days
) {
  const copy =
    new Date(
      date.getTime()
    );

  copy.setUTCDate(
    copy.getUTCDate() +
    days
  );

  return copy;
}


/* =========================================================
 * HTTP FETCH
 * ========================================================= */

async function fetchRaw(
  url,
  timeoutMs,
  headers = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json,text/plain,*/*",

            "User-Agent":
              "LD76-Investment-Radar/4.0",

            ...headers
          },

          signal:
            controller.signal
        }
      );

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    const text =
      await response.text();

    return {
      ok:
        response.ok,

      status:
        response.status,

      statusText:
        response.statusText,

      contentType,

      text,

      url
    };

  } catch (error) {
    throw Object.assign(
      new Error(
        error?.name ===
        "AbortError"
          ? `Request timeout after ${timeoutMs}ms`
          : errorMessage(error)
      ),
      {
        originalName:
          error?.name
      }
    );

  } finally {
    clearTimeout(timer);
  }
}


async function fetchWithRetry(
  url,
  timeoutMs,
  retries,
  headers = {}
) {
  let last = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const response =
        await fetchRaw(
          url,
          timeoutMs,
          headers
        );

      if (
        !response.ok
      ) {
        const error =
          new Error(
            `HTTP ${response.status}`
          );

        return {
          ok: false,

          status:
            response.status,

          statusText:
            response.statusText,

          contentType:
            response.contentType,

          bodyPreview:
            response.text
              ?.slice(
                0,
                500
              ),

          url,

          attempts:
            attempt + 1,

          error:
            error.message
        };
      }

      return {
        ok: true,

        status:
          response.status,

        statusText:
          response.statusText,

        contentType:
          response.contentType,

        text:
          response.text,

        url,

        attempts:
          attempt + 1,

        error: null
      };

    } catch (error) {
      last =
        errorMessage(error);

      if (
        attempt <
        retries
      ) {
        await sleep(
          500 *
          (attempt + 1)
        );
      }
    }
  }

  return {
    ok: false,

    status: null,

    statusText: null,

    contentType: null,

    bodyPreview: null,

    url,

    attempts:
      retries + 1,

    error:
      last ||
      "Request failed"
  };
}


/* =========================================================
 * JSON HTTP
 * ========================================================= */

async function fetchJson(
  url,
  timeoutMs,
  retries
) {
  const result =
    await fetchWithRetry(
      url,
      timeoutMs,
      retries,
      {
        Accept:
          "application/json"
      }
    );

  if (!result.ok) {
    return {
      ...result,

      data: null,

      parseError: null
    };
  }

  let data;

  try {
    data =
      JSON.parse(
        result.text
      );

  } catch (error) {
    return {
      ...result,

      ok: false,

      data: null,

      parseError:
        errorMessage(error),

      error:
        "Server returned non-JSON data"
    };
  }

  return {
    ...result,

    ok: true,

    data,

    parseError: null
  };
}


/* =========================================================
 * SMET
 * ========================================================= */

function buildSmetJsonUrl(
  date
) {
  return (
    "https://smet.cz/nrd/data/daily/" +
    date +
    ".json"
  );
}


async function fetchSmetDay(
  date
) {
  const url =
    buildSmetJsonUrl(
      date
    );

  const result =
    await fetchJson(
      url,
      SMET_TIMEOUT_MS,
      SMET_RETRIES
    );

  if (!result.ok) {
    return {
      ok: false,

      date,

      url,

      domains: [],

      count: 0,

      error:
        result.error ||
        "Smet request failed",

      diagnostic: {
        status:
          result.status,

        statusText:
          result.statusText,

        contentType:
          result.contentType,

        bodyPreview:
          result.bodyPreview,

        parseError:
          result.parseError,

        attempts:
          result.attempts,

        url
      }
    };
  }

  /*
   * Expected Smet shape:
   *
   * {
   *   date,
   *   count,
   *   generated_at,
   *   domains: [...]
   * }
   */

  const rawDomains =
    Array.isArray(
      result.data?.domains
    )
      ? result.data.domains
      : Array.isArray(
          result.data
        )
        ? result.data
        : null;

  if (!rawDomains) {
    return {
      ok: false,

      date,

      url,

      domains: [],

      count: 0,

      error:
        "Smet JSON does not contain a domains array",

      diagnostic: {
        status:
          result.status,

        contentType:
          result.contentType,

        keys:
          result.data &&
          typeof result.data ===
            "object"
            ? Object.keys(
                result.data
              )
            : [],

        url
      }
    };
  }

  const domains =
    rawDomains
      .map(
        value =>
          normalizeDomain(
            value
          )
      )
      .filter(Boolean);

  return {
    ok: true,

    date,

    url,

    domains,

    count:
      domains.length,

    generatedAt:
      result.data?.generated_at ||
      null,

    error: null,

    diagnostic: {
      status:
        result.status,

      contentType:
        result.contentType,

      rawCount:
        rawDomains.length,

      normalizedCount:
        domains.length,

      url
    }
  };
}


/* =========================================================
 * INVESTMENT NAME PREFILTER
 * ========================================================= */

const INVESTMENT_NAME_PATTERNS = [
  "invest",
  "investment",
  "investments",

  "profit",
  "profits",

  "earning",
  "earnings",
  "earn",

  "income",

  "roi",
  "return",
  "returns",

  "wealth",
  "capital",

  "finance",
  "financial",
  "fintech",

  "fund",
  "funds",
  "funding",

  "trading",
  "trade",
  "trader",

  "forex",
  "fx",

  "crypto",
  "cryptocurrency",

  "bitcoin",
  "btc",

  "ethereum",
  "eth",

  "usdt",

  "mining",
  "miner",

  "stake",
  "staking",

  "yield",

  "passive",

  "cash",
  "money",

  "pay",
  "payment",

  "deposit",
  "withdraw",
  "withdrawal",

  "wallet",

  "bonus",
  "referral",
  "affiliate",

  "bank",

  "loan",
  "loans",

  "asset",
  "assets"
];


function investmentNameMatch(
  domain
) {
  const labels =
    domain
      .split(".")
      .slice(
        0,
        -1
      )
      .join(".")
      .replace(
        /[-_]/g,
        ""
      )
      .toLowerCase();

  return INVESTMENT_NAME_PATTERNS.some(
    keyword =>
      labels.includes(
        keyword
          .replace(
            /[-_]/g,
            ""
          )
      )
  );
}


/* =========================================================
 * SMET DISCOVERY
 * ========================================================= */

async function discoverFromSmet(
  tld,
  periodHours
) {
  const now =
    new Date();

  const dates = [
    dateKeyUTC(now),

    dateKeyUTC(
      addDaysUTC(
        now,
        -1
      )
    )
  ];

  /*
   * For 48H include the day before yesterday.
   */

  if (
    periodHours === 48
  ) {
    dates.push(
      dateKeyUTC(
        addDaysUTC(
          now,
          -2
        )
      )
    );
  }

  const sourceResults = [];

  /*
   * Fetch the days in parallel.
   */

  const results =
    await Promise.all(
      dates.map(
        date =>
          fetchSmetDay(
            date
          )
      )
    );

  sourceResults.push(
    ...results
  );

  const successful =
    results.filter(
      item =>
        item.ok
    );

  if (
    successful.length === 0
  ) {
    return {
      ok: false,

      candidates: [],

      sourceResults,

      error:
        "Smet newly-registered feed failed for every requested day"
    };
  }

  const map =
    new Map();

  let totalFeedDomains = 0;
  let tldMatches = 0;
  let nameMatches = 0;

  for (
    const source
    of successful
  ) {
    for (
      const domain
      of source.domains
    ) {
      totalFeedDomains++;

      if (
        !domain.endsWith(tld)
      ) {
        continue;
      }

      tldMatches++;

      /*
       * Lightweight filter.
       *
       * This is NOT the final scam/investment filter.
       */

      if (
        !investmentNameMatch(
          domain
        )
      ) {
        continue;
      }

      nameMatches++;

      if (
        !map.has(domain)
      ) {
        map.set(
          domain,
          {
            domain,

            discoveredAt:
              new Date()
                .toISOString(),

            discoveryEvidence:
              "smet-newly-registered-feed",

            discoverySource:
              source.url,

            feedDate:
              source.date
          }
        );
      }
    }
  }

  return {
    ok: true,

    candidates:
      [...map.values()],

    sourceResults,

    statistics: {
      requestedDays:
        dates.length,

      successfulDays:
        successful.length,

      totalFeedDomains,

      tldMatches,

      nameMatches,

      uniqueCandidates:
        map.size
    },

    error: null
  };
}


/* =========================================================
 * CRT.SH
 * ========================================================= */

function buildCrtUrl(
  tld
) {
  /*
   * crt.sh wildcard query.
   */

  const query =
    `%${tld}`;

  return (
    "https://crt.sh/?q=" +
    encodeURIComponent(
      query
    ) +
    "&output=json"
  );
}


async function queryCrtSh(
  tld
) {
  const url =
    buildCrtUrl(
      tld
    );

  const result =
    await fetchJson(
      url,
      CRT_TIMEOUT_MS,
      CRT_RETRIES
    );

  if (!result.ok) {
    return {
      ok: false,

      rows: [],

      url,

      error:
        result.error ||
        "crt.sh request failed",

      diagnostic: {
        status:
          result.status,

        statusText:
          result.statusText,

        contentType:
          result.contentType,

        bodyPreview:
          result.bodyPreview,

        parseError:
          result.parseError,

        attempts:
          result.attempts,

        url
      }
    };
  }

  if (
    !Array.isArray(
      result.data
    )
  ) {
    return {
      ok: false,

      rows: [],

      url,

      error:
        "crt.sh response is not an array",

      diagnostic: {
        status:
          result.status,

        contentType:
          result.contentType,

        type:
          typeof result.data,

        url
      }
    };
  }

  return {
    ok: true,

    rows:
      result.data,

    url,

    error: null,

    diagnostic: {
      status:
        result.status,

      contentType:
        result.contentType,

      rows:
        result.data.length,

      url
    }
  };
}


function getCtDate(
  row
) {
  const values = [
    row?.entry_timestamp,
    row?.min_entry_timestamp,
    row?.entry_time,
    row?.not_before,
    row?.precert_first_seen,
    row?.final_first_seen
  ];

  for (
    const value
    of values
  ) {
    if (!value) {
      continue;
    }

    const date =
      new Date(value);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date;
    }
  }

  return null;
}


function getCtNames(
  row
) {
  const names = [];

  if (
    typeof row?.name_value ===
    "string"
  ) {
    names.push(
      ...row.name_value.split(
        /\r?\n/
      )
    );
  }

  if (
    typeof row?.common_name ===
    "string"
  ) {
    names.push(
      row.common_name
    );
  }

  if (
    typeof row?.subject_cn ===
    "string"
  ) {
    names.push(
      row.subject_cn
    );
  }

  return names;
}


function collectCtCandidates(
  rows,
  tld,
  cutoff
) {
  const map =
    new Map();

  for (
    const row
    of rows
  ) {
    const date =
      getCtDate(row);

    if (!date) {
      continue;
    }

    if (
      date.getTime() <
      cutoff
    ) {
      continue;
    }

    const names =
      getCtNames(row);

    for (
      const rawName
      of names
    ) {
      const domain =
        normalizeDomain(
          rawName
        );

      if (!domain) {
        continue;
      }

      if (
        !domain.endsWith(tld)
      ) {
        continue;
      }

      if (
        !investmentNameMatch(
          domain
        )
      ) {
        continue;
      }

      if (
        !map.has(domain)
      ) {
        map.set(
          domain,
          {
            domain,

            discoveredAt:
              date.toISOString(),

            discoveryEvidence:
              "certificate-transparency",

            discoverySource:
              "crt.sh"
          }
        );
      }
    }
  }

  return [
    ...map.values()
  ];
}


/* =========================================================
 * RDAP
 * ========================================================= */

function extractRegistrationDate(
  rdap
) {
  const events =
    Array.isArray(
      rdap?.events
    )
      ? rdap.events
      : [];

  const registration =
    events.find(
      event =>
        String(
          event?.eventAction ||
          ""
        )
          .trim()
          .toLowerCase() ===
        "registration"
    );

  if (
    !registration?.eventDate
  ) {
    return null;
  }

  const date =
    new Date(
      registration.eventDate
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}


async function verifyRegistration(
  domain,
  cutoff,
  scanDeadline
) {
  /*
   * Don't start a new request if the overall scan is
   * already approaching the Vercel execution limit.
   */

  if (
    Date.now() >=
    scanDeadline
  ) {
    return {
      domain,

      verified: false,

      inWindow: false,

      registeredAt: null,

      error:
        "RDAP verification skipped because discovery time budget was reached",

      reason:
        "SCAN_TIME_BUDGET"
    };
  }

  const url =
    "https://rdap.org/domain/" +
    encodeURIComponent(
      domain
    );

  const result =
    await fetchJson(
      url,
      RDAP_TIMEOUT_MS,
      RDAP_RETRIES
    );

  if (!result.ok) {
    return {
      domain,

      verified: false,

      inWindow: false,

      registeredAt: null,

      error:
        result.error ||
        "RDAP request failed",

      reason:
        result.status
          ? `HTTP_${result.status}`
          : "RDAP_REQUEST_ERROR",

      diagnostic: {
        status:
          result.status,

        statusText:
          result.statusText,

        contentType:
          result.contentType,

        bodyPreview:
          result.bodyPreview,

        parseError:
          result.parseError,

        attempts:
          result.attempts,

        url
      }
    };
  }

  const registeredAt =
    extractRegistrationDate(
      result.data
    );

  if (!registeredAt) {
    return {
      domain,

      verified: false,

      inWindow: false,

      registeredAt: null,

      error:
        "RDAP registration event not found",

      reason:
        "REGISTRATION_EVENT_MISSING",

      diagnostic: {
        status:
          result.status,

        contentType:
          result.contentType,

        url
      }
    };
  }

  const registrationTime =
    registeredAt.getTime();

  const now =
    Date.now();

  const inWindow =
    registrationTime >=
      cutoff &&
    registrationTime <=
      now +
        FUTURE_TOLERANCE_MS;

  return {
    domain,

    verified: true,

    inWindow,

    registeredAt:
      registeredAt.toISOString(),

    error:
      inWindow
        ? null
        : "Registration date outside selected period",

    reason:
      inWindow
        ? "REGISTRATION_CONFIRMED"
        : "OUTSIDE_SELECTED_PERIOD",

    diagnostic: {
      status:
        result.status,

      contentType:
        result.contentType,

      url
    }
  };
}


/* =========================================================
 * CONCURRENT RDAP
 * ========================================================= */

async function verifyCandidates(
  candidates,
  cutoff,
  scanDeadline
) {
  const results =
    new Array(
      candidates.length
    );

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        candidates.length
      ) {
        return;
      }

      results[index] =
        await verifyRegistration(
          candidates[index].domain,
          cutoff,
          scanDeadline
        );
    }
  }

  const workerCount =
    Math.min(
      RDAP_CONCURRENCY,
      candidates.length
    );

  if (
    workerCount === 0
  ) {
    return [];
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      worker
    )
  );

  return results;
}


/* =========================================================
 * MAIN HANDLER
 * ========================================================= */

export default async function handler(
  req,
  res
) {
  const requestStarted =
    Date.now();

  /*
   * Always return JSON, even for bad methods.
   */

  if (
    req.method !==
    "POST"
  ) {
    return sendJson(
      res,
      405,
      {
        ok: false,

        stage:
          "request",

        error:
          "Method not allowed. Use POST.",

        diagnostic: {
          method:
            req.method
        }
      }
    );
  }

  try {
    const body =
      req.body || {};

    const tld =
      normalizeTld(
        body.tld ||
        body.tldValue
      );

    const periodHours =
      normalizePeriod(
        body
      );

    if (!tld) {
      return sendJson(
        res,
        400,
        {
          ok: false,

          stage:
            "validation",

          error:
            "Invalid TLD",

          diagnostic: {
            receivedTld:
              body.tld ||
              body.tldValue ||
              null
          }
        }
      );
    }

    const now =
      Date.now();

    const cutoff =
      now -
      periodHours *
      60 *
      60 *
      1000;

    /*
     * Stop discovery/RDAP before Vercel can produce
     * its own non-JSON 504 page.
     */

    const scanDeadline =
      requestStarted +
      DISCOVERY_BUDGET_MS;


    /* =====================================================
     * SMET PRIMARY
     * ===================================================== */

    const smet =
      await discoverFromSmet(
        tld,
        periodHours
      );


    /* =====================================================
     * CRT SECONDARY
     *
     * CRT failure is NEVER fatal when Smet works.
     * ===================================================== */

    const crt =
      await queryCrtSh(
        tld
      );

    const ctCandidates =
      crt.ok
        ? collectCtCandidates(
            crt.rows,
            tld,
            cutoff
          )
        : [];


    /* =====================================================
     * MERGE
     * ===================================================== */

    const merged =
      new Map();

    if (smet.ok) {
      for (
        const candidate
        of smet.candidates
      ) {
        merged.set(
          candidate.domain,
          {
            ...candidate
          }
        );
      }
    }

    for (
      const candidate
      of ctCandidates
    ) {
      const existing =
        merged.get(
          candidate.domain
        );

      if (!existing) {
        merged.set(
          candidate.domain,
          {
            ...candidate
          }
        );

      } else {
        existing.discoveryEvidence =
          existing.discoveryEvidence +
          "+certificate-transparency";
      }
    }

    const discoveryCandidates =
      [
        ...merged.values()
      ];


    /* =====================================================
     * BOTH SOURCES FAILED
     * ===================================================== */

    if (
      !smet.ok &&
      !crt.ok
    ) {
      return sendJson(
        res,
        502,
        {
          ok: false,

          stage:
            "discovery",

          error:
            "All discovery sources failed",

          diagnostic: {
            elapsedMs:
              Date.now() -
              requestStarted,

            tld,

            periodHours,

            sources: {
              smet: {
                ok: false,

                error:
                  smet.error,

                days:
                  smet.sourceResults
                    .map(
                      item => ({
                        date:
                          item.date,

                        url:
                          item.url,

                        error:
                          item.error,

                        diagnostic:
                          item.diagnostic
                      })
                    )
              },

              crtSh: {
                ok: false,

                error:
                  crt.error,

                url:
                  crt.url,

                diagnostic:
                  crt.diagnostic
              }
            }
          }
        }
      );
    }


    /* =====================================================
     * NO DISCOVERY CANDIDATES
     *
     * This is NOT an error.
     * ===================================================== */

    if (
      discoveryCandidates.length ===
      0
    ) {
      return sendJson(
        res,
        200,
        {
          ok: true,

          stage:
            "discovery",

          tld,

          periodHours,

          cutoff:
            new Date(
              cutoff
            ).toISOString(),

          discovered: 0,

          registrationVerified:
            0,

          registrationRejected:
            0,

          verificationFailed:
            0,

          candidates: [],

          sources: {
            smet: {
              ok:
                smet.ok,

              error:
                smet.error,

              statistics:
                smet.statistics ||
                null,

              days:
                smet.sourceResults
                  .map(
                    item => ({
                      date:
                        item.date,

                      ok:
                        item.ok,

                      count:
                        item.count,

                      error:
                        item.error
                    })
                  )
            },

            crtSh: {
              ok:
                crt.ok,

              error:
                crt.error,

              candidates:
                ctCandidates.length,

              diagnostic:
                crt.diagnostic
            }
          },

          statistics: {
            smetCandidates:
              smet.candidates
                ?.length ||
              0,

            ctCandidates:
              ctCandidates.length,

            mergedCandidates:
              0
          },

          elapsedMs:
            Date.now() -
            requestStarted
        }
      );
    }


    /* =====================================================
     * RDAP
     * ===================================================== */

    const rdapResults =
      await verifyCandidates(
        discoveryCandidates,
        cutoff,
        scanDeadline
      );


    const verified =
      rdapResults.filter(
        item =>
          item?.verified ===
          true
      );

    const finalCandidates =
      rdapResults.filter(
        item =>
          item?.verified ===
            true &&
          item?.inWindow ===
            true
      );

    const outsideWindow =
      rdapResults.filter(
        item =>
          item?.verified ===
            true &&
          item?.inWindow ===
            false
      );

    const failed =
      rdapResults.filter(
        item =>
          item?.verified !==
          true
      );


    /* =====================================================
     * RETURN
     * ===================================================== */

    return sendJson(
      res,
      200,
      {
        ok: true,

        stage:
          "discovery",

        tld,

        periodHours,

        cutoff:
          new Date(
            cutoff
          ).toISOString(),

        discovered:
          discoveryCandidates.length,

        registrationVerified:
          finalCandidates.length,

        registrationRejected:
          outsideWindow.length,

        verificationFailed:
          failed.length,

        candidates:
          finalCandidates.map(
            item => ({
              domain:
                item.domain,

              discoveredAt:
                discoveryCandidates.find(
                  candidate =>
                    candidate.domain ===
                    item.domain
                )?.discoveredAt ||
                null,

              registeredAt:
                item.registeredAt,

              registrationVerified:
                true,

              registrationInWindow:
                true,

              discoveryEvidence:
                discoveryCandidates.find(
                  candidate =>
                    candidate.domain ===
                    item.domain
                )?.discoveryEvidence ||
                null,

              discoverySource:
                discoveryCandidates.find(
                  candidate =>
                    candidate.domain ===
                    item.domain
                )?.discoverySource ||
                null
            })
          ),

        sources: {
          smet: {
            ok:
              smet.ok,

            error:
              smet.error,

            statistics:
              smet.statistics ||
              null,

            days:
              smet.sourceResults
                .map(
                  item => ({
                    date:
                      item.date,

                    ok:
                      item.ok,

                    count:
                      item.count,

                    error:
                      item.error,

                    diagnostic:
                      item.ok
                        ? undefined
                        : item.diagnostic
                  })
                )
          },

          crtSh: {
            ok:
              crt.ok,

            error:
              crt.error,

            candidates:
              ctCandidates.length,

            diagnostic:
              crt.diagnostic
          },

          rdap: {
            source:
              "rdap.org",

            required:
              true,

            concurrency:
              RDAP_CONCURRENCY
          }
        },

        diagnostics: {
          discoveryCandidates:
            discoveryCandidates.length,

          rdapVerified:
            verified.length,

          registrationConfirmed:
            finalCandidates.length,

          outsideSelectedPeriod:
            outsideWindow.length,

          rdapFailed:
            failed.length,

          timeBudgetMs:
            DISCOVERY_BUDGET_MS,

          elapsedMs:
            Date.now() -
            requestStarted,

          remainingBudgetMs:
            Math.max(
              0,
              scanDeadline -
                Date.now()
            ),

          rdapFailures:
            failed
              .slice(0, 50)
              .map(
                item => ({
                  domain:
                    item.domain,

                  reason:
                    item.reason,

                  error:
                    item.error,

                  diagnostic:
                    item.diagnostic ||
                    null
                })
              )
        }
      }
    );

  } catch (error) {
    /*
     * CRITICAL:
     * Never allow an exception to become a Vercel HTML
     * error page. Always return structured JSON.
     */

    console.error(
      "LD76 DISCOVERY FATAL ERROR",
      error
    );

    return sendJson(
      res,
      500,
      {
        ok: false,

        stage:
          "discovery",

        error:
          errorMessage(error),

        diagnostic: {
          errorName:
            error?.name ||
            "Error",

          elapsedMs:
            Date.now() -
            requestStarted,

          stack:
            process.env.NODE_ENV !==
            "production"
              ? error?.stack ||
                null
              : null
        }
      }
    );
  }
  }
