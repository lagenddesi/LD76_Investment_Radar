
"use strict";

/*
 * LD76 INVESTMENT RADAR
 *
 * FINAL WEBSITE SCANNER
 *
 * PURPOSE
 * -------
 * Find newly registered websites that appear to offer
 * REAL financial activity such as:
 *
 * - Investment
 * - Investment plans
 * - Trading
 * - Forex
 * - Crypto investment / trading
 * - Staking
 * - Mining
 * - Deposit / withdrawal based earning
 * - Profit / ROI programs
 * - Passive income programs
 * - Referral earning connected to a financial platform
 *
 * IMPORTANT
 * ---------
 * Payment methods are EVIDENCE ONLY.
 *
 * Bank / Easypaisa / JazzCash / Crypto are NOT required
 * for a website to become a candidate.
 *
 * A generic word such as:
 * "crypto"
 * "bank"
 * "return"
 * "profit"
 * "bonus"
 *
 * does NOT make a website an investment candidate.
 *
 * The scanner requires FINANCIAL CONTEXT.
 *
 * Parking / domain-for-sale / marketplace / registrar
 * holding pages are HARD REJECTED before Gemini.
 *
 * NO ARTIFICIAL CANDIDATE LIMIT.
 */


/* =========================================================
 * CONFIGURATION
 * ========================================================= */

const CONCURRENCY = 25;

const REQUEST_TIMEOUT_MS = 5000;

const MAX_HTML_BYTES = 350000;

const MAX_TEXT_CHARS = 90000;

const MAX_DEEP_PAGES = 10;


/* =========================================================
 * FINANCIAL SIGNAL GROUPS
 * ========================================================= */

const SIGNAL_PATTERNS = {

  investment: [
    /\binvest\b/i,
    /\binvestment\b/i,
    /\binvesting\b/i,
    /\binvestor\b/i,
    /\binvestors\b/i,
    /\binvestment\s+plan\b/i,
    /\binvestment\s+plans\b/i,
    /\binvestment\s+program\b/i,
    /\binvestment\s+programs\b/i,
    /\binvestment\s+opportunity\b/i,
    /\binvestment\s+opportunities\b/i,
    /\binvestment\s+package\b/i,
    /\binvestment\s+packages\b/i,
    /\binvestment\s+account\b/i,
    /\binvestment\s+fund\b/i,
    /\binvestment\s+funds\b/i,
    /\binvestment\s+platform\b/i
  ],

  deposit: [
    /\bdeposit\b/i,
    /\bdeposits\b/i,
    /\bdeposit\s+funds?\b/i,
    /\bdeposit\s+money\b/i,
    /\bminimum\s+deposit\b/i,
    /\bdeposit\s+amount\b/i,
    /\badd\s+funds?\b/i,
    /\bfund\s+your\s+account\b/i,
    /\bfunding\s+account\b/i
  ],

  profit: [
    /\bprofit\b/i,
    /\bprofits\b/i,
    /\bprofit\s+plan\b/i,
    /\bprofit\s+plans\b/i,
    /\bprofit\s+rate\b/i,
    /\bprofit\s+sharing\b/i,
    /\bprofit\s+percentage\b/i,
    /\bprofit\s+return\b/i
  ],

  return: [
    /\breturn\s+on\s+investment\b/i,
    /\breturn\s+rate\b/i,
    /\breturns?\b/i,
    /\bpercentage\s+return\b/i,
    /\bexpected\s+return\b/i
  ],

  roi: [
    /\broi\b/i,
    /\breturn\s+on\s+investment\b/i,
    /\broi\s+percentage\b/i
  ],

  earning: [
    /\bearn\b/i,
    /\bearning\b/i,
    /\bearnings\b/i,
    /\bearning\s+plan\b/i,
    /\bearning\s+plans\b/i,
    /\bearning\s+program\b/i,
    /\bmake\s+money\b/i,
    /\bmake\s+income\b/i,
    /\bpassive\s+income\b/i,
    /\bpassive\s+earning\b/i,
    /\bpassive\s+earnings\b/i,
    /\bincome\s+plan\b/i,
    /\bincome\s+program\b/i,
    /\bdaily\s+earning\b/i,
    /\bdaily\s+earnings\b/i
  ],

  withdrawal: [
    /\bwithdraw\b/i,
    /\bwithdrawal\b/i,
    /\bwithdrawals\b/i,
    /\bwithdraw\s+funds?\b/i,
    /\bwithdraw\s+profit\b/i,
    /\bwithdraw\s+earnings?\b/i
  ],

  trading: [
    /\btrading\b/i,
    /\btrader\b/i,
    /\btraders\b/i,
    /\btrading\s+platform\b/i,
    /\btrading\s+account\b/i,
    /\btrading\s+signals?\b/i,
    /\bcopy\s+trading\b/i,
    /\bautomated\s+trading\b/i,
    /\btrade\s+account\b/i
  ],

  forex: [
    /\bforex\b/i,
    /\bforex\s+trading\b/i,
    /\bforex\s+broker\b/i,
    /\bforex\s+signals?\b/i,
    /\bcurrency\s+trading\b/i
  ],

  crypto: [
    /\bcrypto\b/i,
    /\bcryptocurrency\b/i,
    /\bbitcoin\b/i,
    /\bbtc\b/i,
    /\bethereum\b/i,
    /\busdt\b/i,
    /\busdc\b/i,
    /\bdefi\b/i,
    /\bcrypto\s+investment\b/i,
    /\bcrypto\s+investing\b/i,
    /\bcrypto\s+trading\b/i,
    /\bcrypto\s+earning\b/i,
    /\bcrypto\s+staking\b/i
  ],

  staking: [
    /\bstaking\b/i,
    /\bstaking\s+rewards?\b/i,
    /\bstaking\s+income\b/i,
    /\bstaking\s+profit\b/i,
    /\bstake\s+and\s+earn\b/i,
    /\bapy\b/i
  ],

  mining: [
    /\bmining\b/i,
    /\bcrypto\s+mining\b/i,
    /\bbitcoin\s+mining\b/i,
    /\bcloud\s+mining\b/i,
    /\bmining\s+profit\b/i,
    /\bmining\s+rewards?\b/i
  ],

  yield: [
    /\byield\b/i,
    /\bhigh\s+yield\b/i,
    /\byield\s+farming\b/i,
    /\byield\s+program\b/i,
    /\byield\s+rewards?\b/i
  ],

  referral: [
    /\breferral\s+bonus\b/i,
    /\breferral\s+earning\b/i,
    /\breferral\s+income\b/i,
    /\baffiliate\s+commission\b/i,
    /\binvite\s+and\s+earn\b/i,
    /\bteam\s+income\b/i,
    /\bteam\s+bonus\b/i,
    /\blevel\s+bonus\b/i
  ],

  account: [
    /\bcreate\s+account\b/i,
    /\bregister\s+now\b/i,
    /\bsign\s+up\b/i,
    /\blog\s*in\b/i,
    /\blogin\b/i,
    /\btrading\s+account\b/i,
    /\binvestment\s+account\b/i,
    /\bwallet\s+account\b/i,
    /\buser\s+dashboard\b/i
  ],

  action: [
    /\binvest\s+now\b/i,
    /\bstart\s+investing\b/i,
    /\bstart\s+trading\b/i,
    /\bdeposit\s+now\b/i,
    /\bdeposit\s+funds?\b/i,
    /\bchoose\s+(?:a\s+)?plan\b/i,
    /\bselect\s+(?:a\s+)?plan\b/i,
    /\bjoin\s+now\b/i,
    /\bstart\s+earning\b/i,
    /\bwithdraw\s+now\b/i
  ]
};


/* =========================================================
 * STRONG FINANCIAL CLAIMS
 * ========================================================= */

const DAILY_RETURN_PATTERNS = [

  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?day\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*daily\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*per\s*day\b/i,

  /\bdaily\s+profit\b/i,
  /\bdaily\s+return\b/i,
  /\bdaily\s+income\b/i,
  /\bdaily\s+earning\b/i,
  /\bdaily\s+earnings\b/i,

  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?week\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*weekly\b/i,

  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?month\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*monthly\b/i,

  /\bprofit\s+of\s+\d+(?:\.\d+)?\s*%\b/i,
  /\breturn\s+of\s+\d+(?:\.\d+)?\s*%\b/i,

  /\bguaranteed\s+profit\b/i,
  /\bguaranteed\s+return\b/i,
  /\bguaranteed\s+income\b/i,
  /\bguaranteed\s+earning\b/i,

  /\bfixed\s+profit\b/i,
  /\bfixed\s+return\b/i,
  /\bfixed\s+income\b/i,

  /\bhigh\s+profit\b/i,
  /\bhigh\s+return\b/i,
  /\bhigh\s+income\b/i
];


const ROI_PATTERNS = [

  /\broi\b/i,
  /\breturn\s+on\s+investment\b/i,
  /\bprofit\s+rate\b/i,
  /\breturn\s+rate\b/i,
  /\bpercentage\s+return\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:roi|return|profit)\b/i,
  /\bup\s+to\s+\d+(?:\.\d+)?\s*%\b/i
];


/* =========================================================
 * PAYMENT METHODS
 *
 * EVIDENCE ONLY
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
    /\bwire\s+transfer\b/i
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
    /\bcrypto\s+wallet\b/i,
    /\bwallet\s+address\b/i,
    /\busdc\b/i
  ]
};


/* =========================================================
 * HARD PARKING / FOR-SALE DETECTION
 * ========================================================= */

const PARKED_PATTERNS = [

  /\bdomain\s+for\s+sale\b/i,
  /\bthis\s+domain\s+is\s+for\s+sale\b/i,
  /\bthis\s+domain\s+is\s+available\s+for\s+purchase\b/i,
  /\bthis\s+domain\s+may\s+be\s+for\s+sale\b/i,

  /\bbuy\s+(?:this\s+)?domain\b/i,
  /\bpurchase\s+(?:this\s+)?domain\b/i,
  /\bget\s+this\s+domain\b/i,
  /\bown\s+this\s+domain\b/i,
  /\bclaim\s+this\s+domain\b/i,

  /\bpremium\s+domain\b/i,
  /\bpremium\s+domain\s+name\b/i,
  /\bdomain\s+marketplace\b/i,
  /\bdomain\s+auction\b/i,
  /\bdomain\s+parking\b/i,
  /\bparked\s+domain\b/i,
  /\bdomain\s+is\s+parked\b/i,

  /\bmake\s+an\s+offer\b/i,
  /\bmake\s+an\s+offer\s+for\s+this\s+domain\b/i,
  /\binquire\s+about\s+this\s+domain\b/i,
  /\binquire\s+for\s+this\s+domain\b/i,

  /\bsedo\b/i,
  /\bafternic\b/i,
  /\bdan\.com\b/i,
  /\bparkingcrew\b/i,
  /\bparking\s+crew\b/i,
  /\bhugedomains\b/i,
  /\bbodis\b/i,
  /\bparklogic\b/i,

  /\brelated\s+searches\b/i,
  /\bdomain\s+has\s+been\s+registered\b/i,
  /\bdomain\s+registration\b/i,

  /\bthis\s+webpage\s+is\s+parked\b/i,
  /\bwebsite\s+coming\s+soon\b/i,
  /\bcoming\s+soon\b/i,
  /\bunder\s+construction\b/i,
  /\bfuture\s+home\s+of\b/i
];


const PARKED_URL_PATTERNS = [
  /sedo\.com/i,
  /afternic\.com/i,
  /dan\.com/i,
  /hugedomains\.com/i,
  /parkingcrew\.net/i,
  /parklogic\.com/i
];


/* =========================================================
 * DEEP SCAN PATHS
 * ========================================================= */

const RELEVANT_PATHS = [

  "/invest",
  "/investment",
  "/investments",
  "/plans",
  "/investment-plans",
  "/profit-plans",
  "/earning-plans",
  "/earn",
  "/earning",
  "/earnings",
  "/income",

  "/deposit",
  "/deposits",
  "/deposit-funds",
  "/fund",
  "/funds",

  "/withdraw",
  "/withdrawal",
  "/withdrawals",

  "/trading",
  "/trade",
  "/forex",
  "/broker",

  "/crypto",
  "/cryptocurrency",
  "/staking",
  "/mining",
  "/defi",

  "/portfolio",
  "/assets",
  "/wealth",

  "/referral",
  "/referrals",
  "/affiliate",

  "/account",
  "/dashboard",
  "/login",
  "/register",

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

  "/faq",
  "/help",
  "/support"
];


/* =========================================================
 * MAIN HANDLER
 * ========================================================= */

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
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

        noPaymentCandidates: 0,

        candidates: [],

        selectedPayments
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
              item.registeredAt || null,

            registrationVerified:
              item.registrationVerified === true,

            status:
              "error",

            websiteType:
              "scanner-error",

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
          item.status === "active"
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
          item.investment?.relevant === true
      );


    const paymentMatches =
      investmentMatches.filter(
        item =>
          hasSelectedPayment(
            item.paymentMethods,
            selectedPayments
          )
      );


    const candidates =
      investmentMatches.sort(
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

      parkedRejected:
        parkedRejected.length,

      investmentMatches:
        investmentMatches.length,

      paymentMatches:
        paymentMatches.length,

      noPaymentCandidates:
        investmentMatches.filter(
          item =>
            !hasSelectedPayment(
              item.paymentMethods,
              selectedPayments
            )
        ).length,

      candidates,

      selectedPayments
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

    registrationVerified:
      input?.registrationVerified === true,

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

    parked: {
      isParked: false,
      confidence: "none",
      matches: []
    },

    investment: {

      relevant:
        false,

      score:
        0,

      confidence:
        "none",

      keywords:
        [],

      dailyReturnClaims:
        [],

      roiClaims:
        [],

      signalGroups:
        [],

      actionSignals:
        [],

      contextualSignals:
        [],

      primarySignalCount:
        0,

      strongSignalCount:
        0,

      actionableSignalCount:
        0,

      financialContextCount:
        0
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
   * Registration verification is mandatory.
   */

  if (
    input?.registrationVerified !== true
  ) {

    result.errors.push(
      "Domain registration is not verified"
    );

    result.websiteType =
      "registration-unverified";

    return result;
  }


  /* =====================================================
   * HOMEPAGE
   * ===================================================== */

  let page =
    await fetchPage(
      `https://${domain}/`
    );


  if (!page.hasContent) {

    page =
      await fetchPage(
        `http://${domain}/`
      );
  }


  if (!page.hasContent) {

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


  /* =====================================================
   * BASIC PAGE DATA
   * ===================================================== */

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


  /* =====================================================
   * HARD PARKING GATE
   * ===================================================== */

  const parkedAnalysis =
    detectParkedPage(
      page,
      combined,
      result.finalUrl,
      result.title
    );


  result.parked =
    parkedAnalysis;


  if (parkedAnalysis.isParked) {

    result.websiteType =
      "parked-or-for-sale";

    result.status =
      "inactive";

    result.errors.push(
      parkedAnalysis.reason
    );

    return result;
  }


  /* =====================================================
   * EMPTY / PLACEHOLDER GATE
   * ===================================================== */

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


  /* =====================================================
   * INITIAL ANALYSIS
   * ===================================================== */

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


  result.snippets.push(
    ...collectSignalSnippets(
      combined
    )
  );


  /* =====================================================
   * DEEP SCAN
   *
   * Only relevant pages are fetched.
   * Payment alone does NOT trigger candidate status.
   * ===================================================== */

  const shouldDeepScan =
    shouldPerformDeepScan(
      result.investment,
      result.paymentMethods
    );


  if (shouldDeepScan) {

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
        result.pagesChecked.includes(
          url
        )
      ) {
        continue;
      }


      const child =
        await fetchPage(url);


      if (!child.hasContent) {
        continue;
      }


      const childTitle =
        extractTitle(
          child.text
        );


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
          25000
        );


      /*
       * NEVER allow parked child pages to contribute
       * financial evidence.
       */

      const childParked =
        detectParkedPage(
          child,
          childCombined,
          child.finalUrl,
          childTitle
        );


      if (childParked.isParked) {
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


      result.snippets.push(
        ...collectSignalSnippets(
          childCombined
        )
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
      40
    );


  result.rawSignals =
    uniqueStrings(
      result.rawSignals
    );


  /*
   * FINAL CONTEXT DECISION
   */

  result.investment.relevant =
    isInvestmentCandidate(
      result.investment,
      result.content
    );


  result.transparency.candidate =
    result.investment.relevant;


  return result;
}


/* =========================================================
 * FINAL INVESTMENT CANDIDATE DECISION
 * ========================================================= */

function isInvestmentCandidate(
  investment,
  content
) {

  if (!investment) {
    return false;
  }


  const text =
    String(
      content || ""
    ).toLowerCase();


  /*
   * A genuine financial activity usually contains
   * one or more of these combinations.
   */

  const contextualPairs = [

    [
      /\binvest(?:ment|ing)?\b/i,
      /\b(?:plan|program|package|opportunity|account|fund|deposit|profit|return|roi)\b/i
    ],

    [
      /\bdeposit\b/i,
      /\b(?:profit|return|earning|income|investment|plan|withdraw)\b/i
    ],

    [
      /\bprofit\b/i,
      /\b(?:plan|daily|weekly|monthly|deposit|investment|withdraw|earning|income|return)\b/i
    ],

    [
      /\bearning\b/i,
      /\b(?:plan|program|deposit|investment|profit|income|withdraw|daily|monthly)\b/i
    ],

    [
      /\b(?:trading|trade)\b/i,
      /\b(?:account|platform|broker|signals?|deposit|profit|forex|crypto)\b/i
    ],

    [
      /\bforex\b/i,
      /\b(?:trading|broker|account|signals?|deposit|profit)\b/i
    ],

    [
      /\bcrypto(?:currency)?\b/i,
      /\b(?:investment|investing|trading|earning|staking|mining|deposit|profit|yield|wallet)\b/i
    ],

    [
      /\bbitcoin\b/i,
      /\b(?:mining|investment|investing|trading|staking|earning|profit|deposit)\b/i
    ],

    [
      /\bstaking\b/i,
      /\b(?:rewards?|profit|income|earn|apy|yield|deposit)\b/i
    ],

    [
      /\bmining\b/i,
      /\b(?:profit|income|earning|rewards?|investment|deposit|cloud)\b/i
    ],

    [
      /\byield\b/i,
      /\b(?:farming|rewards?|profit|investment|deposit|apy|earn)\b/i
    ],

    [
      /\bwithdraw(?:al)?\b/i,
      /\b(?:profit|earning|income|investment|deposit|funds?)\b/i
    ],

    [
      /\breferral\b/i,
      /\b(?:earning|income|commission|investment|profit|deposit)\b/i
    ]
  ];


  let contextualMatches =
    0;


  for (
    const [a, b]
    of contextualPairs
  ) {

    if (
      a.test(text) &&
      b.test(text)
    ) {

      contextualMatches++;
    }
  }


  /*
   * Actionable financial activity.
   */

  const actionablePatterns = [

    /\binvest\s+now\b/i,
    /\bstart\s+investing\b/i,
    /\bstart\s+trading\b/i,
    /\bdeposit\s+now\b/i,
    /\bminimum\s+deposit\b/i,
    /\binvestment\s+plans?\b/i,
    /\bprofit\s+plans?\b/i,
    /\bearning\s+plans?\b/i,
    /\bchoose\s+(?:a\s+)?plan\b/i,
    /\bselect\s+(?:a\s+)?plan\b/i,
    /\bcreate\s+account\b/i,
    /\bregister\s+now\b/i,
    /\btrading\s+account\b/i,
    /\binvestment\s+account\b/i,
    /\bwithdraw\s+profit\b/i,
    /\bwithdraw\s+earnings?\b/i,
    /\bdeposit\s+funds?\b/i,
    /\bfund\s+your\s+account\b/i,
    /\bstake\s+and\s+earn\b/i,
    /\bcloud\s+mining\b/i
  ];


  let actionable =
    0;


  for (
    const pattern
    of actionablePatterns
  ) {

    if (
      pattern.test(text)
    ) {
      actionable++;
    }
  }


  /*
   * Strong percentage / ROI claims.
   */

  const strongClaim =
    investment.strongSignalCount > 0;


  /*
   * Multiple independent financial groups.
   */

  const groups =
    new Set(
      investment.signalGroups || []
    );


  const financialGroupCount =
    groups.size;


  /*
   * FINAL RULE
   *
   * 1. Strong financial claim + financial context
   * 2. At least one strong contextual combination
   * 3. Multiple independent financial groups
   *    AND at least one actionable signal
   * 4. Explicit investment/trading/earning platform
   *
   * Generic words alone NEVER qualify.
   */

  if (
    strongClaim &&
    contextualMatches >= 1
  ) {
    return true;
  }


  if (
    contextualMatches >= 2
  ) {
    return true;
  }


  if (
    financialGroupCount >= 3 &&
    actionable >= 1
  ) {
    return true;
  }


  if (
    actionable >= 2 &&
    financialGroupCount >= 2
  ) {
    return true;
  }


  /*
   * Explicit financial platform patterns.
   */

  if (
    /\b(?:investment|trading|earning)\s+platform\b/i.test(text) &&
    (
      /\b(?:account|deposit|profit|return|register|login)\b/i.test(text)
    )
  ) {
    return true;
  }


  return false;
}


/* =========================================================
 * DEEP SCAN DECISION
 * ========================================================= */

function shouldPerformDeepScan(
  investment,
  payments
) {

  if (
    investment?.relevant === true
  ) {
    return true;
  }


  if (
    investment?.signalGroups?.length >= 2
  ) {
    return true;
  }


  /*
   * Payment evidence alone does not make a candidate.
   * We only deep scan payment-heavy pages when there is
   * at least one financial signal.
   */

  if (
    payments?.detected?.length &&
    investment?.primarySignalCount > 0
  ) {
    return true;
  }


  return false;
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
      finalUrl || "",
      page?.text || ""
    ].join("\n");


  const matches = [];


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
        String(
          finalUrl || ""
        )
      )
    ) {

      matches.push(
        String(
          finalUrl
        )
      );
    }
  }


  /*
   * Explicit parking / sale signal = HARD REJECT.
   */

  const explicitSale =
    matches.some(
      value =>
        /for\s+sale|buy\s+(?:this\s+)?domain|purchase\s+(?:this\s+)?domain|premium\s+domain|domain\s+marketplace|domain\s+auction|make\s+an\s+offer|inquire\s+about\s+this\s+domain/i
          .test(value)
    );


  if (explicitSale) {

    return {

      isParked:
        true,

      confidence:
        "high",

      matches:
        uniqueStrings(
          matches
        ),

      reason:
        "Parked or for-sale domain page detected"
    };
  }


  /*
   * Registrar / parking provider URL.
   */

  if (
    PARKED_URL_PATTERNS.some(
      pattern =>
        pattern.test(
          String(
            finalUrl || ""
          )
        )
    )
  ) {

    return {

      isParked:
        true,

      confidence:
        "high",

      matches:
        uniqueStrings(
          matches
        ),

      reason:
        "Domain marketplace or parking provider detected"
    };
  }


  /*
   * Placeholder page.
   */

  if (
    /coming\s+soon|under\s+construction|future\s+home\s+of/i.test(
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
        "high",

      matches:
        uniqueStrings(
          matches
        ),

      reason:
        "Placeholder/coming-soon website detected"
    };
  }


  /*
   * Multiple weak parking indicators together.
   */

  const weakParking =
    [
      /\bparked\b/i,
      /\bparking\b/i,
      /\brelated\s+searches\b/i,
      /\bpremium\s+domain\b/i,
      /\bdomain\s+name\b/i,
      /\bthis\s+domain\b/i
    ];


  let weakCount =
    0;


  for (
    const pattern
    of weakParking
  ) {

    if (
      pattern.test(text)
    ) {
      weakCount++;
    }
  }


  if (
    weakCount >= 3 &&
    !/\b(?:investment|trading|staking|mining|deposit|earning\s+plan)\b/i.test(text)
  ) {

    return {

      isParked:
        true,

      confidence:
        "medium",

      matches:
        uniqueStrings(
          matches
        ),

      reason:
        "Multiple domain-parking indicators detected"
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
      .replace(
        /\s+/g,
        " "
      )
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
    cleaned.length < 350 &&
    (
      titleOnly === "coming soon" ||
      titleOnly === "under construction" ||
      titleOnly === "domain for sale" ||
      titleOnly === "this domain is for sale" ||
      titleOnly === "parking page" ||
      titleOnly === "domain parking" ||
      titleOnly === "parked"
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


  let matchedPrimary =
    0;

  let matchedStrong =
    0;


  /*
   * Primary signals.
   */

  for (
    const [group, patterns]
    of Object.entries(
      SIGNAL_PATTERNS
    )
  ) {

    let groupMatched =
      false;


    for (
      const pattern
      of patterns
    ) {

      const match =
        value.match(pattern);


      if (!match) {
        continue;
      }


      const keyword =
        match[0].trim();


      if (
        !result.investment.keywords.includes(
          keyword
        )
      ) {

        result.investment.keywords.push(
          keyword
        );

        matchedPrimary++;
      }


      result.investment.score +=
        signalWeight(
          group,
          keyword
        );


      groupMatched =
        true;
    }


    if (
      groupMatched &&
      !result.investment.signalGroups.includes(
        group
      )
    ) {

      result.investment.signalGroups.push(
        group
      );
    }
  }


  /*
   * Daily / guaranteed / high-return signals.
   */

  for (
    const pattern
    of DAILY_RETURN_PATTERNS
  ) {

    const matches =
      value.match(
        new RegExp(
          pattern.source,
          pattern.flags.includes("g")
            ? pattern.flags
            : pattern.flags + "g"
        )
      );


    if (!matches) {
      continue;
    }


    matchedStrong +=
      matches.length;


    result.investment.score +=
      18;


    result.investment.dailyReturnClaims.push(
      ...matches
    );
  }


  /*
   * ROI signals.
   */

  for (
    const pattern
    of ROI_PATTERNS
  ) {

    const matches =
      value.match(
        new RegExp(
          pattern.source,
          pattern.flags.includes("g")
            ? pattern.flags
            : pattern.flags + "g"
        )
      );


    if (!matches) {
      continue;
    }


    matchedStrong +=
      matches.length;


    result.investment.score +=
      12;


    result.investment.roiClaims.push(
      ...matches
    );
  }


  /*
   * Action signals.
   */

  for (
    const pattern
    of SIGNAL_PATTERNS.action
  ) {

    if (
      pattern.test(value)
    ) {

      result.investment.actionableSignalCount++;
    }
  }


  /*
   * Contextual combinations.
   */

  const contextualPairs = [

    [/\binvest(?:ment|ing)?\b/i, /\b(?:plan|program|package|opportunity|deposit|profit|return|roi)\b/i],
    [/\bdeposit\b/i, /\b(?:profit|return|earning|income|investment|withdraw)\b/i],
    [/\bprofit\b/i, /\b(?:plan|daily|weekly|monthly|deposit|investment|earning|income|return)\b/i],
    [/\bearning\b/i, /\b(?:plan|program|deposit|investment|profit|income|withdraw|daily|monthly)\b/i],
    [/\btrading\b/i, /\b(?:account|platform|broker|signals?|deposit|profit|forex|crypto)\b/i],
    [/\bforex\b/i, /\b(?:trading|broker|account|signals?|deposit|profit)\b/i],
    [/\bcrypto(?:currency)?\b/i, /\b(?:investment|investing|trading|earning|staking|mining|deposit|profit|yield)\b/i],
    [/\bstaking\b/i, /\b(?:rewards?|profit|income|earn|apy|yield|deposit)\b/i],
    [/\bmining\b/i, /\b(?:profit|income|earning|rewards?|investment|deposit|cloud)\b/i],
    [/\bwithdraw(?:al)?\b/i, /\b(?:profit|earning|income|investment|deposit|funds?)\b/i],
    [/\breferral\b/i, /\b(?:earning|income|commission|investment|profit|deposit)\b/i]
  ];


  let contextual =
    0;


  for (
    const [a, b]
    of contextualPairs
  ) {

    if (
      a.test(value) &&
      b.test(value)
    ) {

      contextual++;
    }
  }


  result.investment.financialContextCount +=
    contextual;


  /*
   * Relevance score.
   *
   * This score is NOT the Gemini scam score.
   */

  result.investment.score +=
    contextual * 8;


  /*
   * Counts.
   */

  result.investment.primarySignalCount +=
    matchedPrimary;

  result.investment.strongSignalCount +=
    matchedStrong;


  /*
   * Keyword arrays.
   */

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


  result.investment.contextualSignals =
    uniqueStrings(
      result.investment.contextualSignals
        .concat(
          contextual > 0
            ? [
                `${contextual} financial context combination(s)`
              ]
            : []
        )
    );


  /*
   * Cap internal score.
   */

  result.investment.score =
    Math.min(
      result.investment.score,
      100
    );


  /*
   * Preliminary relevance.
   */

  result.investment.relevant =
    isInvestmentCandidate(
      result.investment,
      value
    );


  if (
    result.investment.relevant
  ) {

    result.investment.confidence =
      result.investment.score >= 70
        ? "high"
        : result.investment.score >= 40
          ? "medium"
          : "low";
  }
}


/* =========================================================
 * SIGNAL WEIGHTS
 * ========================================================= */

function signalWeight(
  group,
  keyword
) {

  const value =
    String(
      keyword || ""
    ).toLowerCase();


  switch (group) {

    case "investment":
      return 10;

    case "deposit":
      return 8;

    case "profit":
      return 8;

    case "return":
      return 7;

    case "roi":
      return 10;

    case "earning":
      return 7;

    case "withdrawal":
      return 7;

    case "trading":
      return 9;

    case "forex":
      return 9;

    case "crypto":
      return 6;

    case "staking":
      return 9;

    case "mining":
      return 9;

    case "yield":
      return 8;

    case "referral":
      return 3;

    case "account":
      return 4;

    case "action":
      return 6;

    default:
      break;
  }


  if (
    /guaranteed|fixed|daily|monthly|weekly/i.test(
      value
    )
  ) {
    return 10;
  }


  return 2;
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
 * PAYMENT FILTER
 *
 * REPORTING ONLY
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
      .map(
        item =>
          String(item)
            .trim()
            .toLowerCase()
      )
      .filter(
        item =>
          allowed.has(item)
      )
  );
}


function hasSelectedPayment(
  paymentMethods,
  selectedPayments
) {

  if (
    !Array.isArray(
      selectedPayments
    ) ||
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
    /company|about us|who we are|our team|management|head office|registered office|company registration/i
      .test(value)
  ) {

    result.transparency.company.push(
      "Company/business information detected"
    );
  }


  if (
    /privacy policy|terms and conditions|terms of service|legal notice|refund policy|risk disclosure|legal disclaimer/i
      .test(value)
  ) {

    result.transparency.legal.push(
      "Legal/privacy information detected"
    );
  }


  if (
    /contact us|support|customer service|email us|live chat|telegram|whatsapp|discord|ticket support/i
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
              "Mozilla/5.0 LD76-Investment-Radar/3.0"
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
        error?.name === "AbortError"
          ? `Request timeout after ${REQUEST_TIMEOUT_MS}ms`
          : (
              error?.message ||
              "Request failed"
            )
    };


  } finally {

    clearTimeout(
      timer
    );
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

  const source =
    String(html || "");


  const patterns = [

    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i
  ];


  for (
    const pattern
    of patterns
  ) {

    const match =
      source.match(
        pattern
      );


    if (match) {

      return cleanHtmlText(
        match[1]
      );
    }
  }


  return null;
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
    (match =
      regex.exec(
        String(html || "")
      ))
  ) {

    links.push(
      match[1]
    );
  }


  return links.join(
    "\n"
  );
}


function extractPageLinks(
  html,
  baseUrl
) {

  const links = [];


  const regex =
    /href\s*=\s*["']([^"']+)["']/gi;


  let match;


  while (
    (match =
      regex.exec(
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

  const selected = [];


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

  const snippets = [];


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


    /*
     * Only collect financially meaningful lines.
     * Generic payment-only lines are not enough.
     */

    if (
      /investment|investing|investor|profit|roi|return\s+on\s+investment|trading|forex|staking|crypto\s+investment|crypto\s+trading|mining\s+profit|earning\s+plan|passive\s+income|deposit\s+profit|withdraw\s+profit|daily\s+profit|daily\s+return|referral\s+earning|referral\s+commission/i
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
      snippets.length >= 30
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

    const domain =
      normalizeDomain(
        value
      );


    if (!domain) {
      return null;
    }


    return {

      domain,

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

    const domain =
      normalizeDomain(
        value.domain
      );


    if (!domain) {
      return null;
    }


    return {

      domain,

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
        length:
          workers
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
