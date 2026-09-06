"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY v3
 *
 * PRIMARY DISCOVERY:
 *   Smet.cz Newly Registered Domain Feed
 *
 * OPTIONAL FALLBACK:
 *   Certificate Transparency sources
 *
 * IMPORTANT:
 *   Feed visibility is NOT treated as the final registration date.
 *
 * FINAL HARD GATE:
 *   RDAP registration event MUST exist
 *   AND MUST be inside the selected 24H / 48H window.
 *
 * This prevents:
 *   - CT outage from killing discovery
 *   - certificate date being mistaken for registration date
 *   - old domains being treated as newly registered
 *
 * No arbitrary 4/5 domain limit.
 */

const MAX_FEED_DOMAINS = 1000000;

const FEED_TIMEOUT_MS = 20000;
const CT_TIMEOUT_MS = 15000;
const RDAP_TIMEOUT_MS = 5000;

const FEED_RETRIES = 2;
const CT_RETRIES = 1;
const RDAP_RETRIES = 1;

const RDAP_CONCURRENCY = 8;

const FUTURE_TOLERANCE_MS =
  5 * 60 * 1000;


/* =========================================================
 * NORMALIZATION
 * ========================================================= */

function normalizeTld(value) {
  if (typeof value !== "string") {
    return null;
  }

  let tld =
    value
      .trim()
      .toLowerCase();

  if (!tld) {
    return null;
  }

  if (!tld.startsWith(".")) {
    tld = "." + tld;
  }

  if (!/^\.[a-z0-9-]{2,24}$/.test(tld)) {
    return null;
  }

  return tld;
}


function normalizePeriod(body) {
  if (body?.periodHours !== undefined) {
    const hours =
      Number(body.periodHours);

    if (
      hours === 24 ||
      hours === 48
    ) {
      return hours;
    }
  }

  const period =
    String(
      body?.period || "24h"
    )
      .trim()
      .toLowerCase();

  return period === "48h"
    ? 48
    : 24;
}


function normalizeDomain(value) {
  if (typeof value !== "string") {
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

  if (!valid.test(domain)) {
    return null;
  }

  return domain;
}


/* =========================================================
 * TIME HELPERS
 * ========================================================= */

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


function dateKeyUTC(date) {
  return (
    date
      .toISOString()
      .slice(0, 10)
  );
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
    copy.getUTCDate() + days
  );

  return copy;
}


/* =========================================================
 * HTTP
 * ========================================================= */

async function fetchText(
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
          method: "GET",

          headers: {
            Accept:
              "application/json,text/plain,*/*",

            "User-Agent":
              "LD76-Investment-Radar/3.0",

            ...headers
          },

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    if (!text.trim()) {
      throw new Error(
        "Empty response"
      );
    }

    return text;

  } finally {
    clearTimeout(timer);
  }
}


async function fetchJsonWithRetry(
  url,
  timeoutMs,
  retries,
  headers = {}
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const text =
        await fetchText(
          url,
          timeoutMs,
          headers
        );

      let data;

      try {
        data =
          JSON.parse(text);
      } catch {
        throw new Error(
          "Invalid JSON response"
        );
      }

      return {
        ok: true,
        data,
        attempts:
          attempt + 1,
        error: null
      };

    } catch (error) {
      lastError =
        error?.message ||
        "Unknown request error";

      if (
        attempt < retries
      ) {
        await sleep(
          attempt === 0
            ? 700
            : 1600
        );
      }
    }
  }

  return {
    ok: false,
    data: null,
    attempts:
      retries + 1,
    error:
      lastError
  };
}


/* =========================================================
 * SMET NEWLY REGISTERED FEED
 * ========================================================= */

/*
 * Smet provides:
 *
 * /nrd/data/today.txt
 * /nrd/data/daily/YYYY-MM-DD.txt
 *
 * We use the daily files because:
 *
 * 24H:
 *   today + yesterday
 *
 * 48H:
 *   today + yesterday + day-before
 *
 * RDAP remains the final registration-date authority.
 */

function buildSmetDailyUrl(
  date
) {
  return (
    "https://smet.cz/nrd/data/daily/" +
    date +
    ".txt"
  );
}


async function fetchSmetDaily(
  date
) {
  const url =
    buildSmetDailyUrl(
      date
    );

  const result =
    await fetchTextWithRetry(
      url,
      FEED_TIMEOUT_MS,
      FEED_RETRIES
    );

  if (!result.ok) {
    return {
      ok: false,
      date,
      url,
      domains: [],
      error:
        result.error
    };
  }

  const domains =
    result.text
      .split(/\r?\n/)
      .map(
        value =>
          normalizeDomain(value)
      )
      .filter(Boolean);

  return {
    ok: true,
    date,
    url,
    domains,
    error: null
  };
}


async function fetchTextWithRetry(
  url,
  timeoutMs,
  retries
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const text =
        await fetchText(
          url,
          timeoutMs
        );

      return {
        ok: true,
        text,
        attempts:
          attempt + 1,
        error: null
      };

    } catch (error) {
      lastError =
        error?.message ||
        "Unknown request error";

      if (
        attempt < retries
      ) {
        await sleep(
          attempt === 0
            ? 700
            : 1600
        );
      }
    }
  }

  return {
    ok: false,
    text: "",
    attempts:
      retries + 1,
    error:
      lastError
  };
}


/* =========================================================
 * INVESTMENT DOMAIN-NAME PREFILTER
 * ========================================================= */

/*
 * This is NOT the final relevance test.
 *
 * It only prevents RDAP from being called for hundreds
 * of thousands of obviously unrelated domains.
 *
 * Website content scanner remains the real relevance filter.
 */

const INVESTMENT_NAME_PATTERNS = [
  "invest",
  "investment",
  "investments",

  "profit",
  "profits",
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

  "income",

  "wealth",

  "bank",

  "loan",
  "loans",

  "asset",
  "assets",

  "trading"
];


function investmentNameMatch(
  domain
) {
  const label =
    domain
      .split(".")
      .slice(0, -1)
      .join(".")
      .replace(/[-_]/g, "")
      .toLowerCase();

  return INVESTMENT_NAME_PATTERNS.some(
    keyword =>
      label.includes(
        keyword.replace(/[-_]/g, "")
      )
  );
}


/* =========================================================
 * SMET CANDIDATE COLLECTION
 * ========================================================= */

async function discoverFromSmet(
  tld,
  periodHours
) {
  const now =
    new Date();

  const today =
    dateKeyUTC(now);

  const dates = [
    today,
    dateKeyUTC(
      addDaysUTC(now, -1)
    )
  ];

  if (
    periodHours === 48
  ) {
    dates.push(
      dateKeyUTC(
        addDaysUTC(now, -2)
      )
    );
  }

  const sourceResults = [];

  for (const date of dates) {
    const result =
      await fetchSmetDaily(
        date
      );

    sourceResults.push(
      result
    );
  }

  const successful =
    sourceResults.filter(
      item => item.ok
    );

  if (!successful.length) {
    return {
      ok: false,
      candidates: [],
      sourceResults,
      error:
        "Smet newly-registered feed unavailable"
    };
  }

  const map =
    new Map();

  let feedDomains = 0;
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
      feedDomains++;

      if (
        !domain.endsWith(tld)
      ) {
        continue;
      }

      tldMatches++;

      /*
       * Name prefilter only.
       *
       * This does NOT decide whether the website
       * is an investment website.
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
              source.url
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
      feedDomains,
      tldMatches,
      nameMatches,
      uniqueCandidates:
        map.size
    },

    error: null
  };
}


/* =========================================================
 * CRT.SH FALLBACK
 * ========================================================= */

function buildCrtUrl(
  tld
) {
  const wildcard =
    `%${tld}`;

  return (
    "https://crt.sh/?q=" +
    encodeURIComponent(
      wildcard
    ) +
    "&output=json"
  );
}


async function queryCrtSh(
  tld
) {
  const url =
    buildCrtUrl(tld);

  const result =
    await fetchJsonWithRetry(
      url,
      CT_TIMEOUT_MS,
      CT_RETRIES
    );

  if (!result.ok) {
    return {
      ok: false,
      rows: [],
      error:
        result.error,
      url
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
      error:
        "crt.sh returned unsupported JSON",
      url
    };
  }

  return {
    ok: true,
    rows:
      result.data,
    error: null,
    url
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

  const event =
    events.find(
      item =>
        String(
          item?.eventAction ||
          ""
        )
          .trim()
          .toLowerCase() ===
        "registration"
    );

  if (
    !event?.eventDate
  ) {
    return null;
  }

  const date =
    new Date(
      event.eventDate
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
  domain
) {
  const url =
    "https://rdap.org/domain/" +
    encodeURIComponent(
      domain
    );

  const result =
    await fetchJsonWithRetry(
      url,
      RDAP_TIMEOUT_MS,
      RDAP_RETRIES,
      {
        Accept:
          "application/rdap+json,application/json"
      }
    );

  if (!result.ok) {
    return {
      verified: false,
      registeredAt: null,
      registrationInWindow:
        false,
      error:
        result.error
    };
  }

  const registeredAt =
    extractRegistrationDate(
      result.data
    );

  if (!registeredAt) {
    return {
      verified: false,
      registeredAt: null,
      registrationInWindow:
        false,
      error:
        "RDAP registration event not found"
    };
  }

  return {
    verified: true,

    registeredAt:
      registeredAt.toISOString(),

    registrationInWindow:
      false,

    error: null
  };
}


/* =========================================================
 * CONCURRENCY
 * ========================================================= */

async function runWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index]
          );
      } catch (error) {
        results[index] = {
          ...items[index],

          registrationVerified:
            false,

          registrationInWindow:
            false,

          registeredAt:
            null,

          registrationError:
            error?.message ||
            "Verification failed"
        };
      }
    }
  }

  const workers =
    Math.min(
      limit,
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length: workers
      },
      runner
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
  if (
    req.method !==
    "POST"
  ) {
    return res
      .status(405)
      .json({
        ok: false,
        error:
          "Method not allowed. Use POST."
      });
  }

  const started =
    Date.now();

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
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Invalid TLD"
        });
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
     * -------------------------------------------------------
     * SOURCE 1: SMET
     * -------------------------------------------------------
     */

    const smet =
      await discoverFromSmet(
        tld,
        periodHours
      );

    /*
     * -------------------------------------------------------
     * SOURCE 2: CRT.SH
     *
     * Only used as additional discovery evidence.
     * Its failure MUST NOT fail the whole scan.
     * -------------------------------------------------------
     */

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

    /*
     * -------------------------------------------------------
     * MERGE SOURCES
     * -------------------------------------------------------
     */

    const merged =
      new Map();

    if (smet.ok) {
      for (
        const candidate
        of smet.candidates
      ) {
        merged.set(
          candidate.domain,
          candidate
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
          candidate
        );
      } else {
        existing.discoveryEvidence =
          existing.discoveryEvidence +
          "+certificate-transparency";
      }
    }

    const discoveryCandidates =
      [...merged.values()];

    /*
     * -------------------------------------------------------
     * IF SMET + CRT BOTH FAIL
     *
     * We still don't immediately throw if a source returned
     * an empty but valid result.
     * -------------------------------------------------------
     */

    if (
      !smet.ok &&
      !crt.ok
    ) {
      return res
        .status(502)
        .json({
          ok: false,

          stage:
            "discovery",

          error:
            "All discovery sources failed",

          sources: {
            smet: {
              ok: false,
              error:
                smet.error,

              urls:
                smet.sourceResults
                  ?.map(
                    item =>
                      item.url
                  ) || []
            },

            crtSh: {
              ok: false,
              error:
                crt.error,

              url:
                crt.url
            }
          },

          requests: 0,

          elapsedMs:
            Date.now() -
            started
        });
    }

    /*
     * -------------------------------------------------------
     * RDAP VERIFICATION
     * -------------------------------------------------------
     *
     * This is the HARD registration-date gate.
     */

    const verified =
      await runWithConcurrency(
        discoveryCandidates,
        RDAP_CONCURRENCY,
        async candidate => {
          const result =
            await verifyRegistration(
              candidate.domain
            );

          let inWindow =
            false;

          if (
            result.verified &&
            result.registeredAt
          ) {
            const time =
              new Date(
                result.registeredAt
              ).getTime();

            inWindow =
              time >= cutoff &&
              time <=
                Date.now() +
                FUTURE_TOLERANCE_MS;
          }

          return {
            ...candidate,

            registeredAt:
              result.registeredAt,

            registrationVerified:
              result.verified,

            registrationInWindow:
              inWindow,

            registrationError:
              result.error
          };
        }
      );

    /*
     * -------------------------------------------------------
     * HARD FILTER
     * -------------------------------------------------------
     */

    const finalCandidates =
      verified.filter(
        candidate =>
          candidate.registrationVerified ===
            true &&
          candidate.registrationInWindow ===
            true
      );

    const registrationRejected =
      verified.filter(
        candidate =>
          candidate.registrationVerified ===
            true &&
          candidate.registrationInWindow ===
            false
      );

    const verificationFailed =
      verified.filter(
        candidate =>
          candidate.registrationVerified !==
          true
      );

    /*
     * -------------------------------------------------------
     * RESPONSE
     * -------------------------------------------------------
     */

    return res
      .status(200)
      .json({
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
          registrationRejected.length,

        verificationFailed:
          verificationFailed.length,

        candidates:
          finalCandidates,

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
                ?.map(
                  item => ({
                    date:
                      item.date,

                    ok:
                      item.ok,

                    count:
                      item.domains
                        ?.length || 0,

                    error:
                      item.error
                  })
                ) || []
          },

          crtSh: {
            ok:
              crt.ok,

            error:
              crt.error,

            url:
              crt.url,

            candidates:
              ctCandidates.length
          }
        },

        statistics: {
          smetCandidates:
            smet.candidates
              ?.length || 0,

          ctCandidates:
            ctCandidates.length,

          mergedCandidates:
            discoveryCandidates.length,

          registrationVerified:
            finalCandidates.length,

          registrationRejected:
            registrationRejected.length,

          verificationFailed:
            verificationFailed.length
        },

        elapsedMs:
          Date.now() -
          started
      });

  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,

        stage:
          "discovery",

        error:
          error?.message ||
          "Discovery failed",

        elapsedMs:
          Date.now() -
          started
      });
  }
        }
