const MAX_DOMAINS = 50;
const MAX_CANDIDATES = 30;
const CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 3500;
const MAX_HTML_BYTES = 300000;
const MAX_TEXT_CHARS = 70000;
const MAX_EXTRA_PAGES = 2;

const INVESTMENT_PATTERNS = [
  /\binvest(?:ment|ing)?\b/i,
  /\bdeposit\b/i,
  /\bprofit\b/i,
  /\breturn\b/i,
  /\broi\b/i,
  /\bearning(?:s)?\b/i,
  /\bincome\b/i,
  /\bpassive income\b/i,
  /\bwithdraw(?:al)?\b/i,
  /\bmaturity\b/i,
  /\b(?:investment|earning) plan\b/i,
  /\breferral\b/i,
  /\baffiliate\b/i,
  /\bcommission\b/i,
  /\bteam income\b/i,
  /\bbonus\b/i,
  /\b(?:daily|weekly|monthly) (?:profit|return|income|earning)\b/i,
  /\bguaranteed (?:profit|return|income)\b/i,
  /\bfixed (?:profit|return|income)\b/i
];

const DAILY_RETURN_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?day\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*daily\b/i,
  /\bdaily\s+(?:profit|return|income)\b/i,
  /\b(?:profit|return|income)\s+(?:of\s+)?\d+(?:\.\d+)?\s*%\b/i
];

const ROI_PATTERNS = [
  /\broi\b/i,
  /\breturn on investment\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:roi|return)\b/i
];

const PAYMENT_PATTERNS = {
  bank: [
    /\bbank transfer\b/i,
    /\bbank deposit\b/i,
    /\bbank account\b/i,
    /\baccount number\b/i,
    /\baccount title\b/i,
    /\biban\b/i,
    /\bpkr\b/i,
    /\bpakistani rupees?\b/i
  ],

  easypaisa: [
    /\beasypaisa\b/i,
    /\beasy\s*paisa\b/i
  ],

  jazzcash: [
    /\bjazzcash\b/i,
    /\bjazz\s*cash\b/i
  ],

  crypto: [
    /\busdt\b/i,
    /\btrc20\b/i,
    /\berc20\b/i,
    /\bbep20\b/i,
    /\bbitcoin\b/i,
    /\bethereum\b/i,
    /\bcrypto(?:currency)?\b/i,
    /\bwallet address\b/i
  ]
};

const RELEVANT_PATHS = [
  "/about",
  "/about-us",
  "/contact",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/terms-and-conditions",
  "/refund",
  "/withdraw",
  "/withdrawal",
  "/deposit",
  "/investment",
  "/plans",
  "/support",
  "/faq"
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const input = Array.isArray(body.domains)
      ? body.domains
      : [];

    const payments = normalizePayments(
      body.paymentMethods
    );

    const domains = uniqueDomains(
      input
        .slice(0, MAX_DOMAINS)
        .map(normalizeInputDomain)
        .filter(Boolean)
    );

    if (!domains.length) {
      return res.status(200).json({
        ok: true,
        scanned: 0,
        active: 0,
        investmentMatches: 0,
        paymentMatches: 0,
        transparencyCandidates: 0,
        candidates: []
      });
    }

    const results = [];

    await runWithConcurrency(
      domains,
      CONCURRENCY,
      async item => {
        results.push(
          await scanDomain(item)
        );
      }
    );

    const active = results.filter(
      item => item.status === "active"
    );

    const investment = active.filter(
      item => item.investment.relevant
    );

    const payment = investment.filter(
      item =>
        hasSelectedPayment(
          item.paymentMethods,
          payments
        )
    );

    const candidates = payment
      .filter(
        item =>
          item.transparency.candidate
      )
      .sort(
        (a, b) =>
          b.investment.score -
          a.investment.score
      )
      .slice(0, MAX_CANDIDATES);

    return res.status(200).json({
      ok: true,
      scanned: domains.length,
      active: active.length,
      investmentMatches: investment.length,
      paymentMatches: payment.length,
      transparencyCandidates:
        candidates.length,
      candidates
    });

  } catch (error) {
    console.error(
      "Scan error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Website scanning failed",
      message:
        error?.message ||
        "Unknown error"
    });
  }
}

async function scanDomain(input) {
  const domain = input.domain;

  const result = {
    domain,

    registeredAt:
      input.registeredAt || null,

    discoveredAt:
      input.discoveredAt || null,

    lastScanned:
      new Date().toISOString(),

    status: "inactive",

    httpStatus: null,

    https: true,

    finalUrl: null,

    redirects: [],

    websiteName: null,

    title: null,

    description: null,

    pagesChecked: [],

    content: "",

    snippets: [],

    investment: {
      relevant: false,
      score: 0,
      keywords: [],
      dailyReturnClaims: [],
      roiClaims: []
    },

    paymentMethods: {
      bank: false,
      easypaisa: false,
      jazzcash: false,
      crypto: false,
      detected: []
    },

    transparency: {
      company: [],
      legal: [],
      support: [],
      candidate: false
    },

    technical: {
      https: true,
      status: null,
      redirects: 0
    },

    errors: []
  };

  let page =
    await fetchPage(
      `https://${domain}/`
    );

  if (!page.ok) {
    page =
      await fetchPage(
        `http://${domain}/`
      );
  }

  if (!page.ok) {
    result.errors =
      [page.error].filter(Boolean);

    return result;
  }

  result.status = "active";

  result.httpStatus =
    page.status;

  result.finalUrl =
    page.finalUrl;

  result.redirects =
    page.redirects || [];

  result.https =
    page.finalUrl
      ?.startsWith("https://") ?? true;

  result.technical = {
    https: result.https,
    status: page.status,
    redirects:
      result.redirects.length
  };

  result.title =
    extractTitle(page.text);

  result.websiteName =
    result.title || domain;

  result.description =
    extractMetaDescription(
      page.text
    );

  const extra =
    extractRelevantLinks(
      page.text,
      page.finalUrl ||
        `https://${domain}`
    ).slice(
      0,
      MAX_EXTRA_PAGES
    );

  const pages = [page];

  for (const url of extra) {
    const extraPage =
      await fetchPage(url);

    if (extraPage.ok) {
      pages.push(extraPage);
    }
  }

  result.pagesChecked =
    pages.map(
      item => item.finalUrl
    );

  const text =
    pages
      .map(
        item =>
          extractUsefulText(
            item.text
          )
      )
      .join(" ")
      .slice(
        0,
        MAX_TEXT_CHARS
      );

  result.content = text;

  result.investment =
    analyzeInvestmentContent(
      text
    );

  result.paymentMethods =
    detectPaymentMethods(
      text
    );

  result.transparency =
    analyzeTransparency(
      text,
      pages
    );

  result.snippets =
    extractRelevantSnippets(
      text
    );

  result.transparency.candidate =
    result.investment.relevant &&
    result.paymentMethods.detected
      .length > 0;

  return result;
}

async function fetchPage(url) {
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
      await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal:
          controller.signal,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; LD76-Investment-Radar/1.0)",

          Accept:
            "text/html,application/xhtml+xml"
        }
      });

    clearTimeout(timer);

    const type =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !type.includes("text/html") &&
      !type.includes(
        "application/xhtml+xml"
      )
    ) {
      return {
        ok: false,
        error:
          `Unsupported content type: ${type}`,
        status:
          response.status,
        finalUrl:
          response.url
      };
    }

    const reader =
      response.body?.getReader();

    if (!reader) {
      return {
        ok: false,
        error:
          "Response body unavailable",
        status:
          response.status,
        finalUrl:
          response.url
      };
    }

    const chunks = [];

    let total = 0;

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) break;

      if (!value) continue;

      total += value.length;

      if (
        total >
        MAX_HTML_BYTES
      ) {
        try {
          await reader.cancel();
        } catch {}

        break;
      }

      chunks.push(value);
    }

    return {
      ok: response.ok,

      status:
        response.status,

      finalUrl:
        response.url,

      redirects: [],

      text:
        new TextDecoder(
          "utf-8"
        ).decode(
          combine(chunks)
        )
    };

  } catch (error) {
    clearTimeout(timer);

    return {
      ok: false,

      error:
        error?.name === "AbortError"
          ? "Request timeout"
          : error?.message ||
            "Request failed"
    };
  }
}

function analyzeInvestmentContent(text) {
  const keywords = [];

  for (
    const pattern
    of INVESTMENT_PATTERNS
  ) {
    const match =
      text.match(pattern);

    if (match) {
      keywords.push(
        match[0]
      );
    }
  }

  const daily =
    collectMatches(
      text,
      DAILY_RETURN_PATTERNS
    );

  const roi =
    collectMatches(
      text,
      ROI_PATTERNS
    );

  let score = 0;

  if (keywords.length)
    score += 10;

  if (daily.length)
    score += 15;

  if (roi.length)
    score += 15;

  if (
    /\bdeposit\b/i.test(text)
  )
    score += 10;

  if (
    /\bwithdraw(?:al)?\b/i.test(text)
  )
    score += 10;

  if (
    /\breferral\b|\baffiliate\b|\bcommission\b/i.test(text)
  )
    score += 10;

  return {
    relevant:
      keywords.length > 0,

    score,

    keywords:
      uniqueStrings(
        keywords
      ).slice(0, 30),

    dailyReturnClaims:
      uniqueStrings(
        daily
      ).slice(0, 20),

    roiClaims:
      uniqueStrings(
        roi
      ).slice(0, 20)
  };
}

function detectPaymentMethods(text) {
  const result = {
    bank: false,
    easypaisa: false,
    jazzcash: false,
    crypto: false,
    detected: []
  };

  for (
    const type of Object.keys(
      PAYMENT_PATTERNS
    )
  ) {
    result[type] =
      PAYMENT_PATTERNS[type].some(
        pattern =>
          pattern.test(text)
      );
  }

  if (result.bank)
    result.detected.push("Bank");

  if (result.easypaisa)
    result.detected.push(
      "Easypaisa"
    );

  if (result.jazzcash)
    result.detected.push(
      "JazzCash"
    );

  if (result.crypto)
    result.detected.push(
      "Crypto"
    );

  return result;
}

function hasSelectedPayment(
  detected,
  selected
) {
  if (!selected.length) {
    return true;
  }

  return selected.some(
    type => detected[type]
  );
}

function normalizePayments(value) {
  if (!Array.isArray(value)) {
    return [
      "bank",
      "easypaisa",
      "jazzcash"
    ];
  }

  return value
    .map(
      item =>
        String(item)
          .trim()
          .toLowerCase()
    )
    .filter(
      item =>
        [
          "bank",
          "easypaisa",
          "jazzcash",
          "crypto"
        ].includes(item)
    );
}

function analyzeTransparency(
  text,
  pages
) {
  const company =
    findMatches(text, [
      /\bcompany\b/i,
      /\bregistered\b/i,
      /\bregistration number\b/i,
      /\bhead office\b/i,
      /\bphysical address\b/i,
      /\bmanagement\b/i,
      /\bteam\b/i,
      /\bdirector\b/i
    ]);

  const legal =
    findMatches(text, [
      /\bprivacy policy\b/i,
      /\bterms(?: and conditions)?\b/i,
      /\brefund policy\b/i,
      /\brisk disclosure\b/i,
      /\blegal disclaimer\b/i,
      /\bcookie policy\b/i
    ]);

  const support =
    findMatches(text, [
      /\bsupport\b/i,
      /\bcontact us\b/i,
      /\bsupport@/i,
      /\bhelp desk\b/i,
      /\blive chat\b/i,
      /\bticket\b/i,
      /\bfaq\b/i,
      /\btelegram\b/i,
      /\bwhatsapp\b/i,
      /\bdiscord\b/i
    ]);

  return {
    company,
    legal,
    support,
    candidate: false,
    pagesChecked:
      pages.map(
        page => page.finalUrl
      )
  };
}

function findMatches(
  text,
  patterns
) {
  const result = [];

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      result.push(
        match[0]
      );
    }
  }

  return uniqueStrings(
    result
  );
}

function extractUsefulText(html) {
  return String(html || "")
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      40000
    );
}

function extractTitle(html) {
  const match =
    String(html || "")
      .match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

  return match
    ? cleanText(
        match[1]
      ).slice(0, 200)
    : null;
}

function extractMetaDescription(
  html
) {
  const match =
    String(html || "")
      .match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
      );

  return match
    ? cleanText(
        match[1]
      ).slice(0, 500)
    : null;
}

function extractRelevantLinks(
  html,
  baseUrl
) {
  const result = [];

  let base;

  try {
    base =
      new URL(baseUrl);
  } catch {
    return result;
  }

  const pattern =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match =
      pattern.exec(html)) !== null
  ) {
    try {
      const url =
        new URL(
          match[1],
          base.href
        );

      if (
        url.hostname !==
        base.hostname
      ) {
        continue;
      }

      const path =
        url.pathname.toLowerCase();

      if (
        RELEVANT_PATHS.some(
          allowed =>
            path === allowed ||
            path.startsWith(
              allowed + "/"
            )
        )
      ) {
        result.push(
          url.href
        );
      }

      if (
        result.length >=
        MAX_EXTRA_PAGES * 3
      ) {
        break;
      }

    } catch {
      // Ignore invalid links.
    }
  }

  return [
    ...new Set(result)
  ];
}

function extractRelevantSnippets(
  text
) {
  const result = [];

  const patterns = [
    ...INVESTMENT_PATTERNS,
    ...DAILY_RETURN_PATTERNS,
    ...ROI_PATTERNS,
    ...PAYMENT_PATTERNS.bank,
    ...PAYMENT_PATTERNS.easypaisa,
    ...PAYMENT_PATTERNS.jazzcash,
    ...PAYMENT_PATTERNS.crypto
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      pattern.exec(text);

    if (!match) continue;

    result.push(
      text.slice(
        Math.max(
          0,
          match.index - 120
        ),
        Math.min(
          text.length,
          match.index + 280
        )
      ).trim()
    );

    if (
      result.length >= 20
    ) {
      break;
    }
  }

  return uniqueStrings(
    result
  );
}

function collectMatches(
  text,
  patterns
) {
  const result = [];

  for (
    const pattern
    of patterns
  ) {
    const flags =
      pattern.flags.includes("g")
        ? pattern.flags
        : pattern.flags + "g";

    const matches =
      text.match(
        new RegExp(
          pattern.source,
          flags
        )
      );

    if (matches) {
      result.push(
        ...matches
      );
    }
  }

  return result;
}

function normalizeInputDomain(
  item
) {
  const source =
    typeof item === "string"
      ? item
      : item?.domain;

  if (!source) {
    return null;
  }

  let domain =
    String(source)
      .trim()
      .toLowerCase()
      .replace(
        /^https?:\/\//,
        ""
      )
      .split("/")[0]
      .split(":")[0]
      .replace(
        /^\*\./,
        ""
      );

  if (
    !isValidDomain(domain)
  ) {
    return null;
  }

  return {
    domain,

    registeredAt:
      typeof item === "object"
        ? item.registeredAt || null
        : null,

    discoveredAt:
      typeof item === "object"
        ? item.discoveredAt || null
        : null
  };
}

function uniqueDomains(
  items
) {
  const map =
    new Map();

  for (
    const item
    of items
  ) {
    if (
      !map.has(
        item.domain
      )
    ) {
      map.set(
        item.domain,
        item
      );
    }
  }

  return [
    ...map.values()
  ];
}

function isValidDomain(
  domain
) {
  if (
    !domain ||
    domain.length > 253
  ) {
    return false;
  }

  const labels =
    domain.split(".");

  if (
    labels.length < 2
  ) {
    return false;
  }

  return labels.every(
    label =>
      label &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-z0-9-]+$/i.test(
        label
      )
  );
}

function cleanText(value) {
  return String(value || "")
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function uniqueStrings(
  values
) {
  return [
    ...new Set(
      values
        .map(cleanText)
        .filter(Boolean)
    )
  ];
}

function combine(chunks) {
  const total =
    chunks.reduce(
      (sum, chunk) =>
        sum + chunk.length,
      0
    );

  const result =
    new Uint8Array(
      total
    );

  let offset = 0;

  for (
    const chunk
    of chunks
  ) {
    result.set(
      chunk,
      offset
    );

    offset +=
      chunk.length;
  }

  return result;
}

async function runWithConcurrency(
  items,
  limit,
  worker
) {
  let index = 0;

  async function runner() {
    while (true) {
      const current =
        index++;

      if (
        current >=
        items.length
      ) {
        return;
      }

      try {
        await worker(
          items[current]
        );
      } catch (error) {
        console.error(
          "Worker error:",
          error
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            limit,
            items.length
          )
      },
      () => runner()
    )
  );
      }
