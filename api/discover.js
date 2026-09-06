"use strict";

const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 20000;

function normalizeTld(value) {
  if (typeof value !== "string") return null;

  let tld = value.trim().toLowerCase();

  if (!tld) return null;

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
    const period = body.period.toLowerCase().trim();

    if (period === "24h") return 24;
    if (period === "48h") return 48;
  }

  return 24;
}

function normalizeDomain(value) {
  if (typeof value !== "string") return null;

  let domain = value.trim().toLowerCase();

  domain = domain.replace(/^\*\.\s*/, "");
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0];
  domain = domain.replace(/\.$/, "");

  if (!domain) return null;

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

function getNames(row) {
  const names = [];

  if (typeof row?.name_value === "string") {
    names.push(
      ...row.name_value.split(/\r?\n/)
    );
  }

  if (typeof row?.common_name === "string") {
    names.push(row.common_name);
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

  for (const value of fields) {
    if (!value) continue;

    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

async function fetchJson(url) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 LD76-Investment-Radar/1.0"
      },
      signal: controller.signal
    });

    const text = await response.text();

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

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Invalid JSON response"
      );
    }

    if (!Array.isArray(data)) {
      throw new Error(
        "Response is not an array"
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * IMPORTANT:
 *
 * For ".top":
 *
 * wildcard = %.top
 *
 * encodeURIComponent("%.top")
 * becomes:
 * %25.top
 *
 * This is the correct crt.sh query.
 */
async function queryCrtSh(tld) {
  const pattern = `%${tld}`;

  const encodedPattern =
    encodeURIComponent(pattern);

  const url =
    `https://crt.sh/?q=${encodedPattern}&output=json`;

  const started = Date.now();

  try {
    const rows = await fetchJson(url);

    return {
      ok: true,
      rows,
      url,
      durationMs:
        Date.now() - started,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      url,
      durationMs:
        Date.now() - started,
      error:
        error?.message ||
        "Unknown crt.sh error"
    };
  }
}

function extractDomains(
  rows,
  tld,
  cutoffTime
) {
  const all = new Map();
  const recent = new Map();

  let rowsWithNames = 0;
  let rowsWithDates = 0;

  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object"
    ) {
      continue;
    }

    const names = getNames(row);

    if (names.length) {
      rowsWithNames++;
    }

    const certificateDate =
      getCertificateDate(row);

    if (certificateDate) {
      rowsWithDates++;
    }

    for (const rawName of names) {
      const domain =
        normalizeDomain(rawName);

      if (!domain) continue;

      if (!domain.endsWith(tld)) {
        continue;
      }

      const discoveredAt =
        certificateDate
          ? certificateDate.toISOString()
          : null;

      const record = {
        domain,

        discoveredAt,

        registeredAt: null,

        registrationVerified: false,

        source: "crt.sh",

        discoveryEvidence:
          "certificate-transparency"
      };

      const existing =
        all.get(domain);

      /*
       * Keep the newest observation.
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
          recent.get(domain);

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

  try {
    const body =
      req.body || {};

    let requestedTlds = [];

    if (
      Array.isArray(body.tlds)
    ) {
      requestedTlds =
        body.tlds;
    } else if (
      typeof body.tld === "string"
    ) {
      requestedTlds = [
        body.tld
      ];
    }

    const tlds = [
      ...new Set(
        requestedTlds
          .map(normalizeTld)
          .filter(Boolean)
      )
    ];

    if (!tlds.length) {
      return res.status(400).json({
        ok: false,
        error:
          "No valid TLD selected."
      });
    }

    const periodHours =
      normalizePeriod(body);

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

    const sourceStatus = [];

    /*
     * Query every selected TLD.
     */
    for (const tld of tlds) {
      const result =
        await queryCrtSh(tld);

      const extracted =
        extractDomains(
          result.rows,
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
        allCandidates.set(
          domain,
          record
        );
      }

      for (
        const [
          domain,
          record
        ]
        of extracted.recent
      ) {
        recentCandidates.set(
          domain,
          record
        );
      }

      sourceStatus.push({
        source: "crt.sh",

        tld,

        queryWorked:
          result.ok,

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

        durationMs:
          result.durationMs,

        error:
          result.error
      });
    }

    /*
     * IMPORTANT:
     *
     * If recent filtering produces 0,
     * DO NOT return 0 domains.
     *
     * Use all matching CT domains.
     *
     * This protects the scanner from
     * missing/old CT timestamps.
     */
    let selected;

    if (
      recentCandidates.size > 0
    ) {
      selected =
        Array.from(
          recentCandidates.values()
        );
    } else {
      selected =
        Array.from(
          allCandidates.values()
        );
    }

    /*
     * Sort newest first.
     */
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

        return bTime - aTime;
      }
    );

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
     * Never silently report 0 when
     * the source itself failed.
     */
    if (
      domains.length === 0 &&
      failedSources > 0
    ) {
      return res.status(502).json({
        ok: false,

        error:
          "Domain discovery source failed.",

        message:
          "crt.sh did not return usable domain data.",

        sourceStatus
      });
    }

    return res.status(200).json({
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

      sourceStatus,

      note:
        "Certificate-transparency discovery is not the same as verified domain registration."
    });
  } catch (error) {
    console.error(
      "LD76 DISCOVERY ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,

      error:
        "Domain discovery failed.",

      message:
        error?.message ||
        "Unknown server error."
    });
  }
}
