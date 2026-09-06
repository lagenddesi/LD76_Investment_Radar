const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 15000;

const ALLOWED_PERIODS = new Set([24, 48]);

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

function normalizeDomain(value) {
  if (typeof value !== "string") {
    return null;
  }

  let domain = value.trim().toLowerCase();

  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");

  if (
    !domain ||
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

function getDomainFromCertificateName(name) {
  if (typeof name !== "string") {
    return null;
  }

  const value = name.trim().toLowerCase();

  if (value.startsWith("*.")) {
    return value.substring(2);
  }

  return value;
}

function isMatchingTld(domain, tld) {
  return domain.endsWith(tld);
}

function parseCertificateTimestamp(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
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
      throw new Error(`HTTP ${response.status}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON response");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function queryCrtSh(tld) {
  const queries = [
    `%25${tld}`,
    `%25${tld.substring(1)}`
  ];

  const allRows = [];
  const errors = [];

  for (const query of queries) {
    const url =
      `https://crt.sh/?q=${encodeURIComponent(query)}` +
      `&output=json`;

    try {
      const data = await fetchJson(url);

      if (Array.isArray(data)) {
        allRows.push(...data);
      }
    } catch (error) {
      errors.push(error.message || "Unknown CT error");
    }
  }

  return {
    rows: allRows,
    errors
  };
}

function extractDomainsFromRows(rows, tld, cutoffTime) {
  const domains = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const timestamp =
      row.not_before ||
      row.entry_timestamp ||
      row.entry_time ||
      row.notAfter;

    const discoveredDate = parseCertificateTimestamp(timestamp);

    if (!discoveredDate) {
      continue;
    }

    const discoveredTime = new Date(discoveredDate).getTime();

    if (discoveredTime < cutoffTime) {
      continue;
    }

    const names = [];

    if (typeof row.name_value === "string") {
      names.push(...row.name_value.split(/\r?\n/));
    }

    if (typeof row.common_name === "string") {
      names.push(row.common_name);
    }

    for (const rawName of names) {
      const domainName = getDomainFromCertificateName(rawName);
      const domain = normalizeDomain(domainName);

      if (!domain) {
        continue;
      }

      if (!isMatchingTld(domain, tld)) {
        continue;
      }

      const existing = domains.get(domain);

      if (
        !existing ||
        new Date(discoveredDate).getTime() >
          new Date(existing.discoveredAt).getTime()
      ) {
        domains.set(domain, {
          domain,
          discoveredAt: discoveredDate,
          registeredAt: null,
          source: "crt.sh",
          registrationVerified: false
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

    if (tlds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid TLD selected."
      });
    }

    const requestedPeriod = Number(body.periodHours || 24);

    const periodHours = ALLOWED_PERIODS.has(requestedPeriod)
      ? requestedPeriod
      : 24;

    const now = Date.now();
    const cutoffTime =
      now - periodHours * 60 * 60 * 1000;

    const globalDomains = new Map();
    const sourceStatus = [];

    for (const tld of tlds) {
      const result = await queryCrtSh(tld);

      const domains = extractDomainsFromRows(
        result.rows,
        tld,
        cutoffTime
      );

      for (const [domain, info] of domains.entries()) {
        const existing = globalDomains.get(domain);

        if (
          !existing ||
          new Date(info.discoveredAt).getTime() >
            new Date(existing.discoveredAt).getTime()
        ) {
          globalDomains.set(domain, info);
        }
      }

      sourceStatus.push({
        source: "crt.sh",
        tld,
        rowsReceived: result.rows.length,
        domainsFound: domains.size,
        errors: result.errors
      });
    }

    const domains = Array.from(globalDomains.values())
      .sort((a, b) => {
        return (
          new Date(b.discoveredAt).getTime() -
          new Date(a.discoveredAt).getTime()
        );
      })
      .slice(0, MAX_RESULTS);

    return res.status(200).json({
      ok: true,
      periodHours,
      tlds,
      cutoffTime: new Date(cutoffTime).toISOString(),
      scannedAt: new Date().toISOString(),
      count: domains.length,
      domains,
      sourceStatus
    });
  } catch (error) {
    console.error("DISCOVER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Domain discovery failed.",
      message: error.message || "Unknown discovery error."
    });
  }
}
