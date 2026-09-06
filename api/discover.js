export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const tlds = Array.isArray(body.tlds)
      ? body.tlds
      : [body.tld || ".top"];

    const periodHours = Number(body.periodHours || 24);

    const normalizedTlds = tlds
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean)
      .map(value => value.startsWith(".") ? value : `.${value}`);

    const allowedPeriods = [24, 48];

    if (!allowedPeriods.includes(periodHours)) {
      return res.status(400).json({
        ok: false,
        error: "periodHours must be 24 or 48"
      });
    }

    if (!normalizedTlds.length) {
      return res.status(400).json({
        ok: false,
        error: "At least one TLD is required"
      });
    }

    const domains = [];

    /*
     * V1 discovery source:
     * crt.sh Certificate Transparency logs.
     *
     * Important:
     * Certificate issuance time is treated as
     * discoveredAt, NOT as guaranteed registration time.
     */

    for (const tld of normalizedTlds) {
      const query = encodeURIComponent(`%${tld}`);

      const url =
        `https://crt.sh/?q=${query}&output=json`;

      let response;

      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": "LD76-Investment-Radar/1.0"
          }
        });
      } catch (error) {
        continue;
      }

      if (!response.ok) {
        continue;
      }

      let records;

      try {
        records = await response.json();
      } catch (error) {
        continue;
      }

      if (!Array.isArray(records)) {
        continue;
      }

      for (const record of records) {
        const commonName = String(
          record.common_name || ""
        )
          .trim()
          .toLowerCase();

        const nameValue = String(
          record.name_value || ""
        );

        const issuedAt =
          record.entry_timestamp ||
          record.not_before ||
          null;

        if (!issuedAt) {
          continue;
        }

        const discoveredAt =
          new Date(issuedAt);

        if (
          Number.isNaN(
            discoveredAt.getTime()
          )
        ) {
          continue;
        }

        const cutoff =
          Date.now() -
          periodHours *
            60 *
            60 *
            1000;

        if (
          discoveredAt.getTime() <
          cutoff
        ) {
          continue;
        }

        /*
         * name_value can contain multiple domains,
         * one per line.
         */
        const names = nameValue
          .split(/\r?\n/)
          .map(value =>
            value
              .trim()
              .toLowerCase()
          );

        names.push(commonName);

        for (const rawDomain of names) {
          const domain =
            normalizeDomain(rawDomain);

          if (!domain) {
            continue;
          }

          if (!domain.endsWith(tld)) {
            continue;
          }

          if (!isValidDomain(domain)) {
            continue;
          }

          domains.push({
            domain,
            registeredAt: null,
            discoveredAt:
              discoveredAt.toISOString(),
            source: "crt.sh"
          });
        }
      }
    }

    /*
     * Remove duplicate domains.
     * Keep the newest discovery timestamp.
     */
    const uniqueMap = new Map();

    for (const item of domains) {
      const existing =
        uniqueMap.get(item.domain);

      if (
        !existing ||
        new Date(item.discoveredAt) >
          new Date(existing.discoveredAt)
      ) {
        uniqueMap.set(
          item.domain,
          item
        );
      }
    }

    const uniqueDomains =
      Array.from(
        uniqueMap.values()
      ).sort(
        (a, b) =>
          new Date(b.discoveredAt) -
          new Date(a.discoveredAt)
      );

    return res.status(200).json({
      ok: true,
      periodHours,
      tlds: normalizedTlds,
      count: uniqueDomains.length,
      domains: uniqueDomains
    });

  } catch (error) {
    console.error(
      "Discovery error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Domain discovery failed"
    });
  }
}


/**
 * Remove certificate wildcard prefix
 * and normalize a domain name.
 */
function normalizeDomain(value) {
  let domain =
    String(value || "")
      .trim()
      .toLowerCase();

  if (!domain) {
    return null;
  }

  if (domain.startsWith("*.")) {
    domain = domain.slice(2);
  }

  domain =
    domain
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
      .trim();

  /*
   * Ignore obvious invalid certificate values.
   */
  if (
    domain.includes("*") ||
    domain.includes(" ") ||
    domain.includes("@")
  ) {
    return null;
  }

  return domain;
}


/**
 * Basic hostname validation.
 *
 * This intentionally does not try to prove
 * that the domain is registered.
 */
function isValidDomain(domain) {
  if (
    !domain ||
    domain.length > 253
  ) {
    return false;
  }

  const labels =
    domain.split(".");

  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return false;
    }

    if (
      !/^[a-z0-9-]+$/i.test(label)
    ) {
      return false;
    }
  }

  return true;
}
