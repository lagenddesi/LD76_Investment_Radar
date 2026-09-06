"use strict";

/*
 * LD76 Investment Radar
 * Website scanner
 *
 * Strategy:
 * 1. Scan all supplied domains in parallel.
 * 2. Inspect raw HTML + extracted text + URLs.
 * 3. Detect investment/earning signals.
 * 4. Detect selected payment methods.
 * 5. Only promising domains receive deeper page scans.
 *
 * No artificial 4/5 candidate limit.
 */

const CONCURRENCY = 25;

const REQUEST_TIMEOUT_MS = 4500;

const MAX_HTML_BYTES = 350000;

const MAX_TEXT_CHARS = 90000;

const MAX_DEEP_PAGES = 8;


/* -------------------------------------------------------
 * INVESTMENT / EARNING SIGNALS
 * ----------------------------------------------------- */

const INVESTMENT_PATTERNS = [
  /\binvest\b/i,
  /\binvestment\b/i,
  /\binvesting\b/i,
  /\binvestor\b/i,
  /\binvestors\b/i,

  /\bdeposit\b/i,
  /\bdeposits\b/i,
  /\bdeposit\s+funds?\b/i,

  /\bprofit\b/i,
  /\bprofits\b/i,
  /\bprofit\s+plan\b/i,
  /\bprofit\s+plans\b/i,

  /\breturn\b/i,
  /\breturns\b/i,
  /\breturn\s+on\s+investment\b/i,

  /\broi\b/i,

  /\bearning\b/i,
  /\bearnings\b/i,
  /\bearn\b/i,

  /\bincome\b/i,
  /\bpassive\s+income\b/i,
  /\bpassive\s+earning\b/i,
  /\bpassive\s+earnings\b/i,

  /\bwithdraw\b/i,
  /\bwithdrawal\b/i,
  /\bwithdrawals\b/i,

  /\bmaturity\b/i,

  /\binvestment\s+plan\b/i,
  /\binvestment\s+plans\b/i,

  /\bearning\s+plan\b/i,
  /\bearning\s+plans\b/i,

  /\bprofit\s+rate\b/i,
  /\breturn\s+rate\b/i,

  /\breferral\b/i,
  /\baffiliate\b/i,
  /\bcommission\b/i,

  /\binvite\s+and\s+earn\b/i,
  /\bteam\s+income\b/i,
  /\bteam\s+bonus\b/i,

  /\bbonus\b/i,
  /\breward\b/i,

  /\bmake\s+money\b/i,
  /\bget\s+paid\b/i,
  /\bfinancial\s+freedom\b/i,

  /\btrading\b/i,
  /\bforex\b/i,
  /\bforex\s+trading\b/i,

  /\bstaking\b/i,
  /\byield\b/i,

  /\bcrypto\s+investment\b/i,
  /\bcrypto\s+earning\b/i,

  /\bwealth\b/i,
  /\bcapital\b/i,
  /\bportfolio\b/i,
  /\bfund\b/i,
  /\bfunds\b/i,
  /\basset\s+management\b/i
];


/* -------------------------------------------------------
 * DAILY / ROI CLAIMS
 * ----------------------------------------------------- */

const DAILY_RETURN_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?day\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*daily\b/i,
  /\bdaily\s+profit\b/i,
  /\bdaily\s+return\b/i,
  /\bdaily\s+income\b/i,
  /\bdaily\s+earning\b/i,
  /\bdaily\s+earnings\b/i,

  /\b\d+(?:\.\d+)?\s*%\s*per\s*week\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*weekly\b/i,

  /\b\d+(?:\.\d+)?\s*%\s*per\s*month\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*monthly\b/i,

  /\bprofit\s+of\s+\d+(?:\.\d+)?\s*%\b/i,
  /\breturn\s+of\s+\d+(?:\.\d+)?\s*%\b/i,

  /\bguaranteed\s+profit\b/i,
  /\bguaranteed\s+return\b/i,
  /\bguaranteed\s+income\b/i,
  /\bfixed\s+profit\b/i,
  /\bfixed\s+return\b/i,
  /\bfixed\s+income\b/i
];

const ROI_PATTERNS = [
  /\broi\b/i,
  /\breturn\s+on\s+investment\b/i,
  /\bprofit\s+rate\b/i,
  /\breturn\s+rate\b/i,
  /\bpercentage\s+return\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:roi|return|profit)\b/i
];


/* -------------------------------------------------------
 * PAYMENT METHODS
 * ----------------------------------------------------- */

const PAYMENT_PATTERNS = {
  bank: [
    /\bbank\s+transfer\b/i,
    /\bbank\s+deposit\b/i,
    /\bbank\s+account\b/i,
    /\bbank\s+details\b/i,
    /\bbank\s+payment\b/i,
    /\bbank\s+deposit\b/i,
    /\baccount\s+number\b/i,
    /\baccount\s+title\b/i,
    /\baccount\s+holder\b/i,
    /\baccount\s+name\b/i,
    /\bibAN\b/i,
    /\biban\b/i,
    /\bpkr\b/i,
    /\bpakistani\s+rupees?\b/i,
    /\bpakistan\s+bank\b/i,
    /\bwire\s+transfer\b/i,
    /\bwire\s+payment\b/i,
    /\bhabib\s+bank\b/i,
    /\bhbl\b/i,
    /\bmeezan\b/i,
    /\bubl\b/i,
    /\bmcb\b/i,
    /\balfalah\b/i,
    /\bfaysal\s+bank\b/i,
    /\bjs\s+bank\b/i
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
    /\busdt\s*(?:trc20|erc20|bep20)?\b/i,
    /\btrc20\b/i,
    /\berc20\b/i,
    /\bbep20\b/i,
    /\bbitcoin\b/i,
    /\bbtc\b/i,
    /\bethereum\b/i,
    /\beth\b/i,
    /\bcrypto\b/i,
    /\bcryptocurrency\b/i,
    /\bcrypto\s+wallet\b/i,
    /\bwallet\s+address\b/i,
    /\busdc\b/i,
    /\bsolana\b/i,
    /\btron\b/i
  ]
};


/* -------------------------------------------------------
 * RELEVANT PAGES
 * ----------------------------------------------------- */

const RELEVANT_PATHS = [
  "/about",
  "/about-us",
  "/company",
  "/company-profile",

  "/contact",
  "/contact-us",

  "/privacy",
  "/privacy-policy",

  "/terms",
  "/terms-and-conditions",
  "/terms-of-service",

  "/legal",
  "/legal-notice",

  "/refund",
  "/refund-policy",

  "/risk",
  "/risk-disclosure",

  "/invest",
  "/investment",
  "/investments",

  "/deposit",
  "/deposits",
  "/deposit-funds",

  "/plans",
  "/investment-plans",
  "/earning-plans",
  "/profit-plans",

  "/profit",
  "/profits",

  "/earning",
  "/earnings",

  "/income",

  "/withdraw",
  "/withdrawal",
  "/withdrawals",

  "/payment",
  "/payments",

  "/support",
  "/help",
  "/faq",

  "/referral",
  "/referrals",
  "/affiliate"
];


/* -------------------------------------------------------
 * MAIN HANDLER
 * ----------------------------------------------------- */

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
     * IMPORTANT:
     * Do NOT slice domains here.
     *
     * If discovery gives 381 domains,
     * scanner receives all 381.
     */
    const domains = uniqueDomains(
      rawDomains
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

    const results = [];

    await runWithConcurrency(
      domains,
      CONCURRENCY,
      async item => {
        try {
          const result =
            await scanDomain(item);

          results.push(result);
        } catch (error) {
          results.push({
            domain: item.domain,
            status: "error",
            errors: [
              error?.message ||
              "Scanner worker failed"
            ]
          });
        }
      }
    );

    const active = results.filter(
      item =>
        item.status === "active"
    );

    const investmentMatches =
      active.filter(
        item =>
          item.investment?.relevant
      );

    const paymentMatches =
      investmentMatches.filter(
        item =>
          hasSelectedPayment(
            item.paymentMethods,
            selectedPayments
          )
      );

    /*
     * No candidate limit.
     */
    const candidates =
      paymentMatches.sort(
        (a, b) =>
          (b.investment?.score || 0) -
          (a.investment?.score || 0)
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


/* -------------------------------------------------------
 * DOMAIN SCANNER
 * ----------------------------------------------------- */

async function scanDomain(input) {
  const domain =
    normalizeDomain(input?.domain);

  const result = {
    domain,

    registeredAt:
      input?.registeredAt || null,

    discoveredAt:
      input?.discoveredAt || null,

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

    rawSignals: [],

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


  /* ---------------------------------------------
   * FIRST REQUEST
   * ------------------------------------------- */

  let page =
    await fetchPage(
      `https://${domain}/`
    );

  if (!page.ok && !page.hasContent) {
    page =
      await fetchPage(
        `http://${domain}/`
      );
  }

  /*
   * A 403/401/429 page can still contain useful
   * title/content/signals.
   */
  if (!page.hasContent) {
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


  /* ---------------------------------------------
   * HOMEPAGE DATA
   * ------------------------------------------- */

  result.title =
    extractTitle(page.text);

  result.websiteName =
    result.title || domain;

  result.description =
    extractMetaDescription(
      page.text
    );


  /*
   * Inspect BOTH raw HTML and visible text.
   *
   * This catches:
   * - JS app strings
   * - payment labels
   * - hidden navigation URLs
   * - meta descriptions
   * - hrefs
   */

  const rawText =
    normalizeForSearch(
      page.text
    );

  const visibleText =
    extractUsefulText(
      page.text
    );

  const linksText =
    extractAllLinksAsText(
      page.text
    );

  const combinedInitial =
    normalizeForSearch(
      [
        rawText,
        visibleText,
        linksText,
        result.title || "",
        result.description || ""
      ].join(" ")
    );


  /* ---------------------------------------------
   * INITIAL DETECTION
   * ------------------------------------------- */

  result.investment =
    analyzeInvestmentContent(
      combinedInitial
    );

  result.paymentMethods =
    detectPaymentMethods(
      combinedInitial
    );


  result.transparency =
    analyzeTransparency(
      combinedInitial
    );


  /*
   * Deep scan when:
   *
   * A) investment signal exists
   * OR
   * B) payment signal exists
   * OR
   * C) homepage has relevant links
   *
   * This prevents wasting time on every random
   * website page.
   */

  const relevantLinks =
    extractRelevantLinks(
      page.text,
      page.finalUrl ||
        `https://${domain}/`
    );

  const shouldDeepScan =
    result.investment.relevant ||
    result.paymentMethods.detected.length > 0 ||
    relevantLinks.length > 0;


  if (shouldDeepScan) {
    const deepUrls =
      uniqueStrings([
        ...relevantLinks,
        ...buildRelevantPathUrls(
          domain,
          page.finalUrl
        )
      ]).slice(
        0,
        MAX_DEEP_PAGES
      );

    if (deepUrls.length) {
      const deepPages =
        await Promise.all(
          deepUrls.map(
            url =>
              fetchPage(url)
          )
        );

      const successfulDeepPages =
        deepPages.filter(
          item =>
            item.hasContent
        );

      const allPages = [
        page,
        ...successfulDeepPages
      ];

      result.pagesChecked =
        uniqueStrings(
          allPages.map(
            item =>
              item.finalUrl
          )
        );

      const deepText =
        allPages
          .map(
            item =>
              normalizeForSearch(
                [
                  item.text,
                  extractUsefulText(
                    item.text
                  ),
                  extractAllLinksAsText(
                    item.text
                  )
                ].join(" ")
              )
          )
          .filter(Boolean)
          .join(" ")
          .slice(
            0,
            MAX_TEXT_CHARS
          );


      result.content =
        deepText;


      /*
       * Re-run detection using ALL pages.
       */
      result.investment =
        analyzeInvestmentContent(
          deepText
        );

      result.paymentMethods =
        detectPaymentMethods(
          deepText
        );

      result.transparency =
        analyzeTransparency(
          deepText
        );

      result.snippets =
        extractRelevantSnippets(
          deepText
        );

    } else {
      result.content =
        combinedInitial;

      result.snippets =
        extractRelevantSnippets(
          combinedInitial
        );
    }

  } else {
    result.content =
      combinedInitial;

    result.snippets =
      extractRelevantSnippets(
        combinedInitial
      );
  }


  /*
   * Candidate requires:
   *
   * investment relevance
   * +
   * selected payment method
   */
  result.transparency.candidate =
    result.investment.relevant &&
    result.paymentMethods.detected.length > 0;


  return result;
}


/* -------------------------------------------------------
 * FETCH PAGE
 * ----------------------------------------------------- */

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
      await fetch(
        url,
        {
          method: "GET",

          redirect: "follow",

          signal: controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; LD76-Investment-Radar/1.0)",

            Accept:
              "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "en-US,en;q=0.8"
          }
        }
      );


    const contentType =
      (
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();


    const isUsefulType =
      contentType.includes(
        "text/html"
      ) ||
      contentType.includes(
        "application/xhtml+xml"
      ) ||
      contentType.includes(
        "text/plain"
      ) ||
      contentType.includes(
        "application/json"
      );


    if (!isUsefulType) {
      clearTimeout(timer);

      return {
        ok: false,
        hasContent: false,
        status: response.status,
        finalUrl: response.url,
        redirects: [],
        error:
          `Unsupported content type: ${contentType}`
      };
    }


    const reader =
      response.body?.getReader();


    if (!reader) {
      clearTimeout(timer);

      return {
        ok: false,
        hasContent: false,
        status: response.status,
        finalUrl: response.url,
        redirects: [],
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
      } =
        await reader.read();


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


      chunks.push(value);
    }


    clearTimeout(timer);


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
      ).decode(bytes);


    /*
     * Even non-2xx pages can have useful
     * content/signals.
     */
    const hasContent =
      text.trim().length > 20;


    return {
      ok:
        response.ok,

      hasContent,

      status:
        response.status,

      finalUrl:
        response.url,

      redirects: [],

      text
    };

  } catch (error) {
    clearTimeout(timer);

    return {
      ok: false,

      hasContent: false,

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


/* -------------------------------------------------------
 * INVESTMENT ANALYSIS
 * ----------------------------------------------------- */

function analyzeInvestmentContent(
  text
) {
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
    /\bwithdraw(?:al|als)?\b/i.test(
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
   * Require an actual financial/earning
   * concept, not just a generic word such as
   * "return" in navigation.
   */
  const strongInvestmentSignal =
    /\b(?:invest|investment|investing|investor|deposit|profit|profits|roi|return\s+on\s+investment|earning|earnings|passive\s+income|withdraw|withdrawal|investment\s+plan|earning\s+plan|profit\s+plan|trading|forex|staking|yield|crypto\s+investment)\b/i.test(
      text
    );


  const relevant =
    strongInvestmentSignal;


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


/* -------------------------------------------------------
 * PAYMENT DETECTION
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * PAYMENT FILTER
 * ----------------------------------------------------- */

function hasSelectedPayment(
  detected,
  selected
) {
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


/* -------------------------------------------------------
 * PAYMENT NORMALIZATION
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * TRANSPARENCY
 * ----------------------------------------------------- */

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
        /\bteam\b/i,
        /\blicense\b/i,
        /\blicensed\b/i,
        /\bregulator\b/i
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
        /\btelephone\b/i,
        /\bemail\b/i
      ]
    );


  return {
    company:
      uniqueStrings(
        company
      ).slice(
        0,
        30
      ),

    legal:
      uniqueStrings(
        legal
      ).slice(
        0,
        30
      ),

    support:
      uniqueStrings(
        support
      ).slice(
        0,
        30
      ),

    candidate: false
  };
}


/* -------------------------------------------------------
 * RELEVANT LINKS
 * ----------------------------------------------------- */

function extractRelevantLinks(
  html,
  baseUrl
) {
  const urls = [];

  if (!html) {
    return urls;
  }


  const hrefRegex =
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;


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


/* -------------------------------------------------------
 * BUILD RELEVANT URLS
 * ----------------------------------------------------- */

function buildRelevantPathUrls(
  domain,
  finalUrl
) {
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


  return RELEVANT_PATHS.map(
    path =>
      `${origin}${path}`
  );
}


/* -------------------------------------------------------
 * EXTRACT ALL LINKS
 *
 * This is important because payment/investment
 * terms may exist only in href values.
 * ----------------------------------------------------- */

function extractAllLinksAsText(
  html
) {
  if (!html) {
    return "";
  }


  const values = [];


  const hrefRegex =
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;


  let match;


  while (
    (match =
      hrefRegex.exec(
        html
      )) !== null
  ) {
    values.push(
      match[1]
    );
  }


  return values.join(" ");
}


/* -------------------------------------------------------
 * HTML → TEXT
 * ----------------------------------------------------- */

function extractUsefulText(
  html
) {
  if (!html) {
    return "";
  }


  let text =
    String(html);


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


  text =
    text.replace(
      /<template\b[^>]*>[\s\S]*?<\/template>/gi,
      " "
    );


  text =
    text.replace(
      /<\/(?:p|div|section|article|li|h1|h2|h3|h4|h5|h6|br|tr|td|th|header|footer|nav)>/gi,
      " "
    );


  text =
    text.replace(
      /<[^>]+>/g,
      " "
    );


  text =
    decodeHtmlEntities(
      text
    );


  return normalizeForSearch(
    text
  ).slice(
    0,
    MAX_TEXT_CHARS
  );
}


/* -------------------------------------------------------
 * NORMALIZE SEARCH TEXT
 * ----------------------------------------------------- */

function normalizeForSearch(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /\\u002f/gi,
      "/"
    )
    .replace(
      /\\u003a/gi,
      ":"
    )
    .replace(
      /\\u0026/gi,
      "&"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* -------------------------------------------------------
 * TITLE
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * META DESCRIPTION
 * ----------------------------------------------------- */

function extractMetaDescription(
  html
) {
  if (!html) {
    return null;
  }


  const patterns = [
    /<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,

    /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i,

    /<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i
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
          700
        );
      }
    }
  }


  return null;
}


/* -------------------------------------------------------
 * SNIPPETS
 * ----------------------------------------------------- */

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
    /\bincome\b/i,
    /\bwithdraw(?:al)?\b/i,
    /\beasypaisa\b/i,
    /\bjazzcash\b/i,
    /\bpkr\b/i,
    /\bibAN\b/i,
    /\bbank\s+transfer\b/i,
    /\busdt\b/i,
    /\btrc20\b/i,
    /\breferral\b/i,
    /\baffiliate\b/i
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


    const start =
      Math.max(
        0,
        match.index - 220
      );


    const end =
      Math.min(
        text.length,
        match.index + 420
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
    25
  );
}


/* -------------------------------------------------------
 * DOMAIN NORMALIZATION
 * ----------------------------------------------------- */

function normalizeInputDomain(
  item
) {
  if (!item) {
    return null;
  }


  if (
    typeof item === "string"
  ) {
    const domain =
      normalizeDomain(
        item
      );


    return domain
      ? { domain }
      : null;
  }


  if (
    typeof item === "object"
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


/* -------------------------------------------------------
 * NORMALIZE DOMAIN
 * ----------------------------------------------------- */

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
    domain.replace(
      /\.$/,
      ""
    );


  return domain.trim();
}


/* -------------------------------------------------------
 * UNIQUE DOMAINS
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * MATCH HELPERS
 * ----------------------------------------------------- */

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
      text.match(pattern);


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
      text.match(pattern);


    if (match) {
      matches.push(
        match[0]
      );
    }
  }


  return matches;
}


/* -------------------------------------------------------
 * UNIQUE STRINGS
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * HTML ENTITIES
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * UINT8 ARRAY
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * CONCURRENCY
 * ----------------------------------------------------- */

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
          "Scanner worker error:",
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
