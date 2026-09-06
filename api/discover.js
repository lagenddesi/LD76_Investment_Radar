"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY:
 *   Certificate Transparency = discovery lead
 *   RDAP = mandatory registration verification
 *
 * IMPORTANT:
 * CT certificate date is NOT registration date.
 *
 * A domain is returned only when RDAP confirms:
 *   registration event exists
 *   AND registration date is inside 24H/48H window.
 */

const MAX_DISCOVERY_ROWS = 5000;

const CT_TIMEOUT_MS = 15000;
const RDAP_TIMEOUT_MS = 5000;

const CT_RETRIES = 2;
const RDAP_RETRIES = 1;

const RDAP_CONCURRENCY = 5;

const FUTURE_TOLERANCE_MS =
  5 * 60 * 1000;


/* =========================================================
 * BASIC HELPERS
 * ========================================================= */

function normalizeTld(value) {
  if (typeof value !== "string") {
    return null;
  }

  let tld = value.trim().toLowerCase();

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
    const hours = Number(body.periodHours);

    if (hours === 24 || hours === 48) {
      return hours;
    }
  }

  const period =
    String(body?.period || "24h")
      .trim()
      .toLowerCase();

  return period === "48h" ? 48 : 24;
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


function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


/* =========================================================
 * HTTP
 * ========================================================= */

async function fetchText(
  url,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
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
              "Mozilla/5.0 LD76-Investment-Radar/1.0"
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

      let data;

      try {
        data = JSON.parse(text);
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

      if (attempt < retries) {
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
 * CRT.SH
 * ========================================================= */

function buildCrtUrl(tld) {
  /*
   * Correct crt.sh wildcard:
   *
   * %.top
   *
   * encodeURIComponent is applied ONCE.
   */

  const wildcard =
    `%${tld}`;

  return (
    "https://crt.sh/?q=" +
    encodeURIComponent(wildcard) +
    "&output=json"
  );
}


async function queryCrtSh(tld) {
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
      source: "crt.sh",
      rows: [],
      error:
        result.error,
      url
    };
  }

  if (!Array.isArray(result.data)) {
    return {
      ok: false,
      source: "crt.sh",
      rows: [],
      error:
        "crt.sh returned unsupported JSON",
      url
    };
  }

  return {
    ok: true,
    source: "crt.sh",
    rows:
      result.data.slice(
        0,
        MAX_DISCOVERY_ROWS
      ),
    error: null,
    url
  };
}


/* =========================================================
 * CTLOGS.DEV
 * ========================================================= */

function buildCtlogsUrl(tld) {
  /*
   * ctlogs.dev wildcard:
   *
   * *.top
   */

  const wildcard =
    `*${tld}`;

  return (
    "https://ctlogs.dev/search?q=" +
    encodeURIComponent(wildcard) +
    "&output=json"
  );
}


async function queryCtlogsDev(tld) {
  const url =
    buildCtlogsUrl(tld);

  const result =
    await fetchJsonWithRetry(
      url,
      CT_TIMEOUT_MS,
      CT_RETRIES
    );

  if (!result.ok) {
    return {
      ok: false,
      source: "ctlogs.dev",
      rows: [],
      error:
        result.error,
      url
    };
  }

  let rows = [];

  if (Array.isArray(result.data)) {
    rows =
      result.data;
  } else if (
    Array.isArray(
      result.data?.rows
    )
  ) {
    rows =
      result.data.rows;
  } else if (
    Array.isArray(
      result.data?.results
    )
  ) {
    rows =
      result.data.results;
  } else if (
    Array.isArray(
      result.data?.data
    )
  ) {
    rows =
      result.data.data;
  }

  if (!rows.length) {
    return {
      ok: true,
      source: "ctlogs.dev",
      rows: [],
      error: null,
      url
    };
  }

  return {
    ok: true,
    source: "ctlogs.dev",
    rows:
      rows.slice(
        0,
        MAX_DISCOVERY_ROWS
      ),
    error: null,
    url
  };
}


/* =========================================================
 * CT ROW EXTRACTION
 * ========================================================= */

function getCertificateDate(row) {
  const values = [
    row?.entry_timestamp,
    row?.min_entry_timestamp,
    row?.entry_time,
    row?.not_before,
    row?.precert_first_seen,
    row?.final_first_seen
  ];

  for (const value of values) {
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


function extractNames(row) {
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

  if (
    typeof row?.match ===
    "string"
  ) {
    names.push(
      row.match
    );
  }

  if (
    Array.isArray(
      row?.domains
    )
  ) {
    names.push(
      ...row.domains
    );
  }

  return names;
}


/* =========================================================
 * COLLECT CT CANDIDATES
 * ========================================================= */

function collectCtCandidates(
  rows,
  tld,
  cutoff
) {
  const map =
    new Map();

  let rowsWithNames = 0;
  let rowsWithDates = 0;

  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object"
    ) {
      continue;
    }

    const names =
      extractNames(row);

    const certificateDate =
      getCertificateDate(row);

    if (names.length) {
      rowsWithNames++;
    }

    if (certificateDate) {
      rowsWithDates++;
    }

    /*
     * CT observation must be recent.
     */

    if (
      !certificateDate ||
      certificateDate.getTime() <
        cutoff
    ) {
      continue;
    }

    for (const rawName of names) {
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

      const discoveredAt =
        certificateDate.toISOString();

      const existing =
        map.get(domain);

      if (
        !existing ||
        new Date(
          discoveredAt
        ).getTime() >
          new Date(
            existing.discoveredAt
          ).getTime()
      ) {
        map.set(
          domain,
          {
            domain,

            discoveredAt,

            discoveryEvidence:
              "certificate-transparency"
          }
        );
      }
    }
  }

  return {
    candidates:
      [...map.values()],

    rowsWithNames,

    rowsWithDates
  };
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
    events.find(item => {
      return (
        String(
          item?.eventAction || ""
        )
          .trim()
          .toLowerCase() ===
        "registration"
      );
    });

  if (!event?.eventDate) {
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
    encodeURIComponent(domain);

  const result =
    await fetchJsonWithRetry(
      url,
      RDAP_TIMEOUT_MS,
      RDAP_RETRIES
    );

  if (!result.ok) {
    return {
      verified: false,
      registeredAt: null,
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
      error:
        "RDAP registration event not found"
    };
  }

  return {
    verified: true,

    registeredAt:
      registeredAt.toISOString(),

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
    new Array(items.length);

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >= items.length
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
  if (req.method !== "POST") {
    return res.status(405).json({
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
      normalizePeriod(body);

    if (!tld) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid TLD"
      });
    }

    const cutoff =
      Date.now() -
      periodHours *
      60 *
      60 *
      1000;


    /* =====================================================
     * SOURCE 1: CRT.SH
     * SOURCE 2: CTLOGS.DEV
     *
     * IMPORTANT:
     * One source failing does NOT abort discovery.
     * ===================================================== */

    const [
      crtResult,
      ctlogsResult
    ] =
      await Promise.all([
        queryCrtSh(tld),
        queryCtlogsDev(tld)
      ]);


    const successfulSources =
      [
        crtResult,
        ctlogsResult
      ].filter(
        source =>
          source.ok
      );


    /*
     * If BOTH sources fail,
     * then discovery genuinely failed.
     */

    if (
      successfulSources.length === 0
    ) {
      return res.status(502).json({
        ok: false,

        stage:
          "ct-discovery",

        error:
          "All Certificate Transparency sources failed",

        sources: {
          crtSh: {
            ok:
              crtResult.ok,

            error:
              crtResult.error,

            url:
              crtResult.url
          },

          ctlogsDev: {
            ok:
              ctlogsResult.ok,

            error:
              ctlogsResult.error,

            url:
              ctlogsResult.url
          }
        }
      });
    }


    /* =====================================================
     * MERGE CT SOURCES
     * ===================================================== */

    const mergedRows =
      [
        ...crtResult.rows,
        ...ctlogsResult.rows
      ];


    /*
     * Deduplicate exact CT rows by JSON.
     */

    const uniqueRows =
      [];

    const rowKeys =
      new Set();

    for (
      const row
      of mergedRows
    ) {
      let key;

      try {
        key =
          JSON.stringify(row);
      } catch {
        key =
          String(row);
      }

      if (
        rowKeys.has(key)
      ) {
        continue;
      }

      rowKeys.add(key);

      uniqueRows.push(
        row
      );

      if (
        uniqueRows.length >=
        MAX_DISCOVERY_ROWS
      ) {
        break;
      }
    }


    const ctData =
      collectCtCandidates(
        uniqueRows,
        tld,
        cutoff
      );


    const ctCandidates =
      ctData.candidates;


    /* =====================================================
     * RDAP REGISTRATION VERIFICATION
     * ===================================================== */

    const verifiedRecords =
      await runWithConcurrency(
        ctCandidates,
        RDAP_CONCURRENCY,
        async candidate => {
          const verification =
            await verifyRegistration(
              candidate.domain
            );


          if (
            !verification.verified ||
            !verification.registeredAt
          ) {
            return {
              ...candidate,

              registeredAt:
                null,

              registrationVerified:
                false,

              registrationInWindow:
                false,

              registrationSource:
                "RDAP",

              registrationError:
                verification.error ||
                "Registration not verified"
            };
          }


          const registrationTime =
            new Date(
              verification.registeredAt
            ).getTime();


          const registrationInWindow =
            registrationTime >=
              cutoff &&
            registrationTime <=
              Date.now() +
                FUTURE_TOLERANCE_MS;


          return {
            ...candidate,

            registeredAt:
              verification.registeredAt,

            registrationVerified:
              true,

            registrationInWindow,

            registrationSource:
              "RDAP",

            registrationError:
              registrationInWindow
                ? null
                : "Registration date outside selected period"
          };
        }
      );


    /* =====================================================
     * FINAL VERIFIED DOMAINS
     * ===================================================== */

    const domains =
      verifiedRecords.filter(
        item =>
          item.registrationVerified ===
            true &&
          item.registrationInWindow ===
            true
      );


    const verificationFailed =
      verifiedRecords.filter(
        item =>
          item.registrationVerified !==
          true
      ).length;


    const outsideWindow =
      verifiedRecords.filter(
        item =>
          item.registrationVerified ===
            true &&
          item.registrationInWindow ===
            false
      ).length;


    const registrationRejected =
      verifiedRecords.length -
      domains.length;


    /* =====================================================
     * RESPONSE
     * ===================================================== */

    return res.status(200).json({
      ok: true,

      tld,

      periodHours,

      domains,

      candidates:
        domains,

      discovered:
        ctCandidates.length,

      registrationVerified:
        domains.length,

      registrationRejected,

      verificationFailed,

      outsideWindow,

      sourceStatus: {
        crtSh: {
          ok:
            crtResult.ok,

          rows:
            crtResult.rows.length,

          error:
            crtResult.error,

          url:
            crtResult.url
        },

        ctlogsDev: {
          ok:
            ctlogsResult.ok,

          rows:
            ctlogsResult.rows.length,

          error:
            ctlogsResult.error,

          url:
            ctlogsResult.url
        },

        registration: {
          source:
            "RDAP",

          required:
            true
        }
      },

      statistics: {
        ctRows:
          uniqueRows.length,

        crtShRows:
          crtResult.rows.length,

        ctlogsDevRows:
          ctlogsResult.rows.length,

        ctRowsWithNames:
          ctData.rowsWithNames,

        ctRowsWithDates:
          ctData.rowsWithDates,

        ctCandidates:
          ctCandidates.length,

        verifiedNewRegistrations:
          domains.length,

        rejectedByRegistrationGate:
          registrationRejected,

        verificationFailed,

        outsideWindow,

        elapsedMs:
          Date.now() -
          started
      }
    });

  } catch (error) {
    console.error(
      "LD76 discovery error:",
      error
    );

    return res.status(500).json({
      ok: false,

      stage:
        "discovery",

      error:
        error?.message ||
        "Discovery failed"
    });
  }
    }
