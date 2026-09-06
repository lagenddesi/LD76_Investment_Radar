"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Dual Certificate Transparency Discovery
 *
 * Sources:
 *   1. crt.sh
 *   2. ctlogs.dev
 *
 * Both sources are queried for every selected TLD.
 * Results are merged and deduplicated.
 *
 * If one source fails, the other can still provide results.
 *
 * IMPORTANT:
 * Certificate Transparency discovery time is NOT
 * the same thing as verified domain registration time.
 */

const MAX_RESULTS = 500;

const REQUEST_TIMEOUT_MS = 15000;

const MAX_RETRIES = 2;

const RETRY_DELAYS_MS = [
  800,
  1800
];


/* =========================================================
 * BASIC HELPERS
 * ========================================================= */

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
    const hours = Number(body.periodHours);

    if (hours === 24 || hours === 48) {
      return hours;
    }
  }

  if (typeof body?.period === "string") {
    const period = body.period
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

  domain = domain.split("/")[0];

  domain = domain.split("?")[0];

  domain = domain.replace(
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

  const valid =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  if (!valid.test(domain)) {
    return null;
  }

  return domain;
}


function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


/* =========================================================
 * HTTP
 * ========================================================= */

async function fetchText(url) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
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


async function fetchJsonWithRetry(url) {
  let lastError = null;

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

      if (
        attempt < MAX_RETRIES
      ) {
        await sleep(
          RETRY_DELAYS_MS[attempt] ||
          1500
        );
      }
    }
  }

  return {
    ok: false,
    data: null,
    attempts:
      MAX_RETRIES + 1,
    error: lastError
  };
}


/* =========================================================
 * CRT.SH
 * ========================================================= */

function buildCrtUrl(tld) {
  const wildcard = `%${tld}`;

  return (
    "https://crt.sh/?q=" +
    encodeURIComponent(wildcard) +
    "&output=json"
  );
}


async function queryCrtSh(tld) {
  const url =
    buildCrtUrl(tld);

  const started =
    Date.now();

  const result =
    await fetchJsonWithRetry(url);

  if (
    !result.ok
  ) {
    return {
      source:
        "crt.sh",

      ok: false,

      rows: [],

      durationMs:
        Date.now() - started,

      attempts:
        result.attempts,

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
      source:
        "crt.sh",

      ok: false,

      rows: [],

      durationMs:
        Date.now() - started,

      attempts:
        result.attempts,

      error:
        "crt.sh JSON was not an array",

      url
    };
  }

  return {
    source:
      "crt.sh",

    ok: true,

    rows:
      result.data,

    durationMs:
      Date.now() - started,

    attempts:
      result.attempts,

    error: null,

    url
  };
}


/* =========================================================
 * CTLOGS.DEV
 * ========================================================= */

function buildCtlogsUrl(tld) {
  /*
   * ctlogs.dev accepts the same wildcard style:
   *
   * *.top
   * *.xyz
   *
   * Their search endpoint supports:
   *
   * /search?q=...&output=json
   */

  const wildcard =
    `*${tld}`;

  return (
    "https://ctlogs.dev/search?q=" +
    encodeURIComponent(
      wildcard
    ) +
    "&output=json"
  );
}


async function queryCtlogsDev(tld) {
  const url =
    buildCtlogsUrl(tld);

  const started =
    Date.now();

  const result =
    await fetchJsonWithRetry(url);

  if (
    !result.ok
  ) {
    return {
      source:
        "ctlogs.dev",

      ok: false,

      rows: [],

      durationMs:
        Date.now() - started,

      attempts:
        result.attempts,

      error:
        result.error,

      url
    };
  }

  /*
   * ctlogs.dev's search endpoint
   * can return either:
   *
   * [
   *   {...}
   * ]
   *
   * or an envelope:
   *
   * {
   *   rows: [...]
   * }
   */

  let rows = [];

  if (
    Array.isArray(
      result.data
    )
  ) {
    rows =
      result.data;
  } else if (
    Array.isArray(
      result.data?.rows
    )
  ) {
    rows =
      result.data.rows;
  } else {
    return {
      source:
        "ctlogs.dev",

      ok: false,

      rows: [],

      durationMs:
        Date.now() - started,

      attempts:
        result.attempts,

      error:
        "ctlogs.dev returned an unsupported JSON structure",

      url
    };
  }

  return {
    source:
      "ctlogs.dev",

    ok: true,

    rows,

    durationMs:
      Date.now() - started,

    attempts:
      result.attempts,

    error: null,

    url
  };
}


/* =========================================================
 * EXTRACT CRT.SH ROW
 * ========================================================= */

function extractCrtNames(row) {
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


function getCrtDate(row) {
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


/* =========================================================
 * EXTRACT CTLOGS.DEV ROW
 * ========================================================= */

function extractCtlogsNames(row) {
  const names = [];

  if (
    typeof row?.match ===
    "string"
  ) {
    names.push(
      row.match
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

  /*
   * Some response variants may expose
   * domain names directly.
   */

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


function getCtlogsDate(row) {
  const fields = [
    row?.not_before,
    row?.precert_first_seen,
    row?.final_first_seen
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


/* =========================================================
 * GENERIC EXTRACTION
 * ========================================================= */

function extractSourceDomains(
  sourceResult,
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
    of sourceResult.rows
  ) {
    if (
      !row ||
      typeof row !==
        "object"
    ) {
      continue;
    }

    let names;

    let certificateDate;

    if (
      sourceResult.source ===
      "crt.sh"
    ) {
      names =
        extractCrtNames(
          row
        );

      certificateDate =
        getCrtDate(
          row
        );
    } else {
      names =
        extractCtlogsNames(
          row
        );

      certificateDate =
        getCtlogsDate(
          row
        );
    }

    if (names.length) {
      rowsWithNames++;
    }

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
       * Exact selected TLD.
       */
      if (
        !domain.endsWith(
          tld
        )
      ) {
        continue;
      }

      /*
       * Must actually have a domain
       * before the TLD.
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
          sourceResult.source,

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
       * Recent CT observation.
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


/* =========================================================
 * MERGE RECORD
 * ========================================================= */

function mergeRecord(
  existing,
  incoming
) {
  if (!existing) {
    return incoming;
  }

  /*
   * Prefer the newest discovery time.
   */
  const existingTime =
    existing.discoveredAt
      ? new Date(
          existing.discoveredAt
        ).getTime()
      : 0;

  const incomingTime =
    incoming.discoveredAt
      ? new Date(
          incoming.discoveredAt
        ).getTime()
      : 0;

  const newer =
    incomingTime >
    existingTime
      ? incoming
      : existing;

  /*
   * Record both sources when
   * possible.
   */
  const sources =
    new Set();

  if (
    Array.isArray(
      existing.sources
    )
  ) {
    for (
      const source
      of existing.sources
    ) {
      sources.add(
        source
      );
    }
  } else if (
    existing.source
  ) {
    sources.add(
      existing.source
    );
  }

  if (
    Array.isArray(
      incoming.sources
    )
  ) {
    for (
      const source
      of incoming.sources
    ) {
      sources.add(
        source
      );
    }
  } else if (
    incoming.source
  ) {
    sources.add(
      incoming.source
    );
  }

  return {
    ...newer,

    sources:
      Array.from(
        sources
      ),

    source:
      Array.from(
        sources
      ).join("+")
  };
}


/* =========================================================
 * HANDLER
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

  try {
    const body =
      req.body || {};

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


    /* =====================================================
     * QUERY BOTH SOURCES FOR EVERY TLD
     *
     * Promise.all means crt.sh and ctlogs.dev
     * are attempted at the same time.
     * ===================================================== */

    for (
      const tld
      of tlds
    ) {
      const [
        crtResult,
        ctlogsResult
      ] = await Promise.all([
        queryCrtSh(tld),
        queryCtlogsDev(tld)
      ]);


      /* -----------------------------------------------
       * Process crt.sh
       * ----------------------------------------------- */

      if (
        crtResult.ok
      ) {
        const extracted =
          extractSourceDomains(
            crtResult,
            tld,
            cutoffTime
          );

        for (
          const [
            domain,
            record
          ]
          of extracted.all
        ) {
          const merged =
            mergeRecord(
              allCandidates.get(
                domain
              ),
              record
            );

          allCandidates.set(
            domain,
            merged
          );
        }

        for (
          const [
            domain,
            record
          ]
          of extracted.recent
        ) {
          const merged =
            mergeRecord(
              recentCandidates.get(
                domain
              ),
              record
            );

          recentCandidates.set(
            domain,
            merged
          );
        }

        sourceStatus.push({
          source:
            "crt.sh",

          tld,

          queryWorked:
            true,

          rowsReceived:
            crtResult.rows.length,

          rowsWithNames:
            extracted.rowsWithNames,

          rowsWithDates:
            extracted.rowsWithDates,

          allMatchingDomains:
            extracted.all.size,

          recentMatchingDomains:
            extracted.recent.size,

          attempts:
            crtResult.attempts,

          durationMs:
            crtResult.durationMs,

          error:
            null
        });
      } else {
        sourceStatus.push({
          source:
            "crt.sh",

          tld,

          queryWorked:
            false,

          rowsReceived:
            0,

          rowsWithNames:
            0,

          rowsWithDates:
            0,

          allMatchingDomains:
            0,

          recentMatchingDomains:
            0,

          attempts:
            crtResult.attempts,

          durationMs:
            crtResult.durationMs,

          error:
            crtResult.error
        });
      }


      /* -----------------------------------------------
       * Process ctlogs.dev
       * ----------------------------------------------- */

      if (
        ctlogsResult.ok
      ) {
        const extracted =
          extractSourceDomains(
            ctlogsResult,
            tld,
            cutoffTime
          );

        for (
          const [
            domain,
            record
          ]
          of extracted.all
        ) {
          const merged =
            mergeRecord(
              allCandidates.get(
                domain
              ),
              record
            );

          allCandidates.set(
            domain,
            merged
          );
        }

        for (
          const [
            domain,
            record
          ]
          of extracted.recent
        ) {
          const merged =
            mergeRecord(
              recentCandidates.get(
                domain
              ),
              record
            );

          recentCandidates.set(
            domain,
            merged
          );
        }

        sourceStatus.push({
          source:
            "ctlogs.dev",

          tld,

          queryWorked:
            true,

          rowsReceived:
            ctlogsResult.rows.length,

          rowsWithNames:
            extracted.rowsWithNames,

          rowsWithDates:
            extracted.rowsWithDates,

          allMatchingDomains:
            extracted.all.size,

          recentMatchingDomains:
            extracted.recent.size,

          attempts:
            ctlogsResult.attempts,

          durationMs:
            ctlogsResult.durationMs,

          error:
            null
        });
      } else {
        sourceStatus.push({
          source:
            "ctlogs.dev",

          tld,

          queryWorked:
            false,

          rowsReceived:
            0,

          rowsWithNames:
            0,

          rowsWithDates:
            0,

          allMatchingDomains:
            0,

          recentMatchingDomains:
            0,

          attempts:
            ctlogsResult.attempts,

          durationMs:
            ctlogsResult.durationMs,

          error:
            ctlogsResult.error
        });
      }
    }


    /* =====================================================
     * SELECT RECENT RESULTS
     * ===================================================== */

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
       * If CT timestamps are unavailable,
       * don't falsely report zero.
       */
      selected =
        Array.from(
          allCandidates.values()
        );

      selectionMode =
        "all-matching-fallback";
    }


    /* =====================================================
     * SORT
     * ===================================================== */

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
     * Discovery safety limit.
     *
     * This does NOT limit Gemini.
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


    /* =====================================================
     * BOTH SOURCES FAILED
     * ===================================================== */

    if (
      successfulSources === 0
    ) {
      return res
        .status(502)
        .json({
          ok: false,

          error:
            "All domain discovery sources failed.",

          message:
            "Neither crt.sh nor ctlogs.dev returned usable data.",

          sourceStatus
        });
    }


    /* =====================================================
     * SUCCESS
     * ===================================================== */

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
          "Domains are discovered from Certificate Transparency data. CT discovery is not verified domain registration."
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
