"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Domain Discovery
 *
 * Strategy:
 * 1. Query crt.sh with wildcard TLD.
 * 2. Retry transient failures.
 * 3. Try alternate crt.sh query form if the first request fails.
 * 4. Deduplicate domains.
 * 5. Prefer domains whose CT observation is inside 24H/48H.
 * 6. If CT timestamps are unavailable, fall back to all matching domains.
 *
 * IMPORTANT:
 * CT discovery time != verified domain registration time.
 */

const MAX_RESULTS = 500;

const REQUEST_TIMEOUT_MS = 15000;

const MAX_RETRIES = 2;

const RETRY_DELAYS_MS = [
  800,
  1800
];

/* ----------------------------------
 * Helpers
 * ---------------------------------- */

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

  if (!/^\.[a-z0-9-]{2,24}$/.test(tld)) {
    return null;
  }

  return tld;
}


function normalizePeriod(body) {
  if (body?.periodHours !== undefined) {
    const hours = Number(
      body.periodHours
    );

    if (
      hours === 24 ||
      hours === 48
    ) {
      return hours;
    }
  }

  if (
    typeof body?.period === "string"
  ) {
    const period =
      body.period
        .trim()
        .toLowerCase();

    if (period === "24h") {
      return 24;
    }

    if (period === "48h") {
      return 48;
    }
  }

  return 24;
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
    domain.split("/")[0];

  domain =
    domain.split("?")[0];

  domain =
    domain.replace(
      /\.$/,
      ""
    );

  if (!domain) {
    return null;
  }

  if (
    domain.length > 253 ||
    domain.includes(" ") ||
    domain.includes("\\")
  ) {
    return null;
  }

  /*
   * Accept normal DNS domains.
   */
  const valid =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  if (!valid.test(domain)) {
    return null;
  }

  return domain;
}


function getNames(row) {
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


function getCertificateDate(row) {
  const fields = [
    row?.entry_timestamp,
    row?.min_entry_timestamp,
    row?.entry_time,
    row?.not_before
  ];

  for (
    const value of fields
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


function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* ----------------------------------
 * HTTP fetch
 * ---------------------------------- */

async function fetchText(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
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


async function fetchCrtJson(
  url
) {
  let lastError =
    null;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      const text =
        await fetchText(url);

      let data;

      try {
        data =
          JSON.parse(text);
      } catch {
        throw new Error(
          "crt.sh returned invalid JSON"
        );
      }

      if (!Array.isArray(data)) {
        throw new Error(
          "crt.sh response is not an array"
        );
      }

      return {
        ok: true,
        rows: data,
        attempts:
          attempt + 1,
        error: null
      };
    } catch (error) {
      lastError =
        error?.message ||
        "Unknown crt.sh error";

      if (
        attempt <
        MAX_RETRIES
      ) {
        await sleep(
          RETRY_DELAYS_MS[
            attempt
          ] || 1500
        );
      }
    }
  }

  return {
    ok: false,
    rows: [],
    attempts:
      MAX_RETRIES + 1,
    error:
      lastError
  };
}


/* ----------------------------------
 * crt.sh query variants
 * ---------------------------------- */

function buildQueries(tld) {
  /*
   * Primary:
   *
   * %.top
   *
   * encodeURIComponent() converts
   * % -> %25.
   */
  const wildcard =
    `%${tld}`;

  const primary =
    `https://crt.sh/?q=${encodeURIComponent(
      wildcard
    )}&output=json`;

  /*
   * Alternate form.
   *
   * crt.sh also supports the
   * identity query syntax.
   */
  const identity =
    `https://crt.sh/?Identity=${encodeURIComponent(
      wildcard
    )}&output=json`;

  return [
    {
      name:
        "crt.sh-q",
      url:
        primary
    },
    {
      name:
        "crt.sh-identity",
      url:
        identity
    }
  ];
}


/* ----------------------------------
 * Query source
 * ---------------------------------- */

async function queryCrtSh(
  tld
) {
  const queries =
    buildQueries(tld);

  const attempts = [];

  for (
    const query
    of queries
  ) {
    const started =
      Date.now();

    const result =
      await fetchCrtJson(
        query.url
      );

    attempts.push({
      query:
        query.name,

      url:
        query.url,

      ok:
        result.ok,

      rows:
        result.rows.length,

      attempts:
        result.attempts,

      durationMs:
        Date.now() -
        started,

      error:
        result.error
    });

    if (result.ok) {
      return {
        ok: true,

        rows:
          result.rows,

        query:
          query.name,

        attempts
      };
    }
  }

  return {
    ok: false,

    rows: [],

    query:
      null,

    attempts
  };
}


/* ----------------------------------
 * Extract domains
 * ---------------------------------- */

function extractDomains(
  rows,
  tld,
  cutoffTime
) {
  const all =
    new Map();

  const recent =
    new Map();

  let rowsWithNames = 0;

  let rowsWithDates = 0;

  for (
    const row
    of rows
  ) {
    if (
      !row ||
      typeof row !==
        "object"
    ) {
      continue;
    }

    const names =
      getNames(row);

    if (names.length) {
      rowsWithNames++;
    }

    const certificateDate =
      getCertificateDate(
        row
      );

    if (certificateDate) {
      rowsWithDates++;
    }

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

      /*
       * Only exact requested TLD.
       *
       * Prevent:
       * example.top.evil.com
       */
      if (
        !domain.endsWith(
          tld
        )
      ) {
        continue;
      }

      /*
       * Make sure the suffix
       * itself is the TLD.
       */
      const suffixStart =
        domain.length -
        tld.length;

      if (
        suffixStart <= 0
      ) {
        continue;
      }

      const discoveredAt =
        certificateDate
          ? certificateDate.toISOString()
          : null;

      const record = {
        domain,

        discoveredAt,

        registeredAt:
          null,

        registrationVerified:
          false,

        source:
          "crt.sh",

        discoveryEvidence:
          "certificate-transparency"
      };

      const existing =
        all.get(
          domain
        );

      /*
       * Keep newest observation.
       */
      if (
        !existing ||
        (
          discoveredAt &&
          (
            !existing.discoveredAt ||
            new Date(
              discoveredAt
            ).getTime() >
            new Date(
              existing.discoveredAt
            ).getTime()
          )
        )
      ) {
        all.set(
          domain,
          record
        );
      }

      /*
       * Recent observation.
       */
      if (
        certificateDate &&
        certificateDate.getTime() >=
          cutoffTime
      ) {
        const existingRecent =
          recent.get(
            domain
          );

        if (
          !existingRecent ||
          (
            discoveredAt &&
            (
              !existingRecent.discoveredAt ||
              new Date(
                discoveredAt
              ).getTime() >
              new Date(
                existingRecent.discoveredAt
              ).getTime()
            )
          )
        ) {
          recent.set(
            domain,
            record
          );
        }
      }
    }
  }

  return {
    all,
    recent,
    rowsWithNames,
    rowsWithDates
  };
}


/* ----------------------------------
 * Handler
 * ---------------------------------- */

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

  try {
    const body =
      req.body || {};

    /*
     * Accept:
     *
     * {
     *   tld: ".top"
     * }
     *
     * OR
     *
     * {
     *   tlds: [".top", ".xyz"]
     * }
     */
    let requestedTlds =
      [];

    if (
      Array.isArray(
        body.tlds
      )
    ) {
      requestedTlds =
        body.tlds;
    } else if (
      typeof body.tld ===
      "string"
    ) {
      requestedTlds = [
        body.tld
      ];
    }

    const tlds =
      [
        ...new Set(
          requestedTlds
            .map(
              normalizeTld
            )
            .filter(Boolean)
        )
      ];

    if (!tlds.length) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "No valid TLD selected."
        });
    }

    const periodHours =
      normalizePeriod(
        body
      );

    const now =
      Date.now();

    const cutoffTime =
      now -
      periodHours *
        60 *
        60 *
        1000;

    const allCandidates =
      new Map();

    const recentCandidates =
      new Map();

    const sourceStatus =
      [];

    /*
     * Query every TLD.
     */
    for (
      const tld
      of tlds
    ) {
      const result =
        await queryCrtSh(
          tld
        );

      const extracted =
        extractDomains(
          result.rows,
          tld,
          cutoffTime
        );

      /*
       * Merge all matching.
       */
      for (
        const [
          domain,
          record
        ]
        of extracted.all
      ) {
        const existing =
          allCandidates.get(
            domain
          );

        if (
          !existing ||
          (
            record.discoveredAt &&
            (
              !existing.discoveredAt ||
              new Date(
                record.discoveredAt
              ).getTime() >
              new Date(
                existing.discoveredAt
              ).getTime()
            )
          )
        ) {
          allCandidates.set(
            domain,
            record
          );
        }
      }

      /*
       * Merge recent.
       */
      for (
        const [
          domain,
          record
        ]
        of extracted.recent
      ) {
        const existing =
          recentCandidates.get(
            domain
          );

        if (
          !existing ||
          (
            record.discoveredAt &&
            (
              !existing.discoveredAt ||
              new Date(
                record.discoveredAt
              ).getTime() >
              new Date(
                existing.discoveredAt
              ).getTime()
            )
          )
        ) {
          recentCandidates.set(
            domain,
            record
          );
        }
      }

      sourceStatus.push({
        source:
          "crt.sh",

        tld,

        queryWorked:
          result.ok,

        successfulQuery:
          result.query,

        rowsReceived:
          result.rows.length,

        rowsWithNames:
          extracted.rowsWithNames,

        rowsWithDates:
          extracted.rowsWithDates,

        allMatchingDomains:
          extracted.all.size,

        recentMatchingDomains:
          extracted.recent.size,

        attempts:
          result.attempts
      });
    }


    /* ----------------------------------
     * Selection
     * ---------------------------------- */

    let selected;

    let selectionMode;

    if (
      recentCandidates.size >
      0
    ) {
      selected =
        Array.from(
          recentCandidates.values()
        );

      selectionMode =
        "recent";
    } else {
      /*
       * IMPORTANT:
       *
       * If CT timestamps are missing
       * or delayed, don't return zero.
       */
      selected =
        Array.from(
          allCandidates.values()
        );

      selectionMode =
        "all-matching-fallback";
    }


    /* ----------------------------------
     * Sort newest first
     * ---------------------------------- */

    selected.sort(
      (a, b) => {
        const aTime =
          a.discoveredAt
            ? new Date(
                a.discoveredAt
              ).getTime()
            : 0;

        const bTime =
          b.discoveredAt
            ? new Date(
                b.discoveredAt
              ).getTime()
            : 0;

        return (
          bTime -
          aTime
        );
      }
    );


    /*
     * Hard safety limit only at
     * discovery response level.
     *
     * This is NOT an AI candidate limit.
     */
    const domains =
      selected.slice(
        0,
        MAX_RESULTS
      );


    const successfulSources =
      sourceStatus.filter(
        item =>
          item.queryWorked
      ).length;

    const failedSources =
      sourceStatus.filter(
        item =>
          !item.queryWorked
      ).length;


    /*
     * If every source failed,
     * report an actual source error.
     */
    if (
      successfulSources === 0
    ) {
      return res
        .status(502)
        .json({
          ok: false,

          error:
            "Domain discovery source failed.",

          message:
            "crt.sh did not return usable domain data after retries.",

          sourceStatus
        });
    }


    /* ----------------------------------
     * Success
     * ---------------------------------- */

    return res
      .status(200)
      .json({
        ok: true,

        periodHours,

        tlds,

        scannedAt:
          new Date(
            now
          ).toISOString(),

        cutoffTime:
          new Date(
            cutoffTime
          ).toISOString(),

        count:
          domains.length,

        domains,

        statistics: {
          allMatchingDomains:
            allCandidates.size,

          recentMatchingDomains:
            recentCandidates.size,

          returnedDomains:
            domains.length
        },

        sourceSummary: {
          totalSources:
            sourceStatus.length,

          successfulSources,

          failedSources
        },

        selectionMode,

        sourceStatus,

        note:
          "Certificate-transparency discovery is not the same as verified domain registration."
      });

  } catch (error) {
    console.error(
      "LD76 DISCOVERY ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          "Domain discovery failed.",

        message:
          error?.message ||
          "Unknown server error."
      });
  }
}
