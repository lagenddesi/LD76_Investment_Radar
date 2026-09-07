"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY ENGINE
 * =================
 *
 * DISCOVER.JS KA SIRF EK KAAM:
 *
 * 1. Selected TLD ke domains discover karo
 * 2. Registration date RDAP se verify karo
 * 3. Selected time period ke domains return karo
 *
 * IS FILE MEIN:
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

const MAX_DISCOVERY_DAYS = 30;


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


function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
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
      days: 1,
      hours: 24
    },

    "3d": {
      key: "3d",
      days: 3,
      hours: 72
    },

    "7d": {
      key: "7d",
      days: 7,
      hours: 168
    },

    "15d": {
      key: "15d",
      days: 15,
      hours: 360
    },

    "1m": {
      key: "1m",
      days: 30,
      hours: 720
    },

    "30d": {
      key: "1m",
      days: 30,
      hours: 720
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

  const workers = Math.min(
    concurrency,
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

        status:
          result.status,

        data: null,

        error:
          `HTTP ${result.status}`
      };
    }

    try {
      return {
        ok: true,

        status:
          result.status,

        data:
          JSON.parse(
            result.text
          ),

        error: null
      };

    } catch (error) {
      return {
        ok: false,

        status:
          result.status,

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
 * Smet is used ONLY as a discovery source.
 *
 * Smet date means first observed by that dataset.
 * It is NOT treated as the registration date.
 *
 * RDAP below performs the actual registration verification.
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


function addDays(date, days) {
  const copy =
    new Date(
      date.getTime()
    );

  copy.setUTCDate(
    copy.getUTCDate() + days
  );

  return copy;
}


function extractDomainsFromSmet(data) {
  const output = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string") {
        output.push(item);
        continue;
      }

      if (
        item &&
        typeof item === "object"
      ) {
        const domain =
          item.domain ||
          item.name ||
          item.hostname;

        if (typeof domain === "string") {
          output.push(domain);
        }
      }
    }
  }

  if (
    data &&
    typeof data === "object" &&
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
      if (!Array.isArray(list)) {
        continue;
      }

      for (const item of list) {
        if (typeof item === "string") {
          output.push(item);
        } else if (
          item &&
          typeof item === "object"
        ) {
          const domain =
            item.domain ||
            item.name ||
            item.hostname;

          if (
            typeof domain === "string"
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


async function fetchSmetDay(date) {
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
 * crt.sh is ONLY a secondary discovery source.
 *
 * IMPORTANT:
 * CT issuance/discovery time is NOT registration time.
 */

async function fetchCrtDomains(
  tld
) {
  const pattern =
    `%.${tld.replace(/^\./, "")}`;

  const encoded =
    encodeURIComponent(pattern);

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
          item?.name_value || ""
        )
          .split(/\r?\n/);

      for (
        const name
        of names
      ) {
        const domain =
          normalizeDomain(
            name
          );

        if (domain) {
          domains.push(domain);
        }
      }
    }

    return [
      ...new Set(domains)
    ];

  } catch {
    return [];
  }
}


/* =========================================================
   RDAP
========================================================= */

function rdapUrl(domain) {
  return (
    "https://rdap.org/domain/" +
    encodeURIComponent(domain)
  );
}


function parseRdapEvents(data) {
  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];

  const registrationEvents =
    events.filter(
      event => {
        const action =
          String(
            event?.eventAction || ""
          )
            .trim()
            .toLowerCase();

        return (
          action ===
            "registration" ||
          action ===
            "registered"
        );
      }
    );

  for (
    const event
    of registrationEvents
  ) {
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

function mergeDomains(
  smetDomains,
  crtDomains,
  tld
) {
  const map =
    new Map();

  for (
    const domain
    of [
      ...smetDomains,
      ...crtDomains
    ]
  ) {
    const normalized =
      normalizeDomain(
        domain
      );

    if (!normalized) {
      continue;
    }

    if (
      !normalized.endsWith(
        tld
      )
    ) {
      continue;
    }

    map.set(
      normalized,
      normalized
    );
  }

  return [
    ...map.values()
  ];
}


/* =========================================================
   HANDLER
========================================================= */

module.exports = async function handler(
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

    const period =
      normalizePeriod(
        body
      );

    /*
     * ============================================
     * DISCOVERY WINDOW
     * ============================================
     *
     * We fetch only the selected period
     * from the discovery sources.
     */

    const today =
      new Date();

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

    /*
     * ============================================
     * SMET
     * ============================================
     */

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

      smetDomains.push(
        ...result.domains
      );
    }

    /*
     * ============================================
     * CRT.SH
     * ============================================
     *
     * Secondary discovery source.
     */

    const crtDomains =
      await fetchCrtDomains(
        tld
      );

    /*
     * ============================================
     * MERGE
     * ============================================
     */

    const discoveredDomains =
      mergeDomains(
        smetDomains,
        crtDomains,
        tld
      );

    /*
     * ============================================
     * RDAP
     * ============================================
     *
     * Every returned domain must have an actual
     * RDAP registration event.
     */

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

        discoverySources: [
          smetDomains.includes(
            result.domain
          )
            ? "smet"
            : null,

          crtDomains.includes(
            result.domain
          )
            ? "crt.sh"
            : null
        ].filter(Boolean),

        tld,

        period:
          period.key
      });
    }

    /*
     * ============================================
     * FINAL DEDUPLICATION
     * ============================================
     */

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
      [
        ...finalMap.values()
      ];

    /*
     * ============================================
     * RESULT
     * ============================================
     *
     * IMPORTANT:
     *
     * "relevant" is NOT calculated here.
     *
     * Scanner receives ALL domains that passed
     * discovery + registration verification +
     * selected period.
     */

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
         * Alias kept for compatibility with
         * existing frontend/backend code.
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
