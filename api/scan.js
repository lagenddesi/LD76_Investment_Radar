"use strict";

/*
 * LD76 INVESTMENT RADAR
 * =====================
 * WEBSITE SCANNER
 *
 * Input:
 *   domains[]
 *
 * Output:
 *   scanned website evidence + financial candidates
 *
 * IMPORTANT:
 * - Discover already verifies registration.
 * - Scanner does NOT decide scam score.
 * - Gemini/analyze.js does that.
 * - Payment methods are evidence only.
 * - No artificial candidate limit.
 */

const CONCURRENCY = 20;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 350000;
const MAX_TEXT_CHARS = 90000;
const MAX_DEEP_PAGES = 10;


/* =========================================================
   HTTP
========================================================= */

async function fetchPage(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "LD76-Investment-Radar/9.0",
        "Accept":
          "text/html,application/xhtml+xml,application/json,text/plain,*/*"
      },
      signal: controller.signal
    });

    const buffer = await response.arrayBuffer();

    if (!buffer.byteLength) {
      return {
        ok: false,
        hasContent: false,
        status: response.status,
        finalUrl: response.url || url,
        text: "",
        error: "Empty response"
      };
    }

    const limited = buffer.slice(
      0,
      MAX_HTML_BYTES
    );

    const text = new TextDecoder(
      "utf-8",
      { fatal: false }
    ).decode(limited);

    return {
      ok: response.ok,
      hasContent: text.trim().length > 0,
      status: response.status,
      finalUrl: response.url || url,
      text,
      error: null
    };

  } catch (error) {
    return {
      ok: false,
      hasContent: false,
      status: null,
      finalUrl: url,
      text: "",
      error:
        error?.name === "AbortError"
          ? "Request timeout"
          : error?.message || "Request failed"
    };

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   DOMAIN
========================================================= */

function normalizeDomain(value) {
  if (typeof value === "string") {
    value = {
      domain: value
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  let domain = String(
    value.domain || ""
  )
    .trim()
    .toLowerCase();

  domain = domain.replace(
    /^https?:\/\//,
    ""
  );

  domain = domain.replace(
    /^www\./,
    ""
  );

  domain = domain
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/\.$/, "");

  if (
    !domain ||
    domain.length > 253 ||
    /\s|\\/.test(domain)
  ) {
    return null;
  }

  const valid =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

  if (!valid.test(domain)) {
    return null;
  }

  return {
    domain,
    registeredAt:
      value.registeredAt || null,
    discoveredAt:
      value.discoveredAt || null,
    registrationVerified:
      value.registrationVerified === true,
    registrationSource:
      value.registrationSource || null
  };
}


function uniqueDomains(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const normalized =
      normalizeDomain(item);

    if (!normalized) {
      continue;
    }

    if (seen.has(normalized.domain)) {
      continue;
    }

    seen.add(normalized.domain);
    output.push(normalized);
  }

  return output;
}


/* =========================================================
   CONCURRENCY
========================================================= */

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {
  const results = new Array(
    items.length
  );

  let index = 0;

  async function runner() {
    while (true) {
      const current = index++;

      if (current >= items.length) {
        return;
      }

      try {
        results[current] =
          await worker(
            items[current],
            current
          );
      } catch (error) {
        results[current] = {
          error:
            error?.message ||
            "Worker failed"
        };
      }
    }
  }

  const workers = [];

  const count = Math.min(
    concurrency,
    items.length
  );

  for (
    let i = 0;
    i < count;
    i++
  ) {
    workers.push(
      runner()
    );
  }

  await Promise.all(workers);

  return results;
}


/* =========================================================
   TEXT
========================================================= */

function stripHtml(html) {
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
      /<!--[\s\S]*?-->/g,
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
      "\""
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
      MAX_TEXT_CHARS
    );
}


function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}


function extractTitle(html) {
  const match =
    String(html || "").match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  return match
    ? stripHtml(match[1]).slice(0, 300)
    : null;
}


function extractDescription(html) {
  const match =
    String(html || "").match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
    );

  if (!match) {
    return null;
  }

  return String(match[1])
    .trim()
    .slice(0, 500);
}


/* =========================================================
   LINKS
========================================================= */

function extractLinks(
  html,
  baseUrl
) {
  const output = [];
  const seen = new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = regex.exec(
      String(html || "")
    ))
  ) {
    const href =
      String(match[1] || "")
        .trim();

    if (!href) {
      continue;
    }

    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      continue;
    }

    try {
      const absolute =
        new URL(
          href,
          baseUrl
        );

      if (
        absolute.protocol !== "http:" &&
        absolute.protocol !== "https:"
      ) {
        continue;
      }

      const normalized =
        absolute.origin +
        absolute.pathname +
        absolute.search;

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(normalized);

    } catch {
      // Ignore malformed links.
    }
  }

  return output;
}


/* =========================================================
   PAGE CLASSIFICATION
========================================================= */

const PARKING_PATTERNS = [
  /domain\s+for\s+sale/i,
  /this\s+domain\s+is\s+for\s+sale/i,
  /buy\s+(this\s+)?domain/i,
  /purchase\s+(this\s+)?domain/i,
  /make\s+an\s+offer/i,
  /premium\s+domain/i,
  /domain\s+marketplace/i,
  /domain\s+auction/i,
  /domain\s+parking/i,
  /parked\s+domain/i,
  /domain\s+is\s+parked/i,
  /sedo/i,
  /afternic/i,
  /dan\.com/i,
  /hugedomains/i,
  /parkingcrew/i,
  /parking\s+crew/i,
  /parklogic/i,
  /bodis/i
];


function detectParking(
  text,
  title
) {
  const haystack =
    `${title || ""} ${text || ""}`;

  const matches = [];

  for (
    const pattern
    of PARKING_PATTERNS
  ) {
    const match =
      haystack.match(pattern);

    if (match) {
      matches.push(
        match[0]
      );
    }
  }

  const unique =
    Array.from(
      new Set(matches)
    );

  const strong =
    unique.some(
      value =>
        /for sale|buy|purchase|sedo|afternic|dan\.com|parking/i
          .test(value)
    );

  return {
    isParked:
      strong || unique.length >= 2,
    confidence:
      strong
        ? "high"
        : unique.length
          ? "medium"
          : "none",
    matches: unique
  };
}


/* =========================================================
   FINANCIAL SIGNALS
========================================================= */

const SIGNALS = {

  investment: [
    /\binvest\b/i,
    /\binvestment\b/i,
    /\binvesting\b/i,
    /\binvestor\b/i,
    /\binvestment\s+plan\b/i,
    /\binvestment\s+plans\b/i,
    /\binvestment\s+program\b/i,
    /\binvestment\s+package\b/i,
    /\binvestment\s+account\b/i,
    /\binvestment\s+platform\b/i
  ],

  trading: [
    /\btrading\b/i,
    /\btrader\b/i,
    /\btrading\s+platform\b/i,
    /\btrading\s+account\b/i,
    /\bcopy\s+trading\b/i,
    /\bautomated\s+trading\b/i
  ],

  forex: [
    /\bforex\b/i,
    /\bforex\s+trading\b/i,
    /\bforex\s+broker\b/i,
    /\bforex\s+signals?\b/i,
    /\bcurrency\s+trading\b/i
  ],

  crypto: [
    /\bcryptocurrency\b/i,
    /\bcrypto\b/i,
    /\bbitcoin\b/i,
    /\bbtc\b/i,
    /\bethereum\b/i,
    /\busdt\b/i,
    /\busdc\b/i,
    /\bdefi\b/i,
    /\bcrypto\s+investment\b/i,
    /\bcrypto\s+trading\b/i,
    /\bcrypto\s+earning\b/i
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
    /\bmining\s+profit\b/i
  ],

  earning: [
    /\bearning\b/i,
    /\bearnings\b/i,
    /\bmake\s+money\b/i,
    /\bmake\s+income\b/i,
    /\bpassive\s+income\b/i,
    /\bpassive\s+earning\b/i,
    /\bincome\s+plan\b/i,
    /\bincome\s+program\b/i,
    /\bdaily\s+earning\b/i,
    /\bdaily\s+earnings\b/i
  ],

  deposit: [
    /\bdeposit\b/i,
    /\bminimum\s+deposit\b/i,
    /\bdeposit\s+amount\b/i,
    /\bdeposit\s+money\b/i,
    /\badd\s+funds?\b/i,
    /\bfund\s+your\s+account\b/i
  ],

  withdrawal: [
    /\bwithdraw\b/i,
    /\bwithdrawal\b/i,
    /\bwithdrawals\b/i,
    /\bwithdraw\s+profit\b/i,
    /\bwithdraw\s+earnings?\b/i
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
  ]
};


const ACTION_PATTERNS = [
  /\binvest\s+now\b/i,
  /\bstart\s+investing\b/i,
  /\bstart\s+trading\b/i,
  /\bdeposit\s+now\b/i,
  /\bchoose\s+(a\s+)?plan\b/i,
  /\bselect\s+(a\s+)?plan\b/i,
  /\bstart\s+earning\b/i,
  /\bwithdraw\s+now\b/i,
  /\bjoin\s+now\b/i
];


const DAILY_RETURN_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%\s*(?:per\s*)?day\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*daily\b/i,
  /\bdaily\s+profit\b/i,
  /\bdaily\s+return\b/i,
  /\bdaily\s+income\b/i,
  /\bguaranteed\s+profit\b/i,
  /\bguaranteed\s+return\b/i,
  /\bguaranteed\s+income\b/i,
  /\bfixed\s+profit\b/i,
  /\bfixed\s+return\b/i,
  /\bhigh\s+profit\b/i,
  /\bhigh\s+return\b/i
];


const ROI_PATTERNS = [
  /\broi\b/i,
  /\breturn\s+on\s+investment\b/i,
  /\bprofit\s+rate\b/i,
  /\breturn\s+rate\b/i,
  /\bpercentage\s+return\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:roi|return|profit)\b/i
];


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

  return Array.from(
    new Set(matches)
  );
}


function analyzeFinancialContent(
  text
) {
  const normalized =
    normalizeText(text);

  const signalGroups = [];
  const keywords = [];

  for (
    const [group, patterns]
    of Object.entries(SIGNALS)
  ) {
    const matches =
      collectMatches(
        normalized,
        patterns
      );

    if (matches.length) {
      signalGroups.push(group);

      for (
        const match
        of matches
      ) {
        keywords.push(match);
      }
    }
  }

  const dailyReturnClaims =
    collectMatches(
      normalized,
      DAILY_RETURN_PATTERNS
    );

  const roiClaims =
    collectMatches(
      normalized,
      ROI_PATTERNS
    );

  const actionSignals =
    collectMatches(
      normalized,
      ACTION_PATTERNS
    );

  const primaryGroups =
    signalGroups.filter(
      group =>
        [
          "investment",
          "trading",
          "forex",
          "crypto",
          "staking",
          "mining",
          "earning"
        ].includes(group)
    );

  const financialContext =
    signalGroups.filter(
      group =>
        [
          "deposit",
          "withdrawal",
          "referral"
        ].includes(group)
    );

  /*
   * A website becomes financially relevant
   * only when there is actual context.
   *
   * Generic crypto/bank/etc. alone is not enough.
   */

  const primarySignalCount =
    primaryGroups.length;

  const strongSignalCount =
    dailyReturnClaims.length +
    roiClaims.length;

  const actionableSignalCount =
    actionSignals.length;

  const financialContextCount =
    financialContext.length;

  const relevant =
    primarySignalCount >= 1 &&
    (
      financialContextCount >= 1 ||
      strongSignalCount >= 1 ||
      actionableSignalCount >= 1 ||
      primarySignalCount >= 2
    );

  let score = 0;

  score +=
    primarySignalCount * 12;

  score +=
    financialContextCount * 8;

  score +=
    strongSignalCount * 15;

  score +=
    actionableSignalCount * 8;

  score = Math.min(
    score,
    100
  );

  let confidence =
    "low";

  if (
    relevant &&
    (
      strongSignalCount >= 1 ||
      financialContextCount >= 2 ||
      primarySignalCount >= 2
    )
  ) {
    confidence = "high";
  } else if (relevant) {
    confidence = "medium";
  }

  return {
    relevant,
    score,
    confidence,
    keywords:
      Array.from(
        new Set(keywords)
      ),
    dailyReturnClaims,
    roiClaims,
    signalGroups,
    actionSignals,
    contextualSignals:
      financialContext,
    primarySignalCount,
    strongSignalCount,
    actionableSignalCount,
    financialContextCount
  };
}


/* =========================================================
   PAYMENT EVIDENCE
========================================================= */

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
    /\busdc\b/i,
    /\bcrypto\s+wallet\b/i,
    /\bwallet\s+address\b/i
  ]
};


function detectPayments(text) {
  const result = {
    bank: false,
    easypaisa: false,
    jazzcash: false,
    crypto: false,
    detected: []
  };

  for (
    const [method, patterns]
    of Object.entries(
      PAYMENT_PATTERNS
    )
  ) {
    const matches =
      collectMatches(
        text,
        patterns
      );

    if (matches.length) {
      result[method] = true;

      result.detected.push({
        method,
        matches
      });
    }
  }

  return result;
}


/* =========================================================
   TRANSPARENCY / LEGAL
========================================================= */

const TRANSPARENCY_PATTERNS = {

  company: [
    /\bcompany\b/i,
    /\bregistered\s+company\b/i,
    /\bregistration\s+number\b/i,
    /\bcorporation\b/i,
    /\blimited\b/i,
    /\bltd\b/i,
    /\binc\b/i,
    /\bllc\b/i
  ],

  legal: [
    /\bterms\s+(?:and\s+conditions|of\s+service)\b/i,
    /\bprivacy\s+policy\b/i,
    /\brisk\s+disclosure\b/i,
    /\blicense\b/i,
    /\blicensed\b/i,
    /\bregulator\b/i,
    /\bregulated\b/i,
    /\brefund\s+policy\b/i,
    /\bwithdrawal\s+policy\b/i
  ],

  support: [
    /\bcontact\s+us\b/i,
    /\bcontact\b/i,
    /\bsupport\b/i,
    /\bhelp\s+center\b/i,
    /\btelegram\b/i,
    /\bwhatsapp\b/i,
    /\bemail\b/i
  ]
};


function detectTransparency(text) {
  const result = {
    company: [],
    legal: [],
    support: [],
    candidate: false
  };

  for (
    const category of [
      "company",
      "legal",
      "support"
    ]
  ) {
    result[category] =
      collectMatches(
        text,
        TRANSPARENCY_PATTERNS[
          category
        ]
      );
  }

  result.candidate =
    result.company.length > 0 ||
    result.legal.length > 0;

  return result;
}


/* =========================================================
   SNIPPETS
========================================================= */

function makeSnippets(
  text,
  keywords
) {
  const source =
    String(text || "");

  const snippets = [];
  const seen = new Set();

  for (
    const keyword
    of keywords.slice(0, 20)
  ) {
    const index =
      source
        .toLowerCase()
        .indexOf(
          String(keyword)
            .toLowerCase()
        );

    if (index < 0) {
      continue;
    }

    const start =
      Math.max(
        0,
        index - 120
      );

    const end =
      Math.min(
        source.length,
        index + 260
      );

    const snippet =
      source
        .slice(start, end)
        .trim();

    if (
      !snippet ||
      seen.has(snippet)
    ) {
      continue;
    }

    seen.add(snippet);

    snippets.push(snippet);

    if (snippets.length >= 12) {
      break;
    }
  }

  return snippets;
}


/* =========================================================
   DEEP PAGE SELECTION
========================================================= */

function isRelevantLink(url) {
  return /\/(about|contact|terms|privacy|withdraw|deposit|investment|invest|plans?|pricing|trading|forex|crypto|staking|mining|earning|affiliate|referral|support|company|legal)/i
    .test(url);
}


function selectDeepPages(
  links,
  origin
) {
  const selected = [];
  const seen = new Set();

  for (
    const link
    of links
  ) {
    try {
      const parsed =
        new URL(link);

      if (
        parsed.origin !== origin
      ) {
        continue;
      }

      if (
        !isRelevantLink(
          parsed.pathname
        )
      ) {
        continue;
      }

      const normalized =
        parsed.origin +
        parsed.pathname;

      if (
        seen.has(normalized)
      ) {
        continue;
      }

      seen.add(normalized);
      selected.push(link);

      if (
        selected.length >=
        MAX_DEEP_PAGES
      ) {
        break;
      }

    } catch {
      // Ignore invalid URL.
    }
  }

  return selected;
}


/* =========================================================
   SCAN ONE DOMAIN
========================================================= */

async function scanDomain(input) {
  const item =
    normalizeDomain(input);

  if (!item) {
    return {
      domain: null,
      status: "error",
      websiteType: "invalid-domain",
      errors: [
        "Invalid domain"
      ]
    };
  }

  const result = {

    domain:
      item.domain,

    registeredAt:
      item.registeredAt,

    registrationVerified:
      item.registrationVerified,

    registrationSource:
      item.registrationSource,

    discoveredAt:
      item.discoveredAt,

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
      relevant: false,
      score: 0,
      confidence: "none",
      keywords: [],
      dailyReturnClaims: [],
      roiClaims: [],
      signalGroups: [],
      actionSignals: [],
      contextualSignals: [],
      primarySignalCount: 0,
      strongSignalCount: 0,
      actionableSignalCount: 0,
      financialContextCount: 0
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
   * Discover must have verified registration.
   */

  if (
    item.registrationVerified !== true
  ) {
    result.websiteType =
      "registration-unverified";

    result.errors.push(
      "Domain registration is not verified"
    );

    return result;
  }


  /*
   * HTTPS first.
   */

  let page =
    await fetchPage(
      `https://${item.domain}/`
    );


  /*
   * HTTP fallback.
   */

  if (!page.hasContent) {
    page =
      await fetchPage(
        `http://${item.domain}/`
      );
  }


  if (!page.hasContent) {
    result.errors.push(
      page.error ||
      "Website is not accessible"
    );

    return result;
  }


  result.status =
    "active";

  result.httpStatus =
    page.status;

  result.finalUrl =
    page.finalUrl;

  result.https =
    page.finalUrl
      .startsWith("https://");

  result.technical = {
    https:
      result.https,
    status:
      page.status,
    redirects:
      0
  };


  /*
   * HTTP non-2xx can still contain
   * a real website. Content is what matters.
   */

  const title =
    extractTitle(
      page.text
    );

  const description =
    extractDescription(
      page.text
    );

  const text =
    stripHtml(
      page.text
    );

  result.title =
    title;

  result.websiteName =
    title ||
    item.domain;

  result.description =
    description;

  result.content =
    text;

  result.pagesChecked.push({
    url:
      page.finalUrl,
    status:
      page.status,
    type:
      "homepage"
  });


  /*
   * Parking detection happens before
   * financial candidate detection.
   */

  const parking =
    detectParking(
      text,
      title
    );

  result.parked =
    parking;


  if (parking.isParked) {
    result.websiteType =
      "parked-or-for-sale";

    return result;
  }


  result.websiteType =
    "real-active-website";


  /*
   * Homepage links.
   */

  const links =
    extractLinks(
      page.text,
      page.finalUrl
    );


  const deepPages =
    selectDeepPages(
      links,
      new URL(
        page.finalUrl
      ).origin
    );


  /*
   * Scan relevant internal pages.
   */

  const deepResults =
    await runWithConcurrency(
      deepPages,
      5,
      async url =>
        fetchPage(url)
    );


  let combinedText =
    text;

  for (
    let i = 0;
    i < deepResults.length;
    i++
  ) {
    const deep =
      deepResults[i];

    if (
      !deep ||
      !deep.hasContent
    ) {
      continue;
    }

    const deepText =
      stripHtml(
        deep.text
      );

    if (!deepText) {
      continue;
    }

    combinedText +=
      " " +
      deepText;

    result.pagesChecked.push({
      url:
        deep.finalUrl,
      status:
        deep.status,
      type:
        "internal"
    });
  }


  combinedText =
    combinedText.slice(
      0,
      MAX_TEXT_CHARS
    );


  /*
   * Re-check parking using combined content.
   */

  const deepParking =
    detectParking(
      combinedText,
      title
    );

  if (
    deepParking.isParked
  ) {
    result.parked =
      deepParking;

    result.websiteType =
      "parked-or-for-sale";

    return result;
  }


  /*
   * Financial analysis.
   */

  const financial =
    analyzeFinancialContent(
      combinedText
    );

  result.investment =
    financial;


  /*
   * Payment evidence.
   */

  result.paymentMethods =
    detectPayments(
      combinedText
    );


  /*
   * Transparency evidence.
   */

  result.transparency =
    detectTransparency(
      combinedText
    );


  /*
   * Raw signals.
   */

  result.rawSignals =
    financial.keywords;


  result.snippets =
    makeSnippets(
      combinedText,
      [
        ...financial.keywords,
        ...financial.dailyReturnClaims,
        ...financial.roiClaims
      ]
    );


  /*
   * Technical redirects.
   *
   * fetch follows redirects, so exact chain
   * is not available in standard fetch.
   * We expose final URL and calculate whether
   * the final host/protocol changed.
   */

  try {
    const original =
      new URL(
        `https://${item.domain}`
      );

    const final =
      new URL(
        page.finalUrl
      );

    result.technical.redirects =
      (
        original.hostname !==
          final.hostname ||
        original.protocol !==
          final.protocol ||
        final.pathname !== "/"
      )
        ? 1
        : 0;

  } catch {
    result.technical.redirects = 0;
  }


  return result;
}


/* =========================================================
   REQUEST BODY
========================================================= */

function getBody(req) {
  if (
    req.body &&
    typeof req.body === "object"
  ) {
    return req.body;
  }

  if (
    typeof req.body === "string"
  ) {
    try {
      return JSON.parse(
        req.body
      );
    } catch {
      return {};
    }
  }

  return {};
}


/* =========================================================
   PAYMENT FILTER
========================================================= */

function normalizePayments(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
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
        )
    )
  );
}


function hasSelectedPayment(
  paymentMethods,
  selected
) {
  if (!selected.length) {
    return true;
  }

  return selected.some(
    method =>
      paymentMethods?.[method] === true
  );
}


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      ok: false,
      error:
        "Method not allowed. Use POST."
    });
  }

  try {
    const body =
      getBody(req);

    const rawDomains =
      Array.isArray(
        body.domains
      )
        ? body.domains
        : [];

    const selectedPayments =
      normalizePayments(
        body.paymentMethods
      );

    /*
     * IMPORTANT:
     * No artificial domain limit.
     */

    const domains =
      uniqueDomains(
        rawDomains
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

        results: [],

        selectedPayments

      });
    }


    /*
     * Scan ALL supplied domains.
     */

    const results =
      await runWithConcurrency(
        domains,
        CONCURRENCY,
        scanDomain
      );


    const safeResults =
      results.filter(
        Boolean
      );


    const active =
      safeResults.filter(
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
      safeResults.filter(
        item =>
          item.websiteType ===
          "parked-or-for-sale"
      );


    /*
     * Financial candidates.
     *
     * Payment method is NOT required.
     */

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


    const noPaymentCandidates =
      investmentMatches.filter(
        item =>
          !hasSelectedPayment(
            item.paymentMethods,
            selectedPayments
          )
      );


    /*
     * Strongest financial evidence first.
     */

    investmentMatches.sort(
      (a, b) => {

        const scoreA =
          Number(
            a.investment?.score || 0
          );

        const scoreB =
          Number(
            b.investment?.score || 0
          );

        return scoreB - scoreA;
      }
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
        noPaymentCandidates.length,

      /*
       * ALL financially relevant websites.
       * Payment is evidence, not a hard filter.
       */

      candidates:
        investmentMatches,

      /*
       * Complete scanner results.
       */

      results:
        safeResults,

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
