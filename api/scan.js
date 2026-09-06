const MAX_DOMAINS = 150;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 700000;

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

const PAKISTAN_PAYMENT_PATTERNS = {
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
    /\bcrypto wallet\b/i,
    /\bwallet address\b/i,
    /\bpaypal\b/i
  ]
};

const PATHS = [
  "/",
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

    const inputDomains = Array.isArray(body.domains)
      ? body.domains
      : [];

    const paymentMethods = normalizePaymentMethods(
      body.paymentMethods
    );

    if (!inputDomains.length) {
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

    const domains = uniqueDomains(
      inputDomains
        .slice(0, MAX_DOMAINS)
        .map(normalizeInputDomain)
        .filter(Boolean)
    );

    const scanResults = [];

    await runWithConcurrency(
      domains,
      CONCURRENCY,
      async item => {
        const result =
          await scanDomain(item);

        scanResults.push(result);
      }
    );

    const activeResults =
      scanResults.filter(
        result => result.status === "active"
      );

    const investmentResults =
      activeResults.filter(
        result =>
          result.investment.relevant === true
      );

    const paymentResults =
      investmentResults.filter(
        result =>
          hasSelectedPayment(
            result.paymentMethods,
            paymentMethods
          )
      );

    const transparencyCandidates =
      paymentResults.filter(
        result =>
          result.transparency.candidate === true
      );

    return res.status(200).json({
      ok: true,

      scanned: domains.length,

      active: activeResults.length,

      investmentMatches:
        investmentResults.length,

      paymentMatches:
        paymentResults.length,

      transparencyCandidates:
        transparencyCandidates.length,

      candidates:
        transparencyCandidates
    });

  } catch (error) {
    console.error(
      "Scan error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Website scanning failed"
    });
  }
}


/* -------------------------------------------------- */
/* DOMAIN SCANNING                                    */
/* -------------------------------------------------- */

async function scanDomain(input) {
  const domain =
    typeof input === "string"
      ? input
      : input.domain;

  const discoveredAt =
    typeof input === "object"
      ? input.discoveredAt || null
      : null;

  const registeredAt =
    typeof input === "object"
      ? input.registeredAt || null
      : null;

  const baseResult = {
    domain,

    registeredAt,

    discoveredAt,

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

  /*
   * First check the homepage.
   */
  const homepage =
    await fetchPage(
      `https://${domain}/`
    );

  if (!homepage.ok) {
    /*
     * Try HTTP as a fallback.
     *
     * An HTTP failure is NOT automatically
     * treated as suspicious.
     */
    const httpPage =
      await fetchPage(
        `http://${domain}/`
      );

    if (!httpPage.ok) {
      baseResult.errors =
        [homepage.error, httpPage.error]
          .filter(Boolean);

      return baseResult;
    }

    return processPages(
      baseResult,
      httpPage,
      domain
    );
  }

  return processPages(
    baseResult,
    homepage,
    domain
  );
}


/* -------------------------------------------------- */
/* PAGE PROCESSING                                    */
/* -------------------------------------------------- */

async function processPages(
  result,
  homepage,
  domain
) {
  result.status = "active";

  result.httpStatus =
    homepage.status;

  result.finalUrl =
    homepage.finalUrl;

  result.redirects =
    homepage.redirects;

  result.https =
    homepage.finalUrl
      ? homepage.finalUrl
          .startsWith("https://")
      : true;

  result.technical.https =
    result.https;

  result.technical.status =
    homepage.status;

  result.technical.redirects =
    homepage.redirects.length;

  result.title =
    extractTitle(homepage.text);

  result.websiteName =
    extractWebsiteName(
      result.title,
      domain
    );

  result.description =
    extractMetaDescription(
      homepage.text
    );

  /*
   * Only follow a limited set of useful
   * pages discovered from the homepage.
   */
  const discoveredLinks =
    extractRelevantLinks(
      homepage.text,
      homepage.finalUrl || `https://${domain}`
    );

  const urls = [
    homepage.finalUrl ||
      `https://${domain}`,
    ...discoveredLinks
  ];

  const uniqueUrls =
    Array.from(
      new Set(urls)
    ).slice(0, PATHS.length + 1);

  const pages = [
    homepage
  ];

  for (const url of uniqueUrls.slice(1)) {
    const page =
      await fetchPage(url);

    if (!page.ok) {
      continue;
    }

    pages.push(page);
  }

  result.pagesChecked =
    pages.map(
      page => page.finalUrl
    );

  /*
   * Combine only bounded text.
   */
  const combinedText =
    pages
      .map(page =>
        extractUsefulText(
          page.text
        )
      )
      .join("\n\n")
      .slice(0, 450000);

  result.content =
    combinedText;

  result.investment =
    analyzeInvestmentContent(
      combinedText
    );

  result.paymentMethods =
    detectPaymentMethods(
      combinedText
    );

  result.transparency =
    analyzeTransparency(
      combinedText,
      pages
    );

  result.snippets =
    extractRelevantSnippets(
      combinedText
    );

  /*
   * A site must first look like an
   * investment/earning website and also
   * contain at least one selected payment
   * signal before reaching the final list.
   */
  result.transparency.candidate =
    result.investment.relevant &&
    result.paymentMethods.detected.length > 0;

  return result;
}


/* -------------------------------------------------- */
/* HTTP FETCH                                         */
/* -------------------------------------------------- */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
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
          "Accept":
            "text/html,application/xhtml+xml"
        }
      });

    clearTimeout(timeout);

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return {
        ok: false,
        error:
          `Unsupported content type: ${contentType}`,
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
        error: "Response body unavailable",
        status: response.status,
        finalUrl: response.url
      };
    }

    const chunks = [];
    let total = 0;

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      total += value.length;

      if (
        total >
        MAX_HTML_BYTES
      ) {
        try {
          await reader.cancel();
        } catch (error) {
          // Ignore cancellation error.
        }

        break;
      }

      chunks.push(value);
    }

    const bytes =
      combineUint8Arrays(
        chunks
      );

    const text =
      new TextDecoder(
        "utf-8"
      ).decode(bytes);

    return {
      ok:
        response.ok,

      status:
        response.status,

      finalUrl:
        response.url,

      redirects: [],

      text
    };

  } catch (error) {
    clearTimeout(timeout);

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


/* -------------------------------------------------- */
/* INVESTMENT ANALYSIS                                */
/* -------------------------------------------------- */

function analyzeInvestmentContent(
  text
) {
  const keywords = [];

  for (
    const pattern
    of INVESTMENT_PATTERNS
  ) {
    const matches =
      text.match(
        pattern
      );

    if (matches) {
      keywords.push(
        matches[0]
      );
    }
  }

  const dailyReturnClaims =
    collectMatches(
      text,
      DAILY_RETURN_PATTERNS
    );

  const roiClaims =
    collectMatches(
      text,
      ROI_PATTERNS
    );

  let score = 0;

  if (keywords.length > 0) {
    score += 10;
  }

  if (
    dailyReturnClaims.length
  ) {
    score += 15;
  }

  if (
    roiClaims.length
  ) {
    score += 15;
  }

  if (
    /\bdeposit\b/i.test(text)
  ) {
    score += 10;
  }

  if (
    /\bwithdraw(?:al)?\b/i.test(text)
  ) {
    score += 10;
  }

  if (
    /\breferral\b|\baffiliate\b|\bcommission\b/i
      .test(text)
  ) {
    score += 10;
  }

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
        dailyReturnClaims
      ).slice(0, 20),

    roiClaims:
      uniqueStrings(
        roiClaims
      ).slice(0, 20)
  };
}


/* -------------------------------------------------- */
/* PAYMENT METHODS                                    */
/* -------------------------------------------------- */

function detectPaymentMethods(
  text
) {
  const result = {
    bank: false,
    easypaisa: false,
    jazzcash: false,
    crypto: false,
    detected: []
  };

  for (
    const pattern
    of PAKISTAN_PAYMENT_PATTERNS.bank
  ) {
    if (pattern.test(text)) {
      result.bank = true;
      break;
    }
  }

  for (
    const pattern
    of PAKISTAN_PAYMENT_PATTERNS.easypaisa
  ) {
    if (pattern.test(text)) {
      result.easypaisa = true;
      break;
    }
  }

  for (
    const pattern
    of PAKISTAN_PAYMENT_PATTERNS.jazzcash
  ) {
    if (pattern.test(text)) {
      result.jazzcash = true;
      break;
    }
  }

  for (
    const pattern
    of PAKISTAN_PAYMENT_PATTERNS.crypto
  ) {
    if (pattern.test(text)) {
      result.crypto = true;
      break;
    }
  }

  if (result.bank) {
    result.detected.push(
      "Bank"
    );
  }

  if (result.easypaisa) {
    result.detected.push(
      "Easypaisa"
    );
  }

  if (result.jazzcash) {
    result.detected.push(
      "JazzCash"
    );
  }

  if (result.crypto) {
    result.detected.push(
      "Crypto"
    );
  }

  return result;
}


function hasSelectedPayment(
  detected,
  selected
) {
  if (!selected.length) {
    return true;
  }

  if (
    selected.includes("bank") &&
    detected.bank
  ) {
    return true;
  }

  if (
    selected.includes("easypaisa") &&
    detected.easypaisa
  ) {
    return true;
  }

  if (
    selected.includes("jazzcash") &&
    detected.jazzcash
  ) {
    return true;
  }

  if (
    selected.includes("crypto") &&
    detected.crypto
  ) {
    return true;
  }

  return false;
}


function normalizePaymentMethods(
  value
) {
  if (!Array.isArray(value)) {
    return [
      "bank",
      "easypaisa",
      "jazzcash"
    ];
  }

  return value
    .map(item =>
      String(item)
        .trim()
        .toLowerCase()
    )
    .filter(item =>
      [
        "bank",
        "easypaisa",
        "jazzcash",
        "crypto"
      ].includes(item)
    );
}


/* -------------------------------------------------- */
/* TRANSPARENCY / SUPPORT                             */
/* -------------------------------------------------- */

function analyzeTransparency(
  text,
  pages
) {
  const company = [];
  const legal = [];
  const support = [];

  const companyPatterns = [
    /\bcompany\b/i,
    /\bregistered\b/i,
    /\bregistration number\b/i,
    /\bhead office\b/i,
    /\bphysical address\b/i,
    /\bmanagement\b/i,
    /\bteam\b/i,
    /\bdirector\b/i
  ];

  const legalPatterns = [
    /\bprivacy policy\b/i,
    /\bterms(?: and conditions)?\b/i,
    /\brefund policy\b/i,
    /\brisk disclosure\b/i,
    /\blegal disclaimer\b/i,
    /\bcookie policy\b/i
  ];

  const supportPatterns = [
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
  ];

  for (
    const pattern
    of companyPatterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      company.push(
        match[0]
      );
    }
  }

  for (
    const pattern
    of legalPatterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      legal.push(
        match[0]
      );
    }
  }

  for (
    const pattern
    of supportPatterns
  ) {
    const match =
      text.match(pattern);

    if (match) {
      support.push(
        match[0]
      );
    }
  }

  /*
   * A candidate means the site has enough
   * investment/payment evidence to continue.
   * Missing transparency is evidence for Gemini,
   * not an automatic scam conclusion.
   */
  return {
    company:
      uniqueStrings(company),

    legal:
      uniqueStrings(legal),

    support:
      uniqueStrings(support),

    candidate: false,

    pagesChecked:
      pages.map(
        page => page.finalUrl
      )
  };
}


/* -------------------------------------------------- */
/* TEXT EXTRACTION                                    */
/* -------------------------------------------------- */

function extractUsefulText(
  html
) {
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
    .slice(0, 120000);
}


function extractTitle(
  html
) {
  const match =
    String(html || "")
      .match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

  if (!match) {
    return null;
  }

  return cleanText(
    match[1]
  ).slice(0, 200);
}


function extractMetaDescription(
  html
) {
  const match =
    String(html || "")
      .match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
      );

  if (!match) {
    return null;
  }

  return cleanText(
    match[1]
  ).slice(0, 500);
}


function extractWebsiteName(
  title,
  domain
) {
  if (title) {
    return title;
  }

  return domain;
}


/* -------------------------------------------------- */
/* LINK DISCOVERY                                     */
/* -------------------------------------------------- */

function extractRelevantLinks(
  html,
  baseUrl
) {
  const results = [];

  const base =
    new URL(baseUrl);

  const pattern =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = pattern.exec(html)) !== null
  ) {
    const href =
      match[1];

    try {
      const url =
        new URL(
          href,
          base.href
        );

      if (
        url.hostname !==
        base.hostname
      ) {
        continue;
      }

      const path =
        url.pathname
          .toLowerCase();

      const isRelevant =
        PATHS.some(
          allowed =>
            path === allowed ||
            path.startsWith(
              allowed + "/"
            )
        );

      if (!isRelevant) {
        continue;
      }

      results.push(
        url.href
      );

      if (results.length >= 15) {
        break;
      }

    } catch (error) {
      // Ignore malformed links.
    }
  }

  return results;
}


/* -------------------------------------------------- */
/* RELEVANT SNIPPETS                                  */
/* -------------------------------------------------- */

function extractRelevantSnippets(
  text
) {
  const snippets = [];

  const patterns = [
    ...INVESTMENT_PATTERNS,
    ...DAILY_RETURN_PATTERNS,
    ...ROI_PATTERNS,
    ...PAKISTAN_PAYMENT_PATTERNS.bank,
    ...PAKISTAN_PAYMENT_PATTERNS.easypaisa,
    ...PAKISTAN_PAYMENT_PATTERNS.jazzcash,
    ...PAKISTAN_PAYMENT_PATTERNS.crypto
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      pattern.exec(text);

    if (!match) {
      continue;
    }

    const index =
      match.index;

    const start =
      Math.max(
        0,
        index - 140
      );

    const end =
      Math.min(
        text.length,
        index + 260
      );

    snippets.push(
      text
        .slice(start, end)
        .trim()
    );

    if (snippets.length >= 25) {
      break;
    }
  }

  return uniqueStrings(
    snippets
  );
}


function collectMatches(
  text,
  patterns
) {
  const matches = [];

  for (
    const pattern
    of patterns
  ) {
    const found =
      text.match(
        new RegExp(
          pattern.source,
          pattern.flags.includes("g")
            ? pattern.flags
            : pattern.flags + "g"
        )
      );

    if (found) {
      matches.push(
        ...found
      );
    }
  }

  return matches;
}


/* -------------------------------------------------- */
/* CONCURRENCY                                        */
/* -------------------------------------------------- */

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
        current >= items.length
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

  const workers =
    Array.from(
      {
        length:
          Math.min(
            limit,
            items.length
          )
      },
      () => runner()
    );

  await Promise.all(
    workers
  );
}


/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

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
      .toLowerCase();

  domain =
    domain
      .replace(
        /^https?:\/\//,
        ""
      )
      .split("/")[0]
      .split(":")[0]
      .replace(/^\*\./, "");

  if (
    !isValidDomain(domain)
  ) {
    return null;
  }

  if (
    typeof item === "object"
  ) {
    return {
      domain,
      registeredAt:
        item.registeredAt ||
        null,
      discoveredAt:
        item.discoveredAt ||
        null
    };
  }

  return {
    domain,
    registeredAt: null,
    discoveredAt: null
  };
}


function uniqueDomains(
  items
) {
  const map =
    new Map();

  for (const item of items) {
    if (
      !map.has(item.domain)
    ) {
      map.set(
        item.domain,
        item
      );
    }
  }

  return Array.from(
    map.values()
  );
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

  for (
    const label
    of labels
  ) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return false;
    }

    if (
      !/^[a-z0-9-]+$/i.test(
        label
      )
    ) {
      return false;
    }
  }

  return true;
}


function cleanText(
  value
) {
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
  return Array.from(
    new Set(
      values
        .map(cleanText)
        .filter(Boolean)
    )
  );
}


function combineUint8Arrays(
  chunks
) {
  const totalLength =
    chunks.reduce(
      (sum, chunk) =>
        sum + chunk.length,
      0
    );

  const result =
    new Uint8Array(
      totalLength
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
