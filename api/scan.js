"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * WEBSITE SCANNER
 *
 * IMPORTANT:
 *
 * discover.js has already verified that the domain
 * was recently registered using RDAP.
 *
 * This scanner now verifies that the domain is also
 * a REAL ACTIVE WEBSITE.
 *
 * Parked / for-sale / registrar holding pages are
 * rejected before investment/payment filtering.
 *
 * NO artificial 4/5 candidate limit.
 */

const CONCURRENCY = 25;

const REQUEST_TIMEOUT_MS = 5000;

const MAX_HTML_BYTES = 350000;

const MAX_TEXT_CHARS = 90000;

const MAX_DEEP_PAGES = 8;


/* =========================================================
 * INVESTMENT / EARNING SIGNALS
 * ========================================================= */

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


/* =========================================================
 * PAYMENT METHODS
 * ========================================================= */

const PAYMENT_PATTERNS = {
  bank: [
    /\bbank\s+transfer\b/i,
    /\bbank\s+deposit\b/i,
    /\bbank\s+account\b/i,
    /\bbank\s+details\b/i,
    /\bbank\s+payment\b/i,

    /\baccount\s+number\b/i,
    /\baccount\s+title\b/i,
    /\baccount\s+holder\b/i,
    /\baccount\s+name\b/i,

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


/* =========================================================
 * PARKED / FOR-SALE DETECTION
 * ========================================================= */

const PARKED_PATTERNS = [
  /\bdomain\s+for\s+sale\b/i,
  /\bthis\s+domain\s+is\s+for\s+sale\b/i,
  /\bthis\s+domain\s+is\s+available\s+for\s+purchase\b/i,
  /\bbuy\s+(?:this\s+)?domain\b/i,
  /\bbuy\s+domain\b/i,
  /\bpurchase\s+(?:this\s+)?domain\b/i,

  /\bdomain\s+name\s+for\s+sale\b/i,
  /\bdomain\s+is\s+parked\b/i,
  /\bparked\s+domain\b/i,
  /\bdomain\s+parking\b/i,
  /\bpark\s+this\s+domain\b/i,

  /\bcoming\s+soon\b/i,
  /\bunder\s+construction\b/i,

  /\bmake\s+an\s+offer\s+for\s+this\s+domain\b/i,
  /\bmake\s+offer\b/i,

  /\bget\s+this\s+domain\b/i,
  /\bown\s+this\s+domain\b/i,
  /\bclaim\s+this\s+domain\b/i,

  /\bdomain\s+marketplace\b/i,
  /\bdomain\s+auction\b/i,

  /\bsedo\b/i,
  /\bafternic\b/i,
  /\bdan\.com\b/i,
  /\bgodaddy\s+domain\b/i,
  /\bnamecheap\s+marketplace\b/i,

  /\bhuge\s+domains\b/i,
  /\bdomains\s+available\b/i,

  /\bparkingcrew\b/i,
  /\bparking\s+crew\b/i,

  /\bthis\s+webpage\s+is\s+parked\b/i,
  /\bwebsite\s+coming\s+soon\b/i
];


const PARKED_URL_PATTERNS = [
  /sedo\.com/i,
  /afternic\.com/i,
  /dan\.com/i,
  /godaddy\.com\/domain/i,
  /namecheap\.com\/domains/i
];


/* =========================================================
 * RELEVANT DEEP PAGES
 * ========================================================= */

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


/* =========================================================
 * MAIN HANDLER
 * ========================================================= */

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

    const rawDomains =
      Array.isArray(body.domains)
        ? body.domains
        : [];

    const selectedPayments =
      normalizePayments(
        body.paymentMethods
      );

    /*
     * NEVER LIMIT TO 4 OR 5.
     */

    const domains =
      uniqueDomains(
        rawDomains
          .map(normalizeInputDomain)
          .filter(Boolean)
      );

    if (!domains.length) {
      return res.status(200).json({
        ok: true,

        scanned: 0,

        active: 0,

        realActiveWebsites: 0,

        parkedRejected: 0,

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
            domain:
              item.domain,

            registeredAt:
              item.registeredAt ||
              null,

            registrationVerified:
              item.registrationVerified ===
              true,

            status:
              "error",

            errors: [
              error?.message ||
              "Scanner worker failed"
            ]
          });
        }
      }
    );


    const active =
      results.filter(
        item =>
          item.status ===
          "active"
      );


    const realActiveWebsites =
      active.filter(
        item =>
          item.websiteType ===
          "real-active-website"
      );


    const parkedRejected =
      results.filter(
        item =>
          item.websiteType ===
          "parked-or-for-sale"
      );


    const investmentMatches =
      realActiveWebsites.filter(
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
     * NO candidate limit.
     */

    const candidates =
      paymentMatches.sort(
        (a, b) =>
          (b.investment?.score || 0) -
          (a.investment?.score || 0)
      );


    return res.status(200).json({
      ok: true,

      scanned:
        domains.length,

      active:
        active.length,

      realActiveWebsites:
        realActiveWebsites.length,

      parkedRejected,

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

      error:
        "Website scanning failed",

      message:
        error?.message ||
        "Unknown scanner error"
    });
  }
}


/* =========================================================
 * DOMAIN SCANNER
 * ========================================================= */

async function scanDomain(
  input
) {
  const domain =
    normalizeDomain(
      input?.domain
    );

  const result = {
    domain,

    registeredAt:
      input?.registeredAt ||
      null,

    registrationVerified:
      input?.registrationVerified ===
      true,

    registrationSource:
      input?.registrationSource ||
      null,

    discoveredAt:
      input?.discoveredAt ||
      null,

    lastScanned:
      new Date().toISOString(),

    status:
      "inactive",

    websiteType:
      "unknown",

    httpStatus:
      null,

    https:
      true,

    finalUrl:
      null,

    redirects:
      [],

    websiteName:
      null,

    title:
      null,

    description:
      null,

    pagesChecked:
      [],

    content:
      "",

    rawSignals:
      [],

    snippets:
      [],

    investment: {
      relevant:
        false,

      score:
        0,

      keywords:
        [],

      dailyReturnClaims:
        [],

      roiClaims:
        []
    },

    paymentMethods: {
      bank:
        false,

      easypaisa:
        false,

      jazzcash:
        false,

      crypto:
        false,

      detected:
        []
    },

    transparency: {
      company:
        [],

      legal:
        [],

      support:
        [],

      candidate:
        false
    },

    technical: {
      https:
        true,

      status:
        null,

      redirects:
        0
    },

    errors:
      []
  };


  if (!domain) {
    result.errors.push(
      "Invalid domain"
    );

    return result;
  }


  /*
   * Registration verification is expected
   * from discover.js.
   *
   * Do not allow unverified domains through
   * if this endpoint is called manually.
   */

  if (
    input?.registrationVerified !==
    true
  ) {
    result.errors.push(
      "Domain registration is not verified"
    );

    result.websiteType =
      "registration-unverified";

    return result;
  }


  /* ---------------------------------------------
   * HOMEPAGE
   * ------------------------------------------- */

  let page =
    await fetchPage(
      `https://${domain}/`
    );


  if (
    !page.hasContent
  ) {
    page =
      await fetchPage(
        `http://${domain}/`
      );
  }


  if (
    !page.hasContent
  ) {
    result.errors =
      [page.error]
        .filter(Boolean);

    return result;
  }


  result.status =
    "active";

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
    https:
      result.https,

    status:
      page.status,

    redirects:
      result.redirects.length
  };


  /* ---------------------------------------------
   * BASIC PAGE DATA
   * ------------------------------------------- */

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
   * Inspect raw HTML + visible text + URLs.
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

  const combined =
    truncateText(
      [
        rawText,
        visibleText,
        linksText
      ].join("\n"),
      MAX_TEXT_CHARS
    );


  /* ---------------------------------------------
   * PARKED / FOR-SALE GATE
   * ------------------------------------------- */

  const parkedAnalysis =
    detectParkedPage(
      page,
      combined,
      result.finalUrl,
      result.title
    );


  result.parked =
    parkedAnalysis;


  if (
    parkedAnalysis.isParked
  ) {
    result.websiteType =
      "parked-or-for-sale";

    result.status =
      "inactive";

    result.errors.push(
      parkedAnalysis.reason
    );

    return result;
  }


  /*
   * If the homepage is extremely empty,
   * don't call it a real active site.
   */

  if (
    isEssentiallyEmptyWebsite(
      combined,
      result.title
    )
  ) {
    result.websiteType =
      "empty-or-placeholder";

    result.status =
      "inactive";

    result.errors.push(
      "Website has no meaningful active content"
    );

    return result;
  }


  result.websiteType =
    "real-active-website";


  /* ---------------------------------------------
   * INITIAL ANALYSIS
   * ------------------------------------------- */

  analyzeInvestment(
    result,
    combined
  );

  analyzePayments(
    result,
    combined
  );

  analyzeTransparency(
    result,
    combined
  );

  result.content =
    truncateText(
      combined,
      MAX_TEXT_CHARS
    );


  /* ---------------------------------------------
   * DEEP SCAN
   * ------------------------------------------- */

  if (
    result.investment.relevant ||
    result.paymentMethods.detected.length
  ) {
    const links =
      extractPageLinks(
        page.text,
        result.finalUrl ||
        `https://${domain}/`
      );

    const selectedLinks =
      selectRelevantPages(
        links
      ).slice(
        0,
        MAX_DEEP_PAGES
      );


    for (
      const url
      of selectedLinks
    ) {
      if (
        result.pagesChecked
          .includes(url)
      ) {
        continue;
      }

      const child =
        await fetchPage(url);

      if (
        !child.hasContent
      ) {
        continue;
      }

      const childText =
        normalizeForSearch(
          child.text
        );

      const childVisible =
        extractUsefulText(
          child.text
        );

      const childLinks =
        extractAllLinksAsText(
          child.text
        );

      const childCombined =
        truncateText(
          [
            childText,
            childVisible,
            childLinks
          ].join("\n"),
          20000
        );


      /*
       * A deep page saying "buy this domain"
       * does not mean the homepage is parked,
       * but if the page is clearly a marketplace
       * page, don't use it as investment evidence.
       */

      if (
        detectParkedPage(
          child,
          childCombined,
          child.finalUrl,
          extractTitle(child.text)
        ).isParked
      ) {
        continue;
      }


      result.pagesChecked.push(
        url
      );

      result.content +=
        "\n\n--- PAGE: " +
        url +
        " ---\n" +
        childCombined;


      analyzeInvestment(
        result,
        childCombined
      );

      analyzePayments(
        result,
        childCombined
      );

      analyzeTransparency(
        result,
        childCombined
      );


      const childSnippets =
        collectSignalSnippets(
          childCombined
        );

      result.snippets.push(
        ...childSnippets
      );
    }
  }


  result.content =
    truncateText(
      result.content,
      MAX_TEXT_CHARS
    );


  result.snippets =
    uniqueStrings(
      result.snippets
    ).slice(
      0,
      30
    );


  result.rawSignals =
    uniqueStrings(
      result.rawSignals
    );


  /*
   * Recalculate relevance after deep scan.
   */

  result.investment.relevant =
    result.investment.score >=
      10;


  result.transparency.candidate =
    result.investment.relevant ||
    result.paymentMethods.detected.length >
      0;


  return result;
}


/* =========================================================
 * PARKED PAGE DETECTION
 * ========================================================= */

function detectParkedPage(
  page,
  combined,
  finalUrl,
  title
) {
  const text =
    [
      combined || "",
      title || "",
      finalUrl || ""
    ].join("\n");


  const matches =
    [];


  for (
    const pattern
    of PARKED_PATTERNS
  ) {
    const match =
      text.match(pattern);

    if (match) {
      matches.push(
        match[0]
      );
    }
  }


  for (
    const pattern
    of PARKED_URL_PATTERNS
  ) {
    if (
      pattern.test(
        String(finalUrl || "")
      )
    ) {
      matches.push(
        String(finalUrl)
      );
    }
  }


  /*
   * Strong indicators immediately reject.
   */

  const strong =
    matches.some(value =>
      /for sale|buy domain|parked|domain parking|sedo|afternic|dan\.com|domain auction/i
        .test(value)
    );


  if (strong) {
    return {
      isParked:
        true,

      confidence:
        "high",

      matches:
        uniqueStrings(matches),

      reason:
        "Parked or for-sale domain page detected"
    };
  }


  /*
   * "Coming soon" alone is weaker.
   * Only reject when content is otherwise
   * essentially empty.
   */

  if (
    matches.length &&
    /coming\s+soon|under\s+construction/i.test(
      text
    ) &&
    isEssentiallyEmptyWebsite(
      combined,
      title
    )
  ) {
    return {
      isParked:
        true,

      confidence:
        "medium",

      matches:
        uniqueStrings(matches),

      reason:
        "Placeholder/coming-soon website detected"
    };
  }


  return {
    isParked:
      false,

    confidence:
      "none",

    matches:
      []
  };
}


/* =========================================================
 * EMPTY WEBSITE DETECTION
 * ========================================================= */

function isEssentiallyEmptyWebsite(
  text,
  title
) {
  const cleaned =
    String(text || "")
      .replace(/\s+/g, " ")
      .trim();


  if (
    cleaned.length < 80
  ) {
    return true;
  }


  const titleOnly =
    String(title || "")
      .trim()
      .toLowerCase();


  if (
    cleaned.length < 250 &&
    (
      titleOnly === "coming soon" ||
      titleOnly === "under construction" ||
      titleOnly === "domain for sale" ||
      titleOnly === "this domain is for sale"
    )
  ) {
    return true;
  }


  return false;
}


/* =========================================================
 * INVESTMENT ANALYSIS
 * ========================================================= */

function analyzeInvestment(
  result,
  text
) {
  const value =
    String(text || "");


  for (
    const pattern
    of INVESTMENT_PATTERNS
  ) {
    const match =
      value.match(pattern);

    if (match) {
      const keyword =
        match[0].trim();

      if (
        !result.investment.keywords
          .includes(keyword)
      ) {
        result.investment.keywords.push(
          keyword
        );
      }

      result.investment.score +=
        keywordWeight(
          keyword
        );
    }
  }


  for (
    const pattern
    of DAILY_RETURN_PATTERNS
  ) {
    const matches =
      value.match(
        new RegExp(
          pattern.source,
          pattern.flags + "g"
        )
      );

    if (matches) {
      result.investment.score +=
        15;

      result.investment.dailyReturnClaims.push(
        ...matches
      );
    }
  }


  for (
    const pattern
    of ROI_PATTERNS
  ) {
    const matches =
      value.match(
        new RegExp(
          pattern.source,
          pattern.flags + "g"
        )
      );

    if (matches) {
      result.investment.score +=
        15;

      result.investment.roiClaims.push(
        ...matches
      );
    }
  }


  result.investment.keywords =
    uniqueStrings(
      result.investment.keywords
    );

  result.investment.dailyReturnClaims =
    uniqueStrings(
      result.investment.dailyReturnClaims
    );

  result.investment.roiClaims =
    uniqueStrings(
      result.investment.roiClaims
    );


  result.investment.score =
    Math.min(
      result.investment.score,
      100
    );


  result.investment.relevant =
    result.investment.score >=
      10;
}


function keywordWeight(
  keyword
) {
  const value =
    String(keyword)
      .toLowerCase();

  if (
    /daily|profit|return|roi|investment|deposit|withdraw/i
      .test(value)
  ) {
    return 10;
  }

  if (
    /referral|affiliate|commission|bonus|reward/i
      .test(value)
  ) {
    return 5;
  }

  return 3;
}


/* =========================================================
 * PAYMENT ANALYSIS
 * ========================================================= */

function analyzePayments(
  result,
  text
) {
  const value =
    String(text || "");


  for (
    const [method, patterns]
    of Object.entries(
      PAYMENT_PATTERNS
    )
  ) {
    for (
      const pattern
      of patterns
    ) {
      if (
        pattern.test(value)
      ) {
        result.paymentMethods[method] =
          true;

        break;
      }
    }
  }


  const detected = [];


  for (
    const method
    of [
      "bank",
      "easypaisa",
      "jazzcash",
      "crypto"
    ]
  ) {
    if (
      result.paymentMethods[method]
    ) {
      detected.push(
        method
      );
    }
  }


  result.paymentMethods.detected =
    detected;
}


/* =========================================================
 * SELECTED PAYMENT FILTER
 * ========================================================= */

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

  const allowed =
    new Set([
      "bank",
      "easypaisa",
      "jazzcash",
      "crypto"
    ]);

  return uniqueStrings(
    value
      .map(item =>
        String(item)
          .trim()
          .toLowerCase()
      )
      .filter(item =>
        allowed.has(item)
      )
  );
}


function hasSelectedPayment(
  paymentMethods,
  selectedPayments
) {
  if (
    !Array.isArray(selectedPayments) ||
    !selectedPayments.length
  ) {
    return false;
  }

  return selectedPayments.some(
    method =>
      paymentMethods?.[method] ===
      true
  );
}


/* =========================================================
 * TRANSPARENCY
 * ========================================================= */

function analyzeTransparency(
  result,
  text
) {
  const value =
    String(text || "")
      .toLowerCase();


  if (
    /company|about us|who we are|our team|management|head office|registered office/i
      .test(value)
  ) {
    result.transparency.company.push(
      "Company/business information detected"
    );
  }


  if (
    /privacy policy|terms and conditions|terms of service|legal notice|refund policy|risk disclosure/i
      .test(value)
  ) {
    result.transparency.legal.push(
      "Legal/privacy information detected"
    );
  }


  if (
    /contact us|support|customer service|email us|live chat|telegram|whatsapp|discord/i
      .test(value)
  ) {
    result.transparency.support.push(
      "Support/contact information detected"
    );
  }


  result.transparency.company =
    uniqueStrings(
      result.transparency.company
    );

  result.transparency.legal =
    uniqueStrings(
      result.transparency.legal
    );

  result.transparency.support =
    uniqueStrings(
      result.transparency.support
    );
}


/* =========================================================
 * PAGE FETCHER
 * ========================================================= */

async function fetchPage(
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
          method:
            "GET",

          redirect:
            "follow",

          headers: {
            Accept:
              "text/html,application/xhtml+xml,text/plain,*/*",

            "User-Agent":
              "Mozilla/5.0 LD76-Investment-Radar/1.0"
          },

          signal:
            controller.signal
        }
      );


    const buffer =
      await response.arrayBuffer();


    const limited =
      buffer.byteLength >
      MAX_HTML_BYTES
        ? buffer.slice(
            0,
            MAX_HTML_BYTES
          )
        : buffer;


    const text =
      new TextDecoder(
        "utf-8",
        {
          fatal: false
        }
      ).decode(
        limited
      );


    const hasContent =
      Boolean(
        text &&
        text.trim().length
      );


    return {
      ok:
        response.ok,

      status:
        response.status,

      finalUrl:
        response.url ||
        url,

      redirects:
        [],

      text,

      hasContent,

      error:
        null
    };

  } catch (error) {
    return {
      ok:
        false,

      status:
        null,

      finalUrl:
        url,

      redirects:
        [],

      text:
        "",

      hasContent:
        false,

      error:
        error?.message ||
        "Request failed"
    };

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
 * HTML HELPERS
 * ========================================================= */

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

  return cleanHtmlText(
    match[1]
  );
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

  return cleanHtmlText(
    match[1]
  );
}


function extractUsefulText(
  html
) {
  let value =
    String(html || "");


  value =
    value.replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    );


  value =
    value.replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    );


  value =
    value.replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
      " "
    );


  value =
    value.replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
      " "
    );


  value =
    value.replace(
      /<[^>]+>/g,
      " "
    );


  return cleanHtmlText(
    value
  );
}


function cleanHtmlText(
  value
) {
  return String(value || "")
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
      "\""
    )
    .replace(
      /&#39;/gi,
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
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeForSearch(
  value
) {
  return cleanHtmlText(
    value
  ).toLowerCase();
}


function truncateText(
  value,
  max
) {
  const text =
    String(value || "");

  if (
    text.length <= max
  ) {
    return text;
  }

  return text.slice(
    0,
    max
  );
}


/* =========================================================
 * LINKS
 * ========================================================= */

function extractAllLinksAsText(
  html
) {
  const links = [];

  const regex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match = regex.exec(
      String(html || "")
    ))
  ) {
    links.push(
      match[1]
    );
  }

  return links.join("\n");
}


function extractPageLinks(
  html,
  baseUrl
) {
  const links =
    [];

  const regex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match = regex.exec(
      String(html || "")
    ))
  ) {
    const href =
      match[1];

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      continue;
    }

    try {
      const absolute =
        new URL(
          href,
          baseUrl
        ).href;

      links.push(
        absolute
      );
    } catch {
      /* ignore invalid links */
    }
  }

  return uniqueStrings(
    links
  );
}


function selectRelevantPages(
  links
) {
  const selected =
    [];

  for (
    const link
    of links
  ) {
    let pathname;

    try {
      pathname =
        new URL(
          link
        ).pathname
          .toLowerCase()
          .replace(
            /\/+$/,
            ""
          );
    } catch {
      continue;
    }


    for (
      const path
      of RELEVANT_PATHS
    ) {
      if (
        pathname === path ||
        pathname.startsWith(
          path + "/"
        )
      ) {
        selected.push(
          link
        );

        break;
      }
    }
  }

  return uniqueStrings(
    selected
  );
}


/* =========================================================
 * SIGNAL SNIPPETS
 * ========================================================= */

function collectSignalSnippets(
  text
) {
  const snippets =
    [];

  const lines =
    String(text || "")
      .split(/\n+/);

  for (
    const line
    of lines
  ) {
    const value =
      line.trim();

    if (
      !value ||
      value.length < 8
    ) {
      continue;
    }

    if (
      /investment|invest|deposit|profit|roi|return|earning|withdraw|easypaisa|jazzcash|bank|usdt|crypto|referral|affiliate/i
        .test(value)
    ) {
      snippets.push(
        truncateText(
          value,
          500
        )
      );
    }

    if (
      snippets.length >= 20
    ) {
      break;
    }
  }

  return snippets;
}


/* =========================================================
 * INPUT HELPERS
 * ========================================================= */

function normalizeInputDomain(
  value
) {
  if (
    typeof value ===
    "string"
  ) {
    return {
      domain:
        normalizeDomain(
          value
        ),

      registeredAt:
        null,

      registrationVerified:
        false
    };
  }


  if (
    value &&
    typeof value ===
    "object"
  ) {
    return {
      domain:
        normalizeDomain(
          value.domain
        ),

      registeredAt:
        value.registeredAt ||
        null,

      registrationVerified:
        value.registrationVerified ===
        true,

      registrationSource:
        value.registrationSource ||
        null,

      discoveredAt:
        value.discoveredAt ||
        null
    };
  }


  return null;
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
      !item?.domain
    ) {
      continue;
    }

    const existing =
      map.get(
        item.domain
      );

    if (!existing) {
      map.set(
        item.domain,
        item
      );

      continue;
    }

    map.set(
      item.domain,
      {
        ...existing,
        ...item,

        registeredAt:
          item.registeredAt ||
          existing.registeredAt,

        registrationVerified:
          item.registrationVerified ||
          existing.registrationVerified,

        discoveredAt:
          item.discoveredAt ||
          existing.discoveredAt
      }
    );
  }

  return [
    ...map.values()
  ];
}


function normalizeDomain(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
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
    domain
      .split("/")[0]
      .split("?")[0]
      .replace(
        /\.$/,
        ""
      );

  if (
    !domain ||
    domain.length > 253 ||
    /\s|\\/.test(domain)
  ) {
    return null;
  }

  const valid =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  return valid.test(
    domain
  )
    ? domain
    : null;
}


/* =========================================================
 * CONCURRENCY
 * ========================================================= */

async function runWithConcurrency(
  items,
  limit,
  worker
) {
  let index =
    0;

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

      await worker(
        items[current]
      );
    }
  }

  const workers =
    Math.min(
      limit,
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length: workers
      },
      runner
    )
  );
}


/* =========================================================
 * UNIQUE STRINGS
 * ========================================================= */

function uniqueStrings(
  values
) {
  return [
    ...new Set(
      (values || [])
        .filter(
          value =>
            value !== null &&
            value !== undefined &&
            String(value).trim()
        )
        .map(
          value =>
            String(value).trim()
        )
    )
  ];
}
