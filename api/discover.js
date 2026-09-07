"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY v7
 *
 * FLOW:
 *
 * Smet NRD / crt.sh
 *        ↓
 * TLD filter
 *        ↓
 * SMART FINANCIAL DOMAIN-NAME FILTER
 *        ↓
 * Deduplicate
 *        ↓
 * RDAP REGISTRATION VERIFICATION
 *        ↓
 * Selected registration-date window
 *        ↓
 * Final candidates
 *
 * IMPORTANT:
 *
 * 1. Discovery timestamp is NOT registration timestamp.
 * 2. RDAP registration event is mandatory.
 * 3. Payment-only words are NOT discovery signals.
 * 4. Generic words such as bank/pay/cash/coin/eth are NOT enough.
 * 5. No arbitrary 4/5/10-domain limit.
 * 6. This file is only discovery/relevance filtering.
 * 7. Gemini scam scoring happens later.
 */


/* =========================================================
 * CONFIG
 * ========================================================= */

const SMET_TIMEOUT_MS = 12000;
const CRT_TIMEOUT_MS = 12000;
const RDAP_TIMEOUT_MS = 5000;

const SMET_RETRIES = 1;
const CRT_RETRIES = 1;
const RDAP_RETRIES = 1;

const SMET_CONCURRENCY = 6;
const RDAP_CONCURRENCY = 18;

const DISCOVERY_BUDGET_MS = 80000;

const FUTURE_TOLERANCE_MS =
  5 * 60 * 1000;


/* =========================================================
 * RESPONSE
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
    try {
      return res
        .status(500)
        .end(
          JSON.stringify({
            ok: false,
            stage: "response",
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
 * ERROR
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
      "." +
      tld;
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
  const raw =
    String(
      body?.period ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    raw === "1d" ||
    raw === "1day" ||
    raw === "1-day" ||
    raw === "24h" ||
    raw === "24"
  ) {
    return {
      key: "1d",
      hours: 24,
      days: 1
    };
  }

  if (
    raw === "3d" ||
    raw === "3day" ||
    raw === "3days" ||
    raw === "3-day" ||
    raw === "3-days"
  ) {
    return {
      key: "3d",
      hours: 72,
      days: 3
    };
  }

  if (
    raw === "7d" ||
    raw === "7day" ||
    raw === "7days" ||
    raw === "7-day" ||
    raw === "7-days"
  ) {
    return {
      key: "7d",
      hours: 168,
      days: 7
    };
  }

  if (
    raw === "15d" ||
    raw === "15day" ||
    raw === "15days" ||
    raw === "15-day" ||
    raw === "15-days"
  ) {
    return {
      key: "15d",
      hours: 360,
      days: 15
    };
  }

  if (
    raw === "1m" ||
    raw === "1month" ||
    raw === "1-month" ||
    raw === "30d" ||
    raw === "30days"
  ) {
    return {
      key: "1m",
      hours: 720,
      days: 30
    };
  }

  return {
    key: "1d",
    hours: 24,
    days: 1
  };
}


function normalizeDomain(value) {
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
      .replace(
        /\.$/,
        ""
      );

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
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

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


function dateKeyUTC(date) {
  return date
    .toISOString()
    .slice(
      0,
      10
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
    copy.getUTCDate() +
    days
  );

  return copy;
}


/* =========================================================
 * HTTP
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
              "LD76-Investment-Radar/7.0",

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
          :
            errorMessage(error)
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
  let lastError =
    null;

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
            `HTTP ${response.status}`
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

        error:
          null
      };

    } catch (error) {
      lastError =
        errorMessage(
          error
        );

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

    status:
      null,

    statusText:
      null,

    contentType:
      null,

    bodyPreview:
      null,

    url,

    attempts:
      retries + 1,

    error:
      lastError ||
      "Request failed"
  };
}


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

  if (
    !result.ok
  ) {
    return {
      ...result,
      data: null,
      parseError: null
    };
  }

  try {
    const data =
      JSON.parse(
        result.text
      );

    return {
      ...result,

      ok: true,

      data,

      parseError:
        null
    };

  } catch (error) {
    return {
      ...result,

      ok: false,

      data: null,

      parseError:
        errorMessage(
          error
        ),

      error:
        "Server returned non-JSON data"
    };
  }
}


/* =========================================================
 * SMART DOMAIN-NAME FILTER
 *
 * IMPORTANT:
 *
 * Do NOT use generic payment words here.
 *
 * BAD:
 * pay
 * bank
 * cash
 * coin
 * eth
 * sada
 * naya
 * payment
 *
 * Those create huge false-positive volumes.
 *
 * We want domains whose NAME itself has a meaningful
 * financial/investment/earning/trading intent.
 * ========================================================= */


/*
 * Direct strong financial terms.
 *
 * These are allowed individually because they have
 * meaningful financial intent.
 */

const STRONG_TERMS = [
  "invest",
  "investment",
  "investor",
  "investing",

  "profit",
  "profits",
  "profitshare",

  "earning",
  "earnings",
  "earner",

  "income",
  "passiveincome",

  "roi",

  "yield",
  "highyield",

  "wealth",

  "forex",
  "trading",
  "trader",

  "broker",
  "brokers",

  "portfolio",

  "fund",
  "funds",

  "capital",

  "asset",
  "assets",

  "staking",
  "staked",

  "mining",
  "miner",

  "cloudmining",
  "cryptomining",

  "crypto",
  "cryptocurrency",

  "bitcoin",

  "ethereum",

  "usdt",
  "tether",

  "defi",

  "exchange",
  "tradingplatform",

  "investmentplan",
  "investmentplans",

  "profitplan",
  "profitplans",

  "earningplan",
  "earningplans",

  "dailyprofit",
  "dailyincome",
  "dailyreturn",
  "dailyearning",

  "fixedprofit",
  "fixedreturn",

  "highreturn",

  "referralearning",
  "referralprofit",

  "affiliateearning",
  "affiliateprofit"
];


/*
 * Terms which are too generic when used alone.
 *
 * They can only work in a financial combination.
 */

const CONTEXT_TERMS = [
  "trade",
  "return",
  "returns",
  "profit",
  "earn",
  "income",

  "crypto",
  "token",
  "tokens",
  "coin",
  "coins",

  "stake",
  "staking",

  "mine",
  "mining",

  "wallet",

  "deposit",
  "withdraw",
  "withdrawal",

  "referral",
  "affiliate",
  "commission",
  "bonus"
];


/*
 * Strong combinations.
 *
 * These are specifically useful for HYIP / earning /
 * investment / crypto-financial websites.
 */

const COMPOUND_PATTERNS = [
  /crypto.*(invest|profit|earn|trade|trading|stake|staking|yield)/i,
  /(invest|investment).*(crypto|bitcoin|ethereum|usdt|trading|forex)/i,

  /(profit|earning|income).*(plan|daily|weekly|monthly|return)/i,
  /(daily|weekly|monthly).*(profit|income|earning|return)/i,

  /(fixed|high|guaranteed).*(profit|return|yield|income)/i,

  /(deposit|stake|staking).*(profit|return|yield|income)/i,

  /(profit|income|earning).*(referral|affiliate|commission)/i,

  /(referral|affiliate).*(profit|income|earning|commission)/i,

  /(investment|investing).*(plan|fund|portfolio|capital|profit|return)/i,

  /(forex|trading).*(profit|income|signal|broker|platform)/i,

  /(mining|miner).*(profit|income|return|cloud)/i,

  /(staking|stake).*(yield|profit|return|income)/i,

  /(usdt|bitcoin|ethereum|crypto).*(deposit|withdraw|profit|return)/i,

  /(deposit|withdraw).*(crypto|usdt|bitcoin|ethereum)/i
];


/*
 * Terms which strongly suggest a domain is simply a
 * payment / banking utility rather than an investment site.
 *
 * They do NOT automatically reject the domain, but
 * they reduce discovery relevance unless another
 * strong financial signal exists.
 */

const PAYMENT_ONLY_TERMS = [
  "payment",
  "payments",
  "pay",
  "bank",
  "banking",
  "cash",
  "cashier",
  "invoice",
  "billing",
  "checkout",
  "merchant",
  "gateway",
  "wallet"
];


function compactDomainName(
  domain
) {
  const labels =
    domain
      .split(".")
      .slice(
        0,
        -1
      );

  return labels
    .join("-")
    .replace(
      /[-_]/g,
      ""
    )
    .toLowerCase();
}


function domainNameTokens(
  domain
) {
  const labels =
    domain
      .split(".")
      .slice(
        0,
        -1
      );

  return labels
    .join(" ")
    .split(
      /[^a-z0-9]+/i
    )
    .filter(Boolean)
    .map(
      token =>
        token.toLowerCase()
    );
}


function uniqueArray(
  values
) {
  return [
    ...new Set(
      values
        .filter(Boolean)
    )
  ];
}


function getDomainNameSignals(
  domain
) {
  const compact =
    compactDomainName(
      domain
    );

  const tokens =
    domainNameTokens(
      domain
    );

  const investmentMatches =
    uniqueArray(
      STRONG_TERMS.filter(
        term =>
          compact.includes(
            term
          )
      )
    );

  const contextMatches =
    uniqueArray(
      CONTEXT_TERMS.filter(
        term =>
          compact.includes(
            term
          )
      )
    );

  const compoundMatches =
    COMPOUND_PATTERNS
      .filter(
        pattern =>
          pattern.test(
            compact
          )
      )
      .map(
        pattern =>
          pattern.source
      );

  const paymentOnlyMatches =
    uniqueArray(
      PAYMENT_ONLY_TERMS.filter(
        term =>
          compact.includes(
            term
          )
      )
    );

  const highSignalMatches =
    uniqueArray(
      [
        "dailyprofit",
        "dailyincome",
        "dailyreturn",
        "dailyearning",
        "highyield",
        "highreturn",
        "fixedprofit",
        "fixedreturn",
        "passiveincome",
        "investmentplan",
        "investmentplans",
        "profitplan",
        "profitplans",
        "earningplan",
        "earningplans",
        "cloudmining",
        "cryptomining",
        "profitshare"
      ].filter(
        term =>
          compact.includes(
            term
          )
      )
    );

  return {
    name: compact,

    tokens,

    investmentMatches,

    contextMatches,

    compoundMatches,

    paymentOnlyMatches,

    highSignalMatches
  };
}


/*
 * Final discovery decision.
 *
 * IMPORTANT:
 * Payment-only names do NOT pass.
 *
 * We prefer:
 *
 * 1. Strong direct financial term
 * 2. Compound financial intent
 * 3. Two contextual financial terms
 *
 * A generic crypto news/wallet/payment domain should
 * not automatically pass.
 */

function investmentNameMatch(
  domain
) {
  const signals =
    getDomainNameSignals(
      domain
    );

  const {
    investmentMatches,
    contextMatches,
    compoundMatches,
    paymentOnlyMatches,
    highSignalMatches
  } = signals;


  /*
   * Explicit compound financial intent.
   */
  if (
    compoundMatches.length >
    0
  ) {
    return true;
  }


  /*
   * High-signal financial names.
   */
  if (
    highSignalMatches.length >
    0
  ) {
    return true;
  }


  /*
   * Strong direct financial term.
   *
   * But do not allow a payment-only word to pass.
   */
  if (
    investmentMatches.length >
    0
  ) {
    const onlyPayment =
      investmentMatches.every(
        term =>
          PAYMENT_ONLY_TERMS.includes(
            term
          )
      );

    if (!onlyPayment) {
      return true;
    }
  }


  /*
   * Two contextual financial signals can pass.
   *
   * Example:
   * crypto + profit
   * trading + income
   * deposit + profit
   *
   * But a single generic word cannot.
   */
  const meaningfulContext =
    contextMatches.filter(
      term =>
        !PAYMENT_ONLY_TERMS.includes(
          term
        )
    );

  if (
    meaningfulContext.length >=
    2
  ) {
    return true;
  }


  /*
   * Reject payment-only domains.
   */
  if (
    paymentOnlyMatches.length >
    0 &&
    meaningfulContext.length ===
    0
  ) {
    return false;
  }

  return false;
}


/* =========================================================
 * CONCURRENT MAP
 * ========================================================= */

async function mapConcurrent(
  items,
  concurrency,
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
            items[index],
            index
          );

      } catch (error) {
        results[index] = {
          ok: false,

          error:
            errorMessage(
              error
            )
        };
      }
    }
  }

  const count =
    Math.min(
      concurrency,
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          count
      },
      runner
    )
  );

  return results;
}


/* =========================================================
 * SMET NRD
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

  if (
    !result.ok
  ) {
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

  if (
    !rawDomains
  ) {
    return {
      ok: false,

      date,

      url,

      domains: [],

      count: 0,

      error:
        "Smet response does not contain a domains array",

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

    error:
      null,

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


function buildRequestedDates(
  days
) {
  const now =
    new Date();

  const dates = [];

  for (
    let offset = 0;
    offset < days;
    offset++
  ) {
    dates.push(
      dateKeyUTC(
        addDaysUTC(
          now,
          -offset
        )
      )
    );
  }

  return dates;
}


async function discoverFromSmet(
  tld,
  period
) {
  const dates =
    buildRequestedDates(
      period.days
    );

  const results =
    await mapConcurrent(
      dates,
      SMET_CONCURRENCY,
      date =>
        fetchSmetDay(
          date
        )
    );

  const successful =
    results.filter(
      item =>
        item?.ok === true
    );

  if (
    !successful.length
  ) {
    return {
      ok: false,

      candidates: [],

      sourceResults:
        results,

      error:
        "Smet feed failed for every requested day",

      statistics: {
        requestedDays:
          dates.length,

        successfulDays:
          0,

        failedDays:
          results.length,

        totalFeedDomains:
          0,

        tldMatches:
          0,

        nameMatches:
          0,

        uniqueCandidates:
          0
      }
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
        !domain.endsWith(
          tld
        )
      ) {
        continue;
      }

      tldMatches++;

      if (
        !investmentNameMatch(
          domain
        )
      ) {
        continue;
      }

      nameMatches++;

      const existing =
        map.get(
          domain
        );

      if (
        existing
      ) {
        existing.discoveryEvidence =
          existing.discoveryEvidence.includes(
            "smet"
          )
            ? existing.discoveryEvidence
            : existing.discoveryEvidence +
              "+smet";

        continue;
      }

      const signals =
        getDomainNameSignals(
          domain
        );

      map.set(
        domain,
        {
          domain,

          discoveredAt:
            new Date()
              .toISOString(),

          discoveryEvidence:
            "smet-nrd",

          discoverySource:
            source.url,

          feedDate:
            source.date,

          nameSignals:
            signals
        }
      );
    }
  }

  return {
    ok: true,

    candidates:
      [
        ...map.values()
      ],

    sourceResults:
      results,

    error:
      null,

    statistics: {
      requestedDays:
        dates.length,

      successfulDays:
        successful.length,

      failedDays:
        results.length -
        successful.length,

      totalFeedDomains,

      tldMatches,

      nameMatches,

      uniqueCandidates:
        map.size
    }
  };
}


/* =========================================================
 * CRT.SH
 * ========================================================= */

function buildCrtUrl(
  tld
) {
  /*
   * IMPORTANT:
   *
   * Use %.xyz, not %25.xyz.
   * encodeURIComponent() performs the single
   * required URL encoding.
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

  if (
    !result.ok
  ) {
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

    error:
      null,

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
      new Date(
        value
      );

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
      getCtDate(
        row
      );

    if (!date) {
      continue;
    }

    /*
     * CT timestamp is discovery evidence only.
     * It is NOT registration proof.
     */
    if (
      date.getTime() <
      cutoff
    ) {
      continue;
    }

    const names =
      getCtNames(
        row
      );

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
        !domain.endsWith(
          tld
        )
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
        map.has(
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
            "crt.sh",

          feedDate:
            null,

          nameSignals:
            getDomainNameSignals(
              domain
            )
        }
      );
    }
  }

  return [
    ...map.values()
  ];
}


/* =========================================================
 * MERGE
 * ========================================================= */

function mergeCandidates(
  smetCandidates,
  ctCandidates
) {
  const merged =
    new Map();

  for (
    const candidate
    of smetCandidates
  ) {
    merged.set(
      candidate.domain,
      {
        ...candidate
      }
    );
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

      continue;
    }

    const evidence =
      new Set(
        String(
          existing.discoveryEvidence ||
          ""
        )
          .split("+")
          .filter(Boolean)
      );

    evidence.add(
      "certificate-transparency"
    );

    existing.discoveryEvidence =
      [
        ...evidence
      ].join("+");

    if (
      !existing.discoveredAt &&
      candidate.discoveredAt
    ) {
      existing.discoveredAt =
        candidate.discoveredAt;
    }
  }

  return [
    ...merged.values()
  ];
}


/* =========================================================
 * RDAP REGISTRATION VERIFICATION
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
  if (
    Date.now() >=
    scanDeadline
  ) {
    return {
      domain,

      verified:
        false,

      inWindow:
        false,

      registeredAt:
        null,

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

  if (
    !result.ok
  ) {
    return {
      domain,

      verified:
        false,

      inWindow:
        false,

      registeredAt:
        null,

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

  if (
    !registeredAt
  ) {
    return {
      domain,

      verified:
        false,

      inWindow:
        false,

      registeredAt:
        null,

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

    verified:
      true,

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


async function verifyCandidates(
  candidates,
  cutoff,
  scanDeadline
) {
  return mapConcurrent(
    candidates,
    RDAP_CONCURRENCY,
    candidate =>
      verifyRegistration(
        candidate.domain,
        cutoff,
        scanDeadline
      )
  );
}


/* =========================================================
 * HANDLER
 * ========================================================= */

export default async function handler(
  req,
  res
) {
  const requestStarted =
    Date.now();

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
      req.body ||
      {};

    const tld =
      normalizeTld(
        body.tld ||
        body.tldValue
      );

    const period =
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
      period.hours *
      60 *
      60 *
      1000;

    const scanDeadline =
      requestStarted +
      DISCOVERY_BUDGET_MS;


    /* =====================================================
       SOURCE 1 — SMET
    ===================================================== */

    const smet =
      await discoverFromSmet(
        tld,
        period
      );


    /* =====================================================
       SOURCE 2 — CRT.SH
    ===================================================== */

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
       MERGE
    ===================================================== */

    const discoveryCandidates =
      mergeCandidates(
        smet.ok
          ? smet.candidates
          : [],
        ctCandidates
      );


    /* =====================================================
       BOTH SOURCES FAILED
    ===================================================== */

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

            period:
              period.key,

            periodHours:
              period.hours,

            periodDays:
              period.days,

            sources: {
              smet: {
                ok:
                  false,

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
                ok:
                  false,

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
       NO NAME-RELEVANT CANDIDATES
    ===================================================== */

    if (
      !discoveryCandidates.length
    ) {
      return sendJson(
        res,
        200,
        {
          ok: true,

          stage:
            "discovery",

          tld,

          period:
            period.key,

          periodHours:
            period.hours,

          periodDays:
            period.days,

          cutoff:
            new Date(
              cutoff
            ).toISOString(),

          discovered:
            0,

          registrationVerified:
            0,

          registrationRejected:
            0,

          verificationFailed:
            0,

          candidates:
            [],

          sources: {
            smet: {
              ok:
                smet.ok,

              error:
                smet.error,

              statistics:
                smet.statistics ||
                null
            },

            crtSh: {
              ok:
                crt.ok,

              error:
                crt.error,

              candidates:
                ctCandidates.length,

              diagnostic:
                crt.diagnostic ||
                null
            }
          },

          diagnostics: {
            message:
              "No domains matched the smart financial domain-name filter.",

            filterMode:
              "SMART_FINANCIAL_INTENT",

            paymentTermsUsedAsGate:
              false,

            tld,

            period:
              period.key,

            smetTldMatches:
              smet.statistics
                ?.tldMatches ||
              0,

            smetNameMatches:
              smet.statistics
                ?.nameMatches ||
              0,

            ctCandidates:
              ctCandidates.length,

            discoveryCandidates:
              0,

            elapsedMs:
              Date.now() -
              requestStarted
          }
        }
      );
    }


    /* =====================================================
       RDAP REGISTRATION VERIFICATION
    ===================================================== */

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
       BUILD FINAL CANDIDATES
    ===================================================== */

    const discoveryMap =
      new Map(
        discoveryCandidates.map(
          candidate => [
            candidate.domain,
            candidate
          ]
        )
      );

    const final =
      finalCandidates.map(
        item => {
          const discovery =
            discoveryMap.get(
              item.domain
            );

          return {
            domain:
              item.domain,

            discoveredAt:
              discovery
                ?.discoveredAt ||
              null,

            registeredAt:
              item.registeredAt,

            registrationVerified:
              true,

            registrationInWindow:
              true,

            discoveryEvidence:
              discovery
                ?.discoveryEvidence ||
              null,

            discoverySource:
              discovery
                ?.discoverySource ||
              null,

            feedDate:
              discovery
                ?.feedDate ||
              null,

            nameSignals:
              discovery
                ?.nameSignals ||
              getDomainNameSignals(
                item.domain
              )
          };
        }
      );


    /* =====================================================
       RETURN
    ===================================================== */

    return sendJson(
      res,
      200,
      {
        ok: true,

        stage:
          "discovery",

        tld,

        period:
          period.key,

        periodHours:
          period.hours,

        periodDays:
          period.days,

        cutoff:
          new Date(
            cutoff
          ).toISOString(),

        discovered:
          discoveryCandidates.length,

        registrationVerified:
          final.length,

        registrationRejected:
          outsideWindow.length,

        verificationFailed:
          failed.length,

        candidates:
          final,

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
                        ? null
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
              crt.diagnostic ||
              null
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
          filterMode:
            "SMART_FINANCIAL_INTENT",

          paymentTermsUsedAsGate:
            false,

          discoveryCandidates:
            discoveryCandidates.length,

          rdapVerified:
            verified.length,

          registrationConfirmed:
            final.length,

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

          smetStatistics:
            smet.statistics ||
            null,

          crtCandidates:
            ctCandidates.length
        },

        error:
          null
      }
    );

  } catch (error) {
    return sendJson(
      res,
      500,
      {
        ok: false,

        stage:
          "discovery",

        error:
          errorMessage(
            error
          ),

        diagnostic: {
          elapsedMs:
            Date.now() -
            requestStarted
        }
      }
    );
  }
        }
