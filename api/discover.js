"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY ENGINE
 * =================
 *
 * DISCOVER ka sirf kaam:
 *
 * 1. Selected TLD ke domains discover karna
 * 2. Discovery sources merge/deduplicate karna
 * 3. RDAP se actual registration date verify karna
 * 4. Selected period ke andar registered ALL domains return karna
 *
 * Discover yahan:
 * ❌ investment filtering nahi karta
 * ❌ payment filtering nahi karta
 * ❌ website scanning nahi karta
 * ❌ parking detection nahi karta
 * ❌ Gemini nahi
 * ❌ scam score nahi
 */

const SMET_TIMEOUT_MS = 12000;
const CRT_TIMEOUT_MS = 12000;
const RDAP_TIMEOUT_MS = 6000;

const SMET_CONCURRENCY = 4;
const RDAP_CONCURRENCY = 8;

const USER_AGENT = "LD76-Investment-Radar/8.0";


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

  return periods[raw] || periods["1d"];
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
    /^www\./,
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
   TLD CHECK
========================================================= */

function hasSelectedTld(domain, tld) {
  return (
    domain === tld.slice(1) ||
    domain.endsWith(tld)
  );
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

  await Promise.all(workers);

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
              USER_AGENT,

            ...headers
          },

          redirect: "follow",

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText:
        response.statusText,
      text,
      url: response.url || url
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
          JSON.parse(result.text),
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
   DATE HELPERS
========================================================= */

function dateKey(date) {
  return date
    .toISOString()
    .slice(0, 10);
}


function addDays(date, days) {
  const copy =
    new Date(date.getTime());

  copy.setUTCDate(
    copy.getUTCDate() + days
  );

  return copy;
}


/* =========================================================
   SMET NRD
========================================================= */

function smetUrl(date) {
  return (
    "https://smet.cz/nrd/data/daily/" +
    date +
    ".json"
  );
}


function extractDomainsFromSmet(data) {
  const output = [];

  function addItem(item) {
    if (
      typeof item === "string"
    ) {
      output.push(item);
      return;
    }

    if (
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

  if (Array.isArray(data)) {
    for (const item of data) {
      addItem(item);
    }
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    const lists = [
      data.domains,
      data.results,
      data.data,
      data.items
    ];

    for (const list of lists) {
      if (!Array.isArray(list)) {
        continue;
      }

      for (const item of list) {
        addItem(item);
      }
    }
  }

  return output;
}


async function fetchSmetDay(date) {
  const key =
    dateKey(date);

  const result =
    await fetchJson(
      smetUrl(key),
      SMET_TIMEOUT_MS
    );

  if (!result.ok) {
    return {
      ok: false,
      date: key,
      domains: [],
      error: result.error
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
}


/* =========================================================
   CRT.SH
========================================================= */

async function fetchCrtDomains(tld) {
  const cleanTld =
    tld.replace(/^\./, "");

  const pattern =
    `%.${cleanTld}`;

  const url =
    "https://crt.sh/?" +
    "q=" +
    encodeURIComponent(pattern) +
    "&output=json";

  const result =
    await fetchJson(
      url,
      CRT_TIMEOUT_MS
    );

  if (
    !result.ok ||
    !Array.isArray(result.data)
  ) {
    return [];
  }

  const domains = [];

  for (
    const item of result.data
  ) {
    const names =
      String(
        item?.name_value || ""
      ).split(/\r?\n/);

    for (
      const name of names
    ) {
      const domain =
        normalizeDomain(name);

      if (
        domain &&
        hasSelectedTld(
          domain,
          tld
        )
      ) {
        domains.push(domain);
      }
    }
  }

  return Array.from(
    new Set(domains)
  );
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


function parseRdapRegistrationDate(data) {
  const events =
    Array.isArray(data?.events)
      ? data.events
      : [];

  let fallback = null;

  for (
    const event of events
  ) {
    const action =
      String(
        event?.eventAction || ""
      )
        .trim()
        .toLowerCase();

    const value =
      event?.eventDate;

    if (!value) {
      continue;
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      continue;
    }

    if (
      action === "registration" ||
      action === "registered"
    ) {
      return date;
    }

    if (
      !fallback &&
      (
        action === "creation" ||
        action === "created"
      )
    ) {
      fallback = date;
    }
  }

  return fallback;
}


async function verifyRegistration(domain) {
  const result =
    await fetchJson(
      rdapUrl(domain),
      RDAP_TIMEOUT_MS
    );

  if (!result.ok) {
    return {
      ok: false,
      domain,
      registeredAt: null,
      registrationVerified:
        false,
      error: result.error
    };
  }

  const registeredAt =
    parseRdapRegistrationDate(
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
}


/* =========================================================
   PERIOD
========================================================= */

function isRegistrationInPeriod(
  registeredAt,
  period,
  now
) {
  if (!registeredAt) {
    return false;
  }

  const registration =
    new Date(registeredAt);

  if (
    Number.isNaN(
      registration.getTime()
    )
  ) {
    return false;
  }

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
  const seen =
    new Set();

  const output = [];

  function add(domain) {
    const normalized =
      normalizeDomain(domain);

    if (!normalized) {
      return;
    }

    if (
      !hasSelectedTld(
        normalized,
        tld
      )
    ) {
      return;
    }

    if (
      seen.has(normalized)
    ) {
      return;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  for (
    const domain of smetDomains
  ) {
    add(domain);
  }

  for (
    const domain of crtDomains
  ) {
    add(domain);
  }

  return output;
}


/* =========================================================
   REQUEST BODY
========================================================= */

async function readBody(req) {
  if (
    req.body &&
    typeof req.body === "object"
  ) {
    return req.body;
  }

  if (
    typeof req.body === "string"
  ) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  const startedAt =
    Date.now();

  if (
    req.method !== "POST"
  ) {
    return sendJson(
      res,
      405,
      {
        ok: false,
        stage: "discovery",
        error:
          "Method not allowed"
      }
    );
  }

  try {
    const body =
      await readBody(req);

    const tld =
      normalizeTld(
        body?.tld
      );

    if (!tld) {
      return sendJson(
        res,
        400,
        {
          ok: false,
          stage: "discovery",
          error:
            "Invalid TLD"
        }
      );
    }

    const period =
      normalizePeriod(body);

    const now =
      new Date();

    /*
     * Smet daily files needed:
     * today + previous N days.
     *
     * No domain limit is applied.
     */

    const dates = [];

    for (
      let i = 0;
      i < period.days;
      i++
    ) {
      dates.push(
        addDays(
          now,
          -i
        )
      );
    }

    /*
     * Fetch Smet daily sources.
     *
     * We deliberately use modest concurrency
     * because the source files can be very large.
     */

    const smetResults =
      await mapConcurrent(
        dates,
        SMET_CONCURRENCY,
        fetchSmetDay
      );

    const smetDomains = [];

    let smetSuccessful = 0;
    let smetFailed = 0;

    for (
      const result of smetResults
    ) {
      if (!result?.ok) {
        smetFailed++;
        continue;
      }

      smetSuccessful++;

      for (
        const rawDomain
        of result.domains
      ) {
        const domain =
          normalizeDomain(
            rawDomain
          );

        if (
          domain &&
          hasSelectedTld(
            domain,
            tld
          )
        ) {
          smetDomains.push(
            domain
          );
        }
      }
    }

    /*
     * Secondary discovery source.
     *
     * CRT is not registration proof.
     * It only expands discovery.
     */

    let crtDomains = [];

    try {
      crtDomains =
        await fetchCrtDomains(
          tld
        );
    } catch {
      crtDomains = [];
    }

    /*
     * Merge without spread operators.
     * This prevents call-stack overflow.
     */

    const discovered =
      mergeDomains(
        smetDomains,
        crtDomains,
        tld
      );

    /*
     * RDAP verification.
     *
     * Only domains that have been discovered
     * are verified.
     *
     * No financial filtering happens here.
     */

    const rdapResults =
      await mapConcurrent(
        discovered,
        RDAP_CONCURRENCY,
        verifyRegistration
      );

    const candidates = [];

    let registrationVerified = 0;
    let registrationFailed = 0;
    let periodMatched = 0;

    for (
      const result of rdapResults
    ) {
      if (
        !result ||
        !result.ok ||
        !result.registrationVerified
      ) {
        registrationFailed++;
        continue;
      }

      registrationVerified++;

      if (
        !isRegistrationInPeriod(
          result.registeredAt,
          period,
          now
        )
      ) {
        continue;
      }

      periodMatched++;

      candidates.push({
        domain:
          result.domain,

        registeredAt:
          result.registeredAt,

        discoveredAt:
          now.toISOString(),

        registrationVerified:
          true,

        tld
      });
    }

    /*
     * Final deterministic ordering:
     * newest registration first.
     */

    candidates.sort(
      (a, b) => {
        return (
          new Date(
            b.registeredAt
          ).getTime() -
          new Date(
            a.registeredAt
          ).getTime()
        );
      }
    );

    const elapsedMs =
      Date.now() -
      startedAt;

    return sendJson(
      res,
      200,
      {
        ok: true,

        stage: "discovery",

        tld,

        period:
          period.key,

        periodDays:
          period.days,

        candidates,

        /*
         * Compatibility alias used by
         * the current frontend.
         */
        domains:
          candidates,

        stats: {
          daysRequested:
            dates.length,

          smetSuccessful,

          smetFailed,

          smetDomains:
            smetDomains.length,

          crtDomains:
            crtDomains.length,

          discovered:
            discovered.length,

          registrationVerified,

          registrationFailed,

          periodMatched:
            periodMatched,

          returned:
            candidates.length,

          elapsedMs
        },

        /*
         * Explicitly tells scanner/frontend
         * that discovery performed no
         * investment/scam filtering.
         */
        discoveryOnly: true
      }
    );

  } catch (error) {
    return sendJson(
      res,
      500,
      {
        ok: false,
        stage: "discovery",
        error:
          errorMessage(error)
      }
    );
  }
}
