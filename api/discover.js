"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY ENGINE
 * =================
 *
 * discover.js ka sirf ye kaam hai:
 *
 * 1. Selected TLD ke domains discover karna
 * 2. RDAP se actual registration date verify karna
 * 3. Selected time period ke domains return karna
 *
 * Yahan:
 * ❌ Investment filtering nahi
 * ❌ Crypto filtering nahi
 * ❌ Payment filtering nahi
 * ❌ Website scanning nahi
 * ❌ Parking detection nahi
 * ❌ Financial scoring nahi
 * ❌ Gemini nahi
 *
 * Ye sab kaam api/scan.js karega.
 */

const SMET_TIMEOUT_MS = 12000;
const CRT_TIMEOUT_MS = 12000;
const RDAP_TIMEOUT_MS = 6000;

const SMET_CONCURRENCY = 6;
const RDAP_CONCURRENCY = 20;


/* =========================================================
   RESPONSE
========================================================= */

function sendJson(res, status, payload) {
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
}


/* =========================================================
   HELPERS
========================================================= */

function errorMessage(error) {
  return (
    error?.message ||
    String(error || "Unknown error")
  );
}


/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeTld(value) {
  if (typeof value !== "string") {
    return null;
  }

  let tld = value
    .trim()
    .toLowerCase();

  if (!tld) {
    return null;
  }

  if (!tld.startsWith(".")) {
    tld = "." + tld;
  }

  if (!/^\.[a-z0-9-]{2,63}$/.test(tld)) {
    return null;
  }

  return tld;
}


function normalizePeriod(body) {
  const raw = String(
    body?.period || "1d"
  )
    .trim()
    .toLowerCase();

  const periods = {
    "1d": {
      key: "1d",
      days: 1
    },

    "3d": {
      key: "3d",
      days: 3
    },

    "7d": {
      key: "7d",
      days: 7
    },

    "15d": {
      key: "15d",
      days: 15
    },

    "1m": {
      key: "1m",
      days: 30
    },

    "30d": {
      key: "1m",
      days: 30
    }
  };

  return (
    periods[raw] ||
    periods["1d"]
  );
}


function normalizeDomain(value) {
  if (typeof value !== "string") {
    return null;
  }

  let domain = value
    .trim()
    .toLowerCase();

  domain = domain.replace(
    /^https?:\/\//,
    ""
  );

  domain = domain.replace(
    /^\*\.\s*/,
    ""
  );

  domain = domain
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
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

  if (!valid.test(domain)) {
    return null;
  }

  return domain;
}


/* =========================================================
   CONCURRENCY
========================================================= */

async function mapConcurrent(
  items,
  concurrency,
  worker
) {
  const results = new Array(
    items.length
  );

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
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
          error: errorMessage(error)
        };
      }
    }
  }

  if (!items.length) {
    return results;
  }

  const workerCount = Math.min(
    concurrency,
    items.length
  );

  const workers = [];

  for (
    let i = 0;
    i < workerCount;
    i++
  ) {
    workers.push(
      runner()
    );
  }

  await Promise.all(
    workers
  );

  return results;
}


/* =========================================================
   HTTP
========================================================= */

async function fetchText(
  url,
  timeoutMs,
  headers = {}
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
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
              "LD76-Investment-Radar/8.0",

            ...headers
          },

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    return {
      ok: response.ok,

      status:
        response.status,

      statusText:
        response.statusText,

      text,

      url
    };

  } finally {
    clearTimeout(timer);
  }
}


async function fetchJson(
  url,
  timeoutMs
) {
  try {
    const result =
      await fetchText(
        url,
        timeoutMs,
        {
          Accept:
            "application/json"
        }
      );

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        data: null,
        error:
          `HTTP ${result.status}`
      };
    }

    try {
      return {
        ok: true,
        status: result.status,
        data:
          JSON.parse(
            result.text
          ),
        error: null
      };

    } catch {
      return {
        ok: false,
        status: result.status,
        data: null,
        error:
          "Invalid JSON response"
      };
    }

  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      error:
        errorMessage(error)
    };
  }
}


/* =========================================================
   SMET NRD
========================================================= */

/*
 * Smet is ONLY a discovery source.
 *
 * Smet observation date is NOT treated
 * as the actual registration date.
 *
 * RDAP verifies the actual registration date.
 */

function smetUrl(date) {
  return (
    "https://smet.cz/nrd/data/daily/" +
    date +
    ".json"
  );
}


function dateKey(date) {
  return date
    .toISOString()
    .slice(0, 10);
}


function addDays(
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


function extractDomainsFromSmet(
  data
) {
  const output = [];

  if (Array.isArray(data)) {
    for (const item of data) {

      if (
        typeof item ===
        "string"
      ) {
        output.push(item);
        continue;
      }

      if (
        item &&
        typeof item ===
        "object"
      ) {
        const domain =
          item.domain ||
          item.name ||
          item.hostname;

        if (
          typeof domain ===
          "string"
        ) {
          output.push(domain);
        }
      }
    }
  }

  if (
    data &&
    typeof data ===
    "object" &&
    !Array.isArray(data)
  ) {
    const possibleArrays = [
      data.domains,
      data.results,
      data.data,
      data.items
    ];

    for (
      const list
      of possibleArrays
    ) {
      if (
        !Array.isArray(list)
      ) {
        continue;
      }

      for (
        const item
        of list
      ) {
        if (
          typeof item ===
          "string"
        ) {
          output.push(item);

        } else if (
          item &&
          typeof item ===
          "object"
        ) {
          const domain =
            item.domain ||
            item.name ||
            item.hostname;

          if (
            typeof domain ===
            "string"
          ) {
            output.push(domain);
          }
        }
      }
    }
  }

  return output
    .map(normalizeDomain)
    .filter(Boolean);
}


async function fetchSmetDay(
  date
) {
  const key =
    dateKey(date);

  const url =
    smetUrl(key);

  try {
    const result =
      await fetchJson(
        url,
        SMET_TIMEOUT_MS
      );

    if (!result.ok) {
      return {
        ok: false,
        date: key,
        domains: [],
        error:
          result.error
      };
    }

    return {
      ok: true,
      date: key,
      domains:
        extractDomainsFromSmet(
          result.data
        ),
      error: null
    };

  } catch (error) {
    return {
      ok: false,
      date: key,
      domains: [],
      error:
        errorMessage(error)
    };
  }
}


/* =========================================================
   CRT.SH DISCOVERY
========================================================= */

/*
 * crt.sh is ONLY a secondary
 * discovery source.
 *
 * Certificate issuance date is NOT
 * treated as registration date.
 */

async function fetchCrtDomains(
  tld
) {
  const cleanTld =
    tld.replace(
      /^\./,
      ""
    );

  const pattern =
    `%.${cleanTld}`;

  const encoded =
    encodeURIComponent(
      pattern
    );

  const url =
    "https://crt.sh/?" +
    `q=${encoded}` +
    "&output=json";

  try {
    const result =
      await fetchJson(
        url,
        CRT_TIMEOUT_MS
      );

    if (!result.ok) {
      return [];
    }

    if (
      !Array.isArray(
        result.data
      )
    ) {
      return [];
    }

    const domains = [];

    for (
      const item
      of result.data
    ) {
      const names =
        String(
          item?.name_value ||
          ""
        ).split(
          /\r?\n/
        );

      for (
        const name
        of names
      ) {
        const domain =
          normalizeDomain(
            name
          );

        if (domain) {
          domains.push(
            domain
          );
        }
      }
    }

    return Array.from(
      new Set(domains)
    );

  } catch {
    return [];
  }
}


/* =========================================================
   RDAP
========================================================= */

function rdapUrl(
  domain
) {
  return (
    "https://rdap.org/domain/" +
    encodeURIComponent(
      domain
    )
  );
}


function parseRdapEvents(
  data
) {
  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];

  for (
    const event
    of events
  ) {
    const action =
      String(
        event?.eventAction ||
        ""
      )
        .trim()
        .toLowerCase();

    if (
      action !==
        "registration" &&
      action !==
        "registered"
    ) {
      continue;
    }

    const value =
      event?.eventDate;

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


async function verifyRegistration(
  domain
) {
  const url =
    rdapUrl(domain);

  try {
    const result =
      await fetchJson(
        url,
        RDAP_TIMEOUT_MS
      );

    if (!result.ok) {
      return {
        ok: false,
        domain,
        registeredAt: null,
        registrationVerified:
          false,
        error:
          result.error
      };
    }

    const registeredAt =
      parseRdapEvents(
        result.data
      );

    if (!registeredAt) {
      return {
        ok: false,
        domain,
        registeredAt: null,
        registrationVerified:
          false,
        error:
          "RDAP registration event not found"
      };
    }

    return {
      ok: true,
      domain,
      registeredAt:
        registeredAt.toISOString(),
      registrationVerified:
        true,
      error: null
    };

  } catch (error) {
    return {
      ok: false,
      domain,
      registeredAt: null,
      registrationVerified:
        false,
      error:
        errorMessage(error)
    };
  }
}


/* =========================================================
   PERIOD CHECK
========================================================= */

function isRegistrationInPeriod(
  registeredAt,
  period
) {
  if (!registeredAt) {
    return false;
  }

  const registration =
    new Date(
      registeredAt
    );

  if (
    Number.isNaN(
      registration.getTime()
    )
  ) {
    return false;
  }

  const now =
    new Date();

  const futureTolerance =
    5 * 60 * 1000;

  if (
    registration.getTime() >
    now.getTime() +
      futureTolerance
  ) {
    return false;
  }

  const start =
    new Date(
      now.getTime()
    );

  start.setUTCDate(
    start.getUTCDate() -
      period.days
  );

  return (
    registration.getTime() >=
      start.getTime() &&
    registration.getTime() <=
      now.getTime() +
        futureTolerance
  );
}


/* =========================================================
   SOURCE MERGE
========================================================= */

/*
 * IMPORTANT:
 *
 * No spread operator is used here.
 * This avoids call-stack overflow when
 * discovery returns thousands of domains.
 */

function mergeDomains(
  smetDomains,
  crtDomains,
  tld
) {
  const map =
    new Map();

  function addDomain(
    domain
  ) {
    const normalized =
      normalizeDomain(
        domain
      );

    if (!normalized) {
      return;
    }

    if (
      !normalized.endsWith(
        tld
      )
    ) {
      return;
    }

    if (
      !map.has(
        normalized
      )
    ) {
      map.set(
        normalized,
        normalized
      );
    }
  }

  for (
    const domain
    of smetDomains
  ) {
    addDomain(domain);
  }

  for (
    const domain
    of crtDomains
  ) {
    addDomain(domain);
  }

  return Array.from(
    map.values()
  );
}


/* =========================================================
   HANDLER
========================================================= */

module.exports =
  async function handler(
    req,
    res
  ) {
    if (
      req.method !==
      "POST"
    ) {
      return sendJson(
        res,
        405,
        {
          ok: false,
          error:
            "Method not allowed"
        }
      );
    }

    const startedAt =
      Date.now();

    try {
      const body =
        req.body || {};

      /* =========================================
         TLD
      ========================================= */

      const tld =
        normalizeTld(
          body.tld
        );

      if (!tld) {
        return sendJson(
          res,
          400,
          {
            ok: false,
            error:
              "Invalid TLD"
          }
        );
      }

      /* =========================================
         PERIOD
      ========================================= */

      const period =
        normalizePeriod(
          body
        );

      /* =========================================
         TODAY
      ========================================= */

      const today =
        new Date();

      /* =========================================
         SMET DATES
      ========================================= */

      const smetDates = [];

      for (
        let i = 0;
        i < period.days;
        i++
      ) {
        smetDates.push(
          addDays(
            today,
            -i
          )
        );
      }

      /* =========================================
         SMET DISCOVERY
      ========================================= */

      const smetResults =
        await mapConcurrent(
          smetDates,
          SMET_CONCURRENCY,
          fetchSmetDay
        );

      const smetDomains = [];

      for (
        const result
        of smetResults
      ) {
        if (
          !result?.ok
        ) {
          continue;
        }

        /*
         * DO NOT use:
         *
         * smetDomains.push(
         *   ...result.domains
         * )
         *
         * because thousands of arguments
         * can cause stack overflow.
         */

        for (
          const domain
          of result.domains || []
        ) {
          smetDomains.push(
            domain
          );
        }
      }

      /* =========================================
         CRT.SH DISCOVERY
      ========================================= */

      const crtDomains =
        await fetchCrtDomains(
          tld
        );

      /* =========================================
         MERGE + DEDUPE
      ========================================= */

      const discoveredDomains =
        mergeDomains(
          smetDomains,
          crtDomains,
          tld
        );

      /* =========================================
         RDAP VERIFICATION
      ========================================= */

      const rdapResults =
        await mapConcurrent(
          discoveredDomains,
          RDAP_CONCURRENCY,
          verifyRegistration
        );

      const candidates = [];

      let registrationVerifiedCount =
        0;

      let registrationInWindowCount =
        0;

      /* =========================================
         PERIOD FILTER
      ========================================= */

      for (
        const result
        of rdapResults
      ) {
        if (
          !result ||
          !result.registrationVerified
        ) {
          continue;
        }

        registrationVerifiedCount++;

        const inWindow =
          isRegistrationInPeriod(
            result.registeredAt,
            period
          );

        if (!inWindow) {
          continue;
        }

        registrationInWindowCount++;

        const discoverySources = [];

        if (
          smetDomains.includes(
            result.domain
          )
        ) {
          discoverySources.push(
            "smet"
          );
        }

        if (
          crtDomains.includes(
            result.domain
          )
        ) {
          discoverySources.push(
            "crt.sh"
          );
        }

        candidates.push({
          domain:
            result.domain,

          registeredAt:
            result.registeredAt,

          registrationVerified:
            true,

          registrationInWindow:
            true,

          discoveredAt:
            today.toISOString(),

          discoverySources,

          tld,

          period:
            period.key
        });
      }

      /* =========================================
         FINAL DEDUPLICATION
      ========================================= */

      const finalMap =
        new Map();

      for (
        const candidate
        of candidates
      ) {
        if (
          !finalMap.has(
            candidate.domain
          )
        ) {
          finalMap.set(
            candidate.domain,
            candidate
          );
        }
      }

      const finalCandidates =
        Array.from(
          finalMap.values()
        );

      /* =========================================
         FINAL RESPONSE
      ========================================= */

      return sendJson(
        res,
        200,
        {
          ok: true,

          tld,

          period:
            period.key,

          periodDays:
            period.days,

          discoveredCount:
            discoveredDomains.length,

          registrationVerifiedCount,

          registrationInWindowCount,

          candidates:
            finalCandidates,

          /*
           * Frontend compatibility.
           */
          domains:
            finalCandidates,

          stats: {
            discovered:
              discoveredDomains.length,

            registrationVerified:
              registrationVerifiedCount,

            registrationInWindow:
              registrationInWindowCount,

            final:
              finalCandidates.length,

            smetDomains:
              smetDomains.length,

            crtDomains:
              crtDomains.length
          },

          discoveryOnly:
            true,

          discoveryTimeMs:
            Date.now() -
            startedAt
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
            errorMessage(error)
        }
      );
    }
  };
