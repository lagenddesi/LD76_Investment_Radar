"use strict";

/*
 * LD76 Investment Radar
 * api/scan.js
 *
 * Purpose:
 * - Check discovered domains
 * - Detect active websites
 * - Extract useful website text
 * - Detect investment / earning signals
 * - Detect selected payment methods
 * - Collect transparency evidence
 * - Return candidates for Gemini
 *
 * IMPORTANT:
 * Transparency information is EVIDENCE for Gemini.
 * Missing privacy/about/contact pages must NOT automatically
 * reject a domain.
 */

const MAX_DOMAINS_PER_REQUEST = 50;
const CONCURRENCY = 10;

const REQUEST_TIMEOUT_MS = 3500;
const MAX_HTML_BYTES = 300000;
const MAX_TEXT_CHARS = 70000;

const MAX_EXTRA_PAGES = 4;

/*
 * Investment / earning vocabulary.
 *
 * We deliberately use broad detection here.
 * Gemini will make the final Scam Score decision.
 */
const INVESTMENT_PATTERNS = [
  /\binvest(?:ment|ing)?\b/i,
  /\bdeposit\b/i,
  /\bdeposits\b/i,
  /\bprofit\b/i,
  /\bprofits\b/i,
  /\breturn\b/i,
  /\breturns\b/i,
  /\broi\b/i,
  /\bearning\b/i,
  /\bearnings\b/i,
  /\bearn\b/i,
  /\bincome\b/i,
  /\bpassive income\b/i,
  /\bwithdraw\b/i,
  /\bwithdrawal\b/i,
  /\bwithdrawals\b/i,
  /\bmaturity\b/i,
  /\binvestment plan\b/i,
  /\binvestment plans\b/i,
  /\bearning plan\b/i,
  /\bearning plans\b/i,
  /\bprofit plan\b/i,
  /\bprofit plans\b/i,
  /\breferral\b/i,
  /\baffiliate\b/i,
  /\bcommission\b/i,
  /\bteam income\b/i,
  /\bteam bonus\b/i,
  /\bbonus\b/i,
  /\bpassive earning\b/i,
  /\bpassive earnings\b/i,
  /\bfinancial freedom\b/i,
  /\bmake money\b/i,
  /\bget paid\b/i,
  /\bwealth\b/i,
  /\btrading\b/i,
  /\bstaking\b/i,
  /\byield\b/i,
  /\binterest\b/i,
  /\binvestor\b/i,
  /\binvestors\b/i,
  /\bfund\b/i,
  /\bfunds\b/i,
  /\bportfolio\b/i,
  /\bcapital\b/i,
  /\basset management\b/i,
  /\bforex\b/i,
  /\bforex trading\b/i,
  /\bcrypto investment\b/i,
  /\bcrypto earning\b/i
];

/*
 * Daily / periodic return claims.
 */
const DAILY_RETURN_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?day\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*daily\b/i,
  /\bdaily\s+(?:profit|return|income|earning|earnings)\b/i,
  /\b(?:profit|return|income|earning)\s+(?:of\s+)?\d+(?:\.\d+)?\s*%\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*per\s*week\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*weekly\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*per\s*month\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*monthly\b/i
];

/*
 * ROI patterns.
 */
const ROI_PATTERNS = [
  /\broi\b/i,
  /\breturn on investment\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:roi|return)\b/i,
  /\bprofit\s+rate\b/i,
  /\breturn\s+rate\b/i,
  /\bpercentage\s+return\b/i
];

/*
 * Payment methods.
 */
const PAYMENT_PATTERNS = {
  bank: [
    /\bbank transfer\b/i,
    /\bbank deposit\b/i,
    /\bbank account\b/i,
    /\baccount number\b/i,
    /\baccount title\b/i,
    /\baccount holder\b/i,
    /\bibAN\b/i,
    /\biban\b/i,
    /\bpkr\b/i,
    /\bpakistani rupees?\b/i,
    /\bpakistan bank\b/i,
    /\bbanking\b/i,
    /\bwire transfer\b/i
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
    /\bbtc\b/i,
    /\bethereum\b/i,
    /\beth\b/i,
    /\bcrypto\b/i,
    /\bcryptocurrency\b/i,
    /\bwallet address\b/i,
    /\bcrypto wallet\b/i,
    /\busdc\b/i,
    /\bsolana\b/i,
    /\btron\b/i
  ]
};

/*
 * Pages that commonly contain useful evidence.
 */
const RELEVANT_PATHS = [
  "/about",
  "/about-us",
  "/company",
  "/contact",
  "/contact-us",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/terms-and-conditions",
  "/legal",
  "/refund",
  "/refund-policy",
  "/risk",
  "/risk-disclosure",
  "/withdraw",
  "/withdrawal",
  "/deposit",
  "/investment",
  "/invest",
  "/plans",
  "/investment-plans",
  "/pricing",
  "/profit",
  "/earning",
  "/support",
  "/faq",
  "/referral",
  "/affiliate"
];

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const body = req.body || {};

    const rawDomains = Array.isArray(body.domains)
      ? body.domains
      : [];

    const selectedPayments = normalizePayments(
      body.paymentMethods
    );

    /*
     * We intentionally scan a reasonable batch because
     * Vercel serverless functions have execution limits.
     *
     * The candidate limit itself is NOT 4/5.
     */
    const domains = uniqueDomains(
      rawDomains
        .slice(0, MAX_DOMAINS_PER_REQUEST)
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
        candidates: []
      });
    }

    const scanResults = [];

    await runWithConcurrency(
      domains,
      CONCURRENCY,
      async domainItem => {
        const result = await scanDomain(
          domainItem
        );

        scanResults.push(result);
      }
    );

    /*
     * Only active websites continue.
     */
    const active = scanResults.filter(
      item => item.status === "active"
    );

    /*
     * Investment / earning relevance.
     */
    const investmentMatches = active.filter(
      item => item.investment.relevant
    );

    /*
     * Payment filter.
     *
     * If payment methods were selected,
     * at least one selected method must be detected.
     */
    const paymentMatches = investmentMatches.filter(
      item =>
        hasSelectedPayment(
          item.paymentMethods,
          selectedPayments
        )
    );

    /*
     * IMPORTANT:
     *
     * We do NOT require:
     * - company registration
     * - privacy policy
     * - terms
     * - contact page
     * - support page
     *
     * Those are evidence for Gemini.
     *
     * If investment + selected payment evidence exists,
     * the site is a candidate.
     */
    const candidates = paymentMatches
      .sort(
        (a, b) =>
          b.investment.score -
          a.investment.score
      );

    return res.status(200).json({
      ok: true,

      scanned: domains.length,

      active: active.length,

      investmentMatches:
        investmentMatches.length,

      paymentMatches:
        paymentMatches.length,

      candidates
    });

  } catch (error) {
    console.error(
      "LD76 scan error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Website scanning failed",
      message:
        error?.message ||
        "Unknown scanner error"
    });
  }
}

/* =========================================================
   DOMAIN SCANNER
========================================================= */

async function scanDomain(input) {
  const domain =
    normalizeDomain(
      input?.domain
    );

  const result = {
    domain,

    registeredAt:
      input?.registeredAt ||
      null,

    discoveredAt:
      input?.discoveredAt ||
      null,

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

  if (!domain) {
    result.errors.push(
      "Invalid domain"
    );

    return result;
  }

  /*
   * First try HTTPS.
   */
  let page = await fetchPage(
    `https://${domain}/`
  );

  /*
   * Fallback to HTTP.
   */
  if (!page.ok) {
    page = await fetchPage(
      `http://${domain}/`
    );
  }

  /*
   * Website unavailable.
   */
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
    Boolean(
      page.finalUrl?.startsWith(
        "https://"
      )
    );

  result.technical = {
    https: result.https,
    status: page.status,
    redirects:
      result.redirects.length
  };

  /*
   * Basic metadata.
   */
  result.title =
    extractTitle(
      page.text
    );

  result.websiteName =
    result.title ||
    domain;

  result.description =
    extractMetaDescription(
      page.text
    );

  /*
   * Find relevant internal links.
   */
  const internalLinks =
    extractRelevantLinks(
      page.text,
      page.finalUrl ||
        `https://${domain}/`
    );

  /*
   * Add known paths if they exist in
   * the page links, then fetch a small number.
   */
  const extraUrls =
    uniqueStrings([
      ...internalLinks,
      ...buildRelevantPathUrls(
        domain,
        page.finalUrl
      )
    ]).slice(
      0,
      MAX_EXTRA_PAGES
    );

  const pages = [page];

  /*
   * Fetch extra pages concurrently.
   */
  const extraResults =
    await Promise.all(
      extraUrls.map(
        url =>
          fetchPage(url)
      )
    );

  for (
    const extraPage
    of extraResults
  ) {
    if (extraPage.ok) {
      pages.push(
        extraPage
      );
    }
  }

  result.pagesChecked =
    uniqueStrings(
      pages.map(
        item =>
          item.finalUrl
      )
    );

  /*
   * Extract readable text from every page.
   */
  const combinedText =
    pages
      .map(
        item =>
          extractUsefulText(
            item.text
          )
      )
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(
        0,
        MAX_TEXT_CHARS
      );

  result.content =
    combinedText;

  /*
   * Investment detection.
   */
  result.investment =
    analyzeInvestmentContent(
      combinedText
    );

  /*
   * Payment detection.
   */
  result.paymentMethods =
    detectPaymentMethods(
      combinedText
    );

  /*
   * Transparency evidence.
   */
  result.transparency =
    analyzeTransparency(
      combinedText
    );

  /*
   * Small useful evidence snippets.
   */
  result.snippets =
    extractRelevantSnippets(
      combinedText
    );

  /*
   * Candidate logic:
   *
   * Investment relevance +
   * at least one detected payment method.
   *
   * Transparency does NOT block candidate.
   */
  result.transparency.candidate =
    result.investment.relevant &&
    result.paymentMethods.detected
      .length > 0;

  return result;
}

/* =========================================================
   FETCH PAGE
========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; LD76-Investment-Radar/1.0)",

            Accept:
              "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
          }
        }
      );

    clearTimeout(
      timer
    );

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    /*
     * HTML and XHTML are useful.
     */
    const isHtml =
      contentType.includes(
        "text/html"
      ) ||
      contentType.includes(
        "application/xhtml+xml"
      ) ||
      contentType.includes(
        "text/plain"
      );

    if (!isHtml) {
      return {
        ok: false,
        status:
          response.status,
        finalUrl:
          response.url,
        error:
          `Unsupported content type: ${contentType}`
      };
    }

    /*
     * Read body with a size limit.
     */
    const reader =
      response.body?.getReader();

    if (!reader) {
      return {
        ok: false,
        status:
          response.status,
        finalUrl:
          response.url,
        error:
          "Response body unavailable"
      };
    }

    const chunks = [];

    let totalBytes = 0;

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

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        MAX_HTML_BYTES
      ) {
        try {
          await reader.cancel();
        } catch {}

        break;
      }

      chunks.push(
        value
      );
    }

    const bytes =
      combineUint8Arrays(
        chunks
      );

    const text =
      new TextDecoder(
        "utf-8",
        {
          fatal: false
        }
      ).decode(
        bytes
      );

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
    clearTimeout(
      timer
    );

    return {
      ok: false,

      error:
        error?.name ===
        "AbortError"
          ? "Request timeout"
          : (
              error?.message ||
              "Request failed"
            )
    };
  }
}

/* =========================================================
   INVESTMENT ANALYSIS
========================================================= */

function analyzeInvestmentContent(
  text
) {
  const keywords = [];

  for (
    const pattern
    of INVESTMENT_PATTERNS
  ) {
    const match =
      text.match(
        pattern
      );

    if (match) {
      keywords.push(
        match[0]
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

  /*
   * Internal relevance score.
   * This is NOT the Gemini Scam Score.
   */

  if (keywords.length > 0) {
    score += 10;
  }

  if (
    dailyReturnClaims.length > 0
  ) {
    score += 15;
  }

  if (
    roiClaims.length > 0
  ) {
    score += 15;
  }

  if (
    /\bdeposit\b/i.test(text)
  ) {
    score += 10;
  }

  if (
    /\bwithdraw(?:al)?\b/i.test(
      text
    )
  ) {
    score += 10;
  }

  if (
    /\b(?:referral|affiliate|commission)\b/i.test(
      text
    )
  ) {
    score += 10;
  }

  if (
    /\b(?:guaranteed|fixed)\s+(?:profit|return|income|earning)\b/i.test(
      text
    )
  ) {
    score += 15;
  }

  /*
   * Broad investment relevance.
   */
  const relevant =
    keywords.length > 0 &&
    (
      /\b(?:invest|investment|investing|deposit|profit|roi|return|earning|earnings|income|withdraw|withdrawal|yield|staking|trading|forex)\b/i.test(
        text
      )
    );

  return {
    relevant,

    score,

    keywords:
      uniqueStrings(
        keywords
      ).slice(
        0,
        50
      ),

    dailyReturnClaims:
      uniqueStrings(
        dailyReturnClaims
      ).slice(
        0,
        30
      ),

    roiClaims:
      uniqueStrings(
        roiClaims
      ).slice(
        0,
        30
      )
  };
}

/* =========================================================
   PAYMENT DETECTION
========================================================= */

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
    const type
    of Object.keys(
      PAYMENT_PATTERNS
    )
  ) {
    result[type] =
      PAYMENT_PATTERNS[
        type
      ].some(
        pattern =>
          pattern.test(
            text
          )
      );
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
  /*
   * No selected filter means don't block
   * the candidate.
   */
  if (!selected.length) {
    return true;
  }

  return selected.some(
    type =>
      Boolean(
        detected?.[type]
      )
  );
}

function normalizePayments(
  value
) {
  if (!Array.isArray(value)) {
    return [
      "bank",
      "easypaisa",
      "jazzcash"
    ];
  }

  return uniqueStrings(
    value.map(
      item =>
        String(item)
          .trim()
          .toLowerCase()
    )
  ).filter(
    item =>
      [
        "bank",
        "easypaisa",
        "jazzcash",
        "crypto"
      ].includes(item)
  );
}

/* =========================================================
   TRANSPARENCY ANALYSIS
========================================================= */

function analyzeTransparency(
  text
) {
  const company =
    findMatches(
      text,
      [
        /\bcompany\b/i,
        /\bregistered company\b/i,
        /\bregistration number\b/i,
        /\bcompany registration\b/i,
        /\bcorporation\b/i,
        /\blimited\b/i,
        /\bllc\b/i,
        /\bhead office\b/i,
        /\bphysical address\b/i,
        /\bmanagement\b/i,
        /\bmanagement team\b/i,
        /\bdirector\b/i,
        /\bteam\b/i
      ]
    );

  const legal =
    findMatches(
      text,
      [
        /\bprivacy policy\b/i,
        /\bterms and conditions\b/i,
        /\bterms of service\b/i,
        /\bterms\b/i,
        /\brefund policy\b/i,
        /\brisk disclosure\b/i,
        /\blegal disclaimer\b/i,
        /\bcookie policy\b/i,
        /\bdisclaimer\b/i
      ]
    );

  const support =
    findMatches(
      text,
      [
        /\bcontact us\b/i,
        /\bcontact\b/i,
        /\bsupport\b/i,
        /\bsupport email\b/i,
        /\bhelp desk\b/i,
        /\blive chat\b/i,
        /\bticket\b/i,
        /\btelegram\b/i,
        /\bwhatsapp\b/i,
        /\bdiscord\b/i,
        /\bfaq\b/i,
        /\bphone\b/i,
        /\btelephone\b/i
      ]
    );

  return {
    company:
      uniqueStrings(
        company
      ).slice(
        0,
        20
      ),

    legal:
      uniqueStrings(
        legal
      ).slice(
        0,
        20
      ),

    support:
      uniqueStrings(
        support
      ).slice(
        0,
        20
      ),

    /*
     * This is informational only.
     * It does NOT decide candidate eligibility.
     */
    candidate: false
  };
}

/* =========================================================
   RELEVANT LINKS
========================================================= */

function extractRelevantLinks(
  html,
  baseUrl
) {
  const urls = [];

  if (!html) {
    return urls;
  }

  const hrefRegex =
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match =
      hrefRegex.exec(
        html
      )) !== null
  ) {
    const raw =
      match[1];

    if (!raw) {
      continue;
    }

    const lower =
      raw.toLowerCase();

    const relevant =
      RELEVANT_PATHS.some(
        path =>
          lower.includes(
            path
          )
      );

    if (!relevant) {
      continue;
    }

    try {
      const url =
        new URL(
          raw,
          baseUrl
        );

      /*
       * Only same-origin pages.
       */
      const base =
        new URL(
          baseUrl
        );

      if (
        url.hostname !==
        base.hostname
      ) {
        continue;
      }

      url.hash = "";

      urls.push(
        url.href
      );

    } catch {
      continue;
    }
  }

  return uniqueStrings(
    urls
  );
}

/* =========================================================
   BUILD KNOWN PATH URLS
========================================================= */

function buildRelevantPathUrls(
  domain,
  finalUrl
) {
  const urls = [];

  let origin =
    `https://${domain}`;

  try {
    if (finalUrl) {
      origin =
        new URL(
          finalUrl
        ).origin;
    }
  } catch {}

  for (
    const path
    of RELEVANT_PATHS
  ) {
    urls.push(
      `${origin}${path}`
    );
  }

  return urls;
}

/* =========================================================
   TEXT EXTRACTION
========================================================= */

function extractUsefulText(
  html
) {
  if (!html) {
    return "";
  }

  let text =
    String(html);

  /*
   * Remove scripts/styles/noscript.
   */
  text =
    text.replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    );

  text =
    text.replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    );

  text =
    text.replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
      " "
    );

  text =
    text.replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
      " "
    );

  /*
   * Convert common HTML separators to spaces.
   */
  text =
    text.replace(
      /<\/(?:p|div|section|article|li|h1|h2|h3|h4|h5|h6|br|tr|td)>/gi,
      " "
    );

  /*
   * Remove tags.
   */
  text =
    text.replace(
      /<[^>]+>/g,
      " "
    );

  /*
   * Decode common HTML entities.
   */
  text =
    decodeHtmlEntities(
      text
    );

  /*
   * Normalize whitespace.
   */
  text =
    text
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return text.slice(
    0,
    MAX_TEXT_CHARS
  );
}

function extractTitle(
  html
) {
  if (!html) {
    return null;
  }

  const match =
    html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) {
    return null;
  }

  const title =
    decodeHtmlEntities(
      match[1]
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return title
    ? title.slice(
        0,
        300
      )
    : null;
}

function extractMetaDescription(
  html
) {
  if (!html) {
    return null;
  }

  const patterns = [
    /<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,

    /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      html.match(
        pattern
      );

    if (match) {
      const description =
        decodeHtmlEntities(
          match[1]
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (description) {
        return description.slice(
          0,
          500
        );
      }
    }
  }

  return null;
}

/* =========================================================
   SNIPPETS
========================================================= */

function extractRelevantSnippets(
  text
) {
  const snippets = [];

  const patterns = [
    /\binvest(?:ment|ing)?\b/i,
    /\bdeposit\b/i,
    /\bprofit\b/i,
    /\broi\b/i,
    /\breturn\b/i,
    /\bearning\b/i,
    /\bwithdraw(?:al)?\b/i,
    /\beasypaisa\b/i,
    /\bjazzcash\b/i,
    /\bbank transfer\b/i,
    /\busdt\b/i,
    /\btrc20\b/i,
    /\breferral\b/i
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      pattern.exec(
        text
      );

    if (!match) {
      continue;
    }

    const start =
      Math.max(
        0,
        match.index - 160
      );

    const end =
      Math.min(
        text.length,
        match.index +
          300
      );

    snippets.push(
      text
        .slice(
          start,
          end
        )
        .trim()
    );
  }

  return uniqueStrings(
    snippets
  ).slice(
    0,
    20
  );
}

/* =========================================================
   DOMAIN NORMALIZATION
========================================================= */

function normalizeInputDomain(
  item
) {
  if (!item) {
    return null;
  }

  if (
    typeof item ===
    "string"
  ) {
    return {
      domain:
        normalizeDomain(
          item
        )
    };
  }

  if (
    typeof item ===
    "object"
  ) {
    const domain =
      normalizeDomain(
        item.domain
      );

    if (!domain) {
      return null;
    }

    return {
      ...item,
      domain
    };
  }

  return null;
}

function normalizeDomain(
  value
) {
  if (!value) {
    return "";
  }

  let domain =
    String(value)
      .trim()
      .toLowerCase();

  domain =
    domain.replace(
      /^https?:\/\//,
      ""
    );

  domain =
    domain.replace(
      /^www\./,
      ""
    );

  domain =
    domain.split(
      "/"
    )[0];

  domain =
    domain.split(
      "?"
    )[0];

  domain =
    domain.split(
      "#"
    )[0];

  domain =
    domain.trim();

  /*
   * Remove accidental trailing dot.
   */
  domain =
    domain.replace(
      /\.$/,
      ""
    );

  return domain;
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
    if (!item) {
      continue;
    }

    const domain =
      normalizeDomain(
        item.domain
      );

    if (!domain) {
      continue;
    }

    if (!map.has(domain)) {
      map.set(
        domain,
        {
          ...item,
          domain
        }
      );
    }
  }

  return Array.from(
    map.values()
  );
}

/* =========================================================
   MATCH HELPERS
========================================================= */

function collectMatches(
  text,
  patterns
) {
  const matches = [];

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(
        pattern
      );

    if (match) {
      matches.push(
        match[0]
      );
    }
  }

  return matches;
}

function findMatches(
  text,
  patterns
) {
  const matches = [];

  for (
    const pattern
    of patterns
  ) {
    const match =
      text.match(
        pattern
      );

    if (match) {
      matches.push(
        match[0]
      );
    }
  }

  return matches;
}

function uniqueStrings(
  items
) {
  return Array.from(
    new Set(
      (items || [])
        .filter(Boolean)
        .map(
          item =>
            String(item)
              .trim()
        )
        .filter(Boolean)
    )
  );
}

/* =========================================================
   HTML ENTITY DECODER
========================================================= */

function decodeHtmlEntities(
  value
) {
  if (!value) {
    return "";
  }

  return String(value)
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
      /&#39;|&apos;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCharCode(
          parseInt(
            code,
            16
          )
        )
    );
}

/* =========================================================
   UINT8 ARRAY HELPER
========================================================= */

function combineUint8Arrays(
  arrays
) {
  const total =
    arrays.reduce(
      (sum, item) =>
        sum +
        item.byteLength,
      0
    );

  const result =
    new Uint8Array(
      total
    );

  let offset = 0;

  for (
    const array
    of arrays
  ) {
    result.set(
      array,
      offset
    );

    offset +=
      array.byteLength;
  }

  return result;
}

/* =========================================================
   CONCURRENCY
========================================================= */

async function runWithConcurrency(
  items,
  concurrency,
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

  const workerCount =
    Math.min(
      concurrency,
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      () =>
        runner()
    )
  );
}
