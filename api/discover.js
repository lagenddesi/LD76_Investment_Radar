"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * DISCOVERY PIPELINE
 *
 * CT logs = discovery LEAD ONLY.
 * RDAP     = registration-date verification.
 *
 * HARD RULE:
 * A domain is returned only when:
 *
 * 1. It was recently observed in Certificate Transparency.
 * 2. RDAP returned an authoritative registration event.
 * 3. The RDAP registration date is inside the selected
 *    24H / 48H window.
 *
 * CT certificate time is NEVER treated as registration time.
 */

const MAX_DISCOVERY_ROWS = 5000;

const CT_TIMEOUT_MS = 15000;
const RDAP_TIMEOUT_MS = 4500;

const CT_RETRIES = 2;
const RDAP_RETRIES = 1;

const RDAP_CONCURRENCY = 40;

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;


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

  const period = String(
    body?.period || "24h"
  ).trim().toLowerCase();

  return period === "48h" ? 48 : 24;
}


function normalizeDomain(value) {
  if (typeof value !== "string") {
    return null;
  }

  let domain = value
    .trim()
    .toLowerCase();

  domain = domain.replace(
    /^\*\.\s*/,
    ""
  );

  domain = domain.replace(
    /^https?:\/\//,
    ""
  );

  domain = domain
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

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
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

      try {
        return {
          ok: true,
          data: JSON.parse(text),
          attempts: attempt + 1,
          error: null
        };
      } catch {
        throw new Error(
          "Invalid JSON response"
        );
      }
    } catch (error) {
      lastError =
        error?.message ||
        "Unknown request error";

      if (attempt < retries) {
        await sleep(
          attempt === 0
            ? 700
            : 1500
        );
      }
    }
  }

  return {
    ok: false,
    data: null,
    attempts: retries + 1,
    error: lastError
  };
}


/* =========================================================
 * CRT.SH
 * ========================================================= */

function buildCrtUrl(tld) {
  /*
   * crt.sh expects:
   * %.top
   * %.xyz
   *
   * Encode exactly once.
   */

  const wildcard = `%${tld}`;

  return (
    "https://crt.sh/?q=" +
    encodeURIComponent(wildcard) +
    "&output=json"
  );
}


async function queryCrtSh(tld) {
  const result =
    await fetchJsonWithRetry(
      buildCrtUrl(tld),
      CT_TIMEOUT_MS,
      CT_RETRIES
    );

  if (!result.ok) {
    throw new Error(
      result.error ||
      "crt.sh request failed"
    );
  }

  if (!Array.isArray(result.data)) {
    throw new Error(
      "crt.sh JSON was not an array"
    );
  }

  return result.data.slice(
    0,
    MAX_DISCOVERY_ROWS
  );
}


/* =========================================================
 * CT DATE + DOMAIN EXTRACTION
 * ========================================================= */

function getCertificateDate(row) {
  const values = [
    row?.entry_timestamp,
    row?.min_entry_timestamp,
    row?.entry_time,
    row?.not_before
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

  return names;
}


function collectCtCandidates(
  rows,
  tld,
  cutoff
) {
  const domains =
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

    const certificateDate =
      getCertificateDate(row);

    const names =
      extractNames(row);

    if (names.length) {
      rowsWithNames++;
    }

    if (certificateDate) {
      rowsWithDates++;
    }

    /*
     * We only need CT observations
     * inside the requested discovery window.
     */

    if (
      !certificateDate ||
      certificateDate.getTime() < cutoff
    ) {
      continue;
    }

    for (const rawName of names) {
      const domain =
        normalizeDomain(rawName);

      if (!domain) {
        continue;
      }

      if (!domain.endsWith(tld)) {
        continue;
      }

      const suffixStart =
        domain.length -
        tld.length;

      if (suffixStart <= 0) {
        continue;
      }

      const discoveredAt =
        certificateDate.toISOString();

      const existing =
        domains.get(domain);

      if (
        !existing ||
        new Date(discoveredAt).getTime() >
          new Date(existing.discoveredAt).getTime()
      ) {
        domains.set(
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
      [...domains.values()],

    rowsWithNames,

    rowsWithDates
  };
}


/* =========================================================
 * RDAP REGISTRATION VERIFICATION
 * ========================================================= */

function extractRegistrationDate(
  rdap
) {
  const events =
    Array.isArray(rdap?.events)
      ? rdap.events
      : [];

  /*
   * IMPORTANT:
   * Only an actual RDAP "registration"
   * event is accepted.
   *
   * expiration,
   * last changed,
   * transfer,
   * last update
   * are NOT registration dates.
   */

  const registration =
    events.find(event => {
      return (
        String(
          event?.eventAction || ""
        )
          .trim()
          .toLowerCase() ===
        "registration"
      );
    });

  if (!registration?.eventDate) {
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
        result.error ||
        "RDAP verification failed"
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
        "RDAP returned no authoritative registration event"
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
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          ...items[index],

          registrationVerified:
            false,

          registeredAt:
            null,

          registrationInWindow:
            false,

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
        error: "Invalid TLD"
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

    /* ---------------------------------------------
     * CT DISCOVERY
     * ------------------------------------------- */

    let rows;

    try {
      rows =
        await queryCrtSh(tld);
    } catch (error) {
      console.error(
        "CT discovery failed:",
        error
      );

      return res.status(502).json({
        ok: false,
        stage:
          "ct-discovery",
        error:
          error?.message ||
          "Certificate Transparency discovery failed"
      });
    }

    const ctData =
      collectCtCandidates(
        rows,
        tld,
        cutoff
      );

    const ctCandidates =
      ctData.candidates;


    /* ---------------------------------------------
     * HARD RDAP REGISTRATION GATE
     * ------------------------------------------- */

    const verifiedRecords =
      await runWithConcurrency(
        ctCandidates,
        RDAP_CONCURRENCY,
        async candidate => {
          const verification =
            await verifyRegistration(
              candidate.domain
            );

          /*
           * NO registration date:
           * reject completely.
           */

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

              registrationError:
                verification.error ||
                "Registration date not verified"
            };
          }

          const registrationTime =
            new Date(
              verification.registeredAt
            ).getTime();

          const insideWindow =
            registrationTime >=
              cutoff &&
            registrationTime <=
              Date.now() +
                FUTURE_TOLERANCE_MS;

          /*
           * Registration verified but old:
           * reject.
           */

          if (!insideWindow) {
            return {
              ...candidate,

              registeredAt:
                verification.registeredAt,

              registrationVerified:
                true,

              registrationInWindow:
                false,

              registrationSource:
                "RDAP",

              registrationError:
                "Verified registration date is outside selected period"
            };
          }

          /*
           * FINAL VERIFIED NEW REGISTRATION
           */

          return {
            ...candidate,

            registeredAt:
              verification.registeredAt,

            registrationVerified:
              true,

            registrationInWindow:
              true,

            registrationSource:
              "RDAP",

            registrationError:
              null
          };
        }
      );


    /* ---------------------------------------------
     * ONLY VERIFIED NEW REGISTRATIONS CONTINUE
     * ------------------------------------------- */

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


    /* ---------------------------------------------
     * RESPONSE
     * ------------------------------------------- */

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
          ok: true,
          rows: rows.length
        },

        registration: {
          source: "RDAP",
          required: true
        }
      },

      statistics: {
        ctRows:
          rows.length,

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
          Date.now() - started
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
