"use strict";

const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 15000;

function normalizeTld(value) {
  if (typeof value !== "string") {
    return null;
  }

  let tld = value.trim().toLowerCase();

  if (!tld) {
    return null;
  }

  if (!tld.startsWith(".")) {
    tld = `.${tld}`;
  }

  if (!/^\.[a-z0-9-]{2,24}$/.test(tld)) {
    return null;
  }

  return tld;
}

function normalizePeriod(body) {
  if (body && body.periodHours !== undefined) {
    const hours = Number(body.periodHours);

    if (hours === 24 || hours === 48) {
      return hours;
    }
  }

  if (body && typeof body.period === "string") {
    const value = body.period.toLowerCase().trim();

    if (value === "24h") {
      return 24;
    }

    if (value === "48h") {
      return 48;
    }
  }

  return 24;
}

function normalizeDomain(value) {
  if (typeof value !== "string") {
    return null;
  }

  let domain = value.trim().toLowerCase();

  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");

  if (!domain) {
    return null;
  }

  if (
    domain.length > 253 ||
    domain.includes(" ") ||
    domain.includes("/") ||
    domain.includes("\\")
  ) {
    return null;
  }

  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain
    )
  ) {
    return null;
  }

  return domain;
}

function getCertificateNames(row) {
  const names = [];

  if (typeof row?.name_value === "string") {
    names.push(...row.name_value.split(/\r?\n/));
  }

  if (typeof row?.common_name === "string") {
    names.push(row.common_name);
  }

  return names;
}

function getCertificateTime(row) {
  const values = [
    row?.min_entry_timestamp,
    row?.entry_timestamp,
    row?.not_before
  ];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

async function fetchJson(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "LD76-Investment-Radar/1.0"
      },
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`crt.sh HTTP ${response.status}`);
    }

    if (!text.trim()) {
      throw new Error("crt.sh returned an empty response");
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("crt.sh returned invalid JSON");
    }

    if (!Array.isArray(data)) {
      throw new Error("crt.sh returned an unexpected response format");
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function queryCrtSh(tld) {
  /*
   * IMPORTANT:
   *
   * The actual crt.sh search is:
   *
   *     %.top
   *
   * encodeURIComponent() changes it to:
   *
   *     %25.top
   *
   * Do NOT pre-encode the % before calling encodeURIComponent().
   */

  const searchPattern = `%${tld}`;

  const url =
    `https://crt.sh/?q=${encodeURIComponent(searchPattern)}` +
    `&output=json`;

  const startedAt = Date.now();

  try {
    const rows = await fetchJson(url);

    return {
      ok: true,
      url,
      rows,
      durationMs: Date.now() - startedAt,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      url,
      rows: [],
      durationMs: Date.now() - startedAt,
      error: error.message || "Unknown crt.sh error"
    };
  }
}

function extractRecentDomains(rows, tld, cutoffTime) {
  const domains = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const certificateTime = getCertificateTime(row);

    if (!certificateTime) {
      continue;
    }

    const timestamp = certificateTime.getTime();

    if (timestamp < cutoffTime) {
      continue;
    }

    const names = getCertificateNames(row);

    for (const rawName of names) {
      const cleanName = String(rawName)
        .trim()
        .toLowerCase();

      const domain = normalizeDomain(cleanName);

      if (!domain) {
        continue;
      }

      if (!domain.endsWith(tld)) {
        continue;
      }

      const existing = domains.get(domain);

      if (
        !existing ||
        timestamp >
          new Date(existing.discoveredAt).getTime()
      ) {
        domains.set(domain, {
          domain,
          discoveredAt: certificateTime.toISOString(),

          /*
           * CT timestamp is discovery/certificate evidence,
           * NOT proof of domain registration.
           */
          registeredAt: null,
          registrationVerified: false,

          source: "crt.sh",
          discoveryEvidence: "certificate-transparency"
        });
      }
    }
  }

  return domains;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const body = req.body || {};

    let requestedTlds = [];

    if (Array.isArray(body.tlds)) {
      requestedTlds = body.tlds;
    } else if (typeof body.tld === "string") {
      requestedTlds = [body.tld];
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
        error: "No valid TLD selected."
      });
    }

    const periodHours = normalizePeriod(body);

    const now = Date.now();

    const cutoffTime =
      now - periodHours * 60 * 60 * 1000;

    const allDomains = new Map();
    const sourceStatus = [];

    for (const tld of tlds) {
      const result = await queryCrtSh(tld);

      const discovered = extractRecentDomains(
        result.rows,
        tld,
        cutoffTime
      );

      for (const [domain, record] of discovered) {
        const existing = allDomains.get(domain);

        if (
          !existing ||
          new Date(record.discoveredAt).getTime() >
            new Date(existing.discoveredAt).getTime()
        ) {
          allDomains.set(domain, record);
        }
      }

      sourceStatus.push({
        source: "crt.sh",
        tld,

        queryWorked: result.ok,

        rowsReceived: result.rows.length,

        domainsFoundInPeriod:
          discovered.size,

        durationMs: result.durationMs,

        error: result.error
      });
    }

    const domains = Array.from(allDomains.values())
      .sort((a, b) => {
        return (
          new Date(b.discoveredAt).getTime() -
          new Date(a.discoveredAt).getTime()
        );
      })
      .slice(0, MAX_RESULTS);

    const successfulSources =
      sourceStatus.filter(
        item => item.queryWorked
      ).length;

    const failedSources =
      sourceStatus.filter(
        item => !item.queryWorked
      ).length;

    return res.status(200).json({
      ok: true,

      periodHours,

      tlds,

      scannedAt:
        new Date(now).toISOString(),

      cutoffTime:
        new Date(cutoffTime).toISOString(),

      count: domains.length,

      domains,

      sourceSummary: {
        totalSources: sourceStatus.length,
        successfulSources,
        failedSources
      },

      sourceStatus
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
