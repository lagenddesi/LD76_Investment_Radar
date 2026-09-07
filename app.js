"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Main frontend controller
 *
 * IMPORTANT:
 * A domain is "already analyzed" ONLY when:
 *   aiAnalyzed === true
 *   AND aiScore is a valid 0-100 number.
 *
 * Failed/missing Gemini analysis is NEVER treated as analyzed.
 *
 * NO arbitrary 4/5/10 candidate limit.
 * ALL fresh candidates are sent to /api/analyze.
 */


/* =========================================================
   STATE
========================================================= */

const state = {
  domains: [],
  candidates: [],
  results: [],

  selectedTld: ".top",
  selectedPeriod: "1d",

  paymentMethods: [
    "bank",
    "easypaisa",
    "jazzcash"
  ],

  geminiEnabled: true,
  scanning: false,

  discoveredCount: 0,
  scannedCount: 0,
  relevantCount: 0,

  alreadyAnalyzedCount: 0,

  sentToGeminiCount: 0,
  successfullySavedCount: 0,

  geminiRequests: 0,

  currentView: "home",

  lastError: null
};


/* =========================================================
   INDEXEDDB
========================================================= */

const DB_NAME = "LD76_Investment_Radar";
const DB_VERSION = 1;
const STORE_NAME = "domains";


function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(
        DB_NAME,
        DB_VERSION
      );

      request.onupgradeneeded = event => {
        const db = event.target.result;

        if (
          !db.objectStoreNames.contains(
            STORE_NAME
          )
        ) {
          const store =
            db.createObjectStore(
              STORE_NAME,
              {
                keyPath: "domain"
              }
            );

          store.createIndex(
            "aiAnalyzed",
            "aiAnalyzed",
            {
              unique: false
            }
          );
        }
      };

      request.onsuccess = () => {
        resolve(
          request.result
        );
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error(
            "IndexedDB open failed"
          )
        );
      };

    } catch (error) {
      reject(error);
    }
  });
}


async function getDomain(domain) {
  const db =
    await openDB();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        db.transaction(
          STORE_NAME,
          "readonly"
        );

      const store =
        transaction.objectStore(
          STORE_NAME
        );

      const request =
        store.get(
          normalizeDomain(
            domain
          )
        );

      request.onsuccess = () => {
        resolve(
          request.result ||
          null
        );
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error(
            "IndexedDB read failed"
          )
        );
      };
    }
  );
}


async function saveDomain(record) {
  const db =
    await openDB();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        db.transaction(
          STORE_NAME,
          "readwrite"
        );

      const store =
        transaction.objectStore(
          STORE_NAME
        );

      const request =
        store.put(record);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error(
            "IndexedDB save failed"
          )
        );
      };
    }
  );
}


async function getAllDomains() {
  const db =
    await openDB();

  return new Promise(
    (resolve, reject) => {
      const transaction =
        db.transaction(
          STORE_NAME,
          "readonly"
        );

      const store =
        transaction.objectStore(
          STORE_NAME
        );

      const request =
        store.getAll();

      request.onsuccess = () => {
        resolve(
          Array.isArray(
            request.result
          )
            ? request.result
            : []
        );
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error(
            "IndexedDB getAll failed"
          )
        );
      };
    }
  );
}


/* =========================================================
   DOM HELPERS
========================================================= */

function $(selector) {
  return document.querySelector(
    selector
  );
}


function $all(selector) {
  return Array.from(
    document.querySelectorAll(
      selector
    )
  );
}


function setText(
  selector,
  value
) {
  const element =
    $(selector);

  if (!element) {
    return;
  }

  element.textContent =
    value == null
      ? ""
      : String(value);
}


function showElement(
  selector,
  visible
) {
  const element =
    $(selector);

  if (!element) {
    return;
  }

  element.style.display =
    visible
      ? ""
      : "none";
}


function setStatus(message) {
  console.log(
    "[LD76 STATUS]",
    message
  );

  setText(
    "#scanStatus",
    message
  );

  setText(
    "#status",
    message
  );

  setText(
    "#progressStatus",
    message
  );
}


function setProgress(message) {
  setText(
    "#scanProgress",
    message
  );

  setText(
    "#progress",
    message
  );

  setText(
    "#progressDetails",
    message
  );
}


function setProgressPercent(
  percent
) {
  const value =
    Math.max(
      0,
      Math.min(
        100,
        Number(percent) || 0
      )
    );

  const fill =
    $("#progressBarFill");

  if (fill) {
    fill.style.width =
      `${value}%`;
  }
}


/* =========================================================
   ERROR UI
========================================================= */

function ensureErrorPanel() {
  let panel =
    $("#ld76ErrorPanel");

  if (panel) {
    return panel;
  }

  panel =
    document.createElement(
      "div"
    );

  panel.id =
    "ld76ErrorPanel";

  panel.style.display =
    "none";

  panel.style.margin =
    "12px 0";

  panel.style.padding =
    "14px";

  panel.style.border =
    "1px solid currentColor";

  panel.style.borderRadius =
    "12px";

  panel.style.whiteSpace =
    "pre-wrap";

  panel.style.fontSize =
    "13px";

  panel.style.lineHeight =
    "1.5";

  const progress =
    $("#progressSection");

  if (
    progress &&
    progress.parentElement
  ) {
    progress.parentElement.insertBefore(
      panel,
      progress
    );
  } else {
    document.body.prepend(
      panel
    );
  }

  return panel;
}


function clearError() {
  const panel =
    $("#ld76ErrorPanel");

  if (!panel) {
    return;
  }

  panel.textContent =
    "";

  panel.style.display =
    "none";
}


function showError(
  title,
  details,
  extra = {}
) {
  const panel =
    ensureErrorPanel();

  const stage =
    extra.stage ||
    "UNKNOWN";

  const status =
    extra.status != null
      ? String(extra.status)
      : "N/A";

  const reason =
    extra.reason ||
    "No additional reason provided.";

  const requestCount =
    extra.requestCount != null
      ? String(
          extra.requestCount
        )
      : String(
          state.geminiRequests
        );

  const message =
`❌ ${title}

STAGE: ${stage}
HTTP STATUS: ${status}
REASON: ${reason}
REQUESTS: ${requestCount}

DETAILS:
${details || "No details available."}`;

  state.lastError =
    message;

  panel.textContent =
    message;

  panel.style.display =
    "";

  setStatus(
    `ERROR: ${title}`
  );

  setProgress(
    `ERROR at ${stage}: ${reason}`
  );

  console.error(
    "[LD76 ERROR]",
    {
      title,
      stage,
      status,
      reason,
      details,
      extra
    }
  );
}


function makeApiError(
  message,
  stage,
  status,
  data
) {
  const error =
    new Error(
      message
    );

  error.stage =
    stage;

  error.status =
    status;

  error.providerMessage =
    data?.providerMessage ||
    data?.reason ||
    data?.message ||
    data?.error ||
    "";

  error.data =
    data || null;

  return error;
}


function displayScanError(
  error
) {
  showError(
    "Scan failed",

    error?.data
      ? safeJson(
          error.data
        )
      : (
          error?.stack ||
          error?.message ||
          "Unknown error."
        ),

    {
      stage:
        error?.stage ||
        "SCAN",

      status:
        error?.status ??
        "N/A",

      reason:
        error?.providerMessage ||
        error?.message ||
        "Unknown error.",

      requestCount:
        state.geminiRequests
    }
  );
}


function safeJson(value) {
  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return String(value);
  }
}


/* =========================================================
   PROGRESS
========================================================= */

function updateProgressText() {
  setProgress(
    `Discovered ${state.discoveredCount} → ` +
    `${state.candidates.length} relevant → ` +
    `${state.alreadyAnalyzedCount} already analyzed → ` +
    `${state.sentToGeminiCount} sent to Gemini → ` +
    `${state.successfullySavedCount} successfully saved. ` +
    `Gemini requests: ${state.geminiRequests}.`
  );
}


function updateScanButton() {
  const button =
    $("#findSitesButton") ||
    $("#findSites") ||
    $("#findNewSites") ||
    $("#scanButton");

  if (!button) {
    return;
  }

  button.disabled =
    state.scanning;

  button.textContent =
    state.scanning
      ? "SCANNING..."
      : "FIND NEW SITES";
}


/* =========================================================
   DISCOVERY
========================================================= */

async function discoverDomains() {
  let response;

  try {
    response =
      await fetch(
        "/api/discover",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              tld:
                state.selectedTld,

              period:
                state.selectedPeriod
            })
        }
      );

  } catch (error) {
    throw makeApiError(
      `Discovery network error: ${
        error?.message ||
        "Network request failed"
      }`,

      "DISCOVERY",

      "NETWORK",

      {
        error:
          error?.message ||
          "Unable to connect to /api/discover"
      }
    );
  }

  let data = null;

  try {
    data =
      await response.json();

  } catch {
    throw makeApiError(
      "Discovery returned invalid JSON.",

      "DISCOVERY",

      response.status,

      {
        error:
          "Server response could not be parsed as JSON."
      }
    );
  }

  if (
    !response.ok ||
    !data?.ok
  ) {
    throw makeApiError(
      "Discovery API failed.",

      data?.stage ||
      "DISCOVERY",

      response.status,

      data
    );
  }

  /*
   * NEW discover.js returns:
   *
   * candidates: [...]
   *
   * Keep compatibility with older response names too.
   */
  const candidates =
    Array.isArray(
      data.candidates
    )
      ? data.candidates
      : Array.isArray(
          data.domains
        )
        ? data.domains
        : Array.isArray(
            data.results
          )
          ? data.results
          : [];

  return {
    ...data,

    candidates,

    count:
      Number(
        data.discovered ??
        data.count ??
        candidates.length
      )
  };
}


/* =========================================================
   WEBSITE SCANNER
========================================================= */

async function scanDomains(
  domains
) {
  if (
    !Array.isArray(domains) ||
    !domains.length
  ) {
    return {
      ok: true,
      candidates: [],
      scanned: 0,
      active: 0,
      investmentMatches: 0,
      paymentMatches: 0
    };
  }

  let response;

  try {
    response =
      await fetch(
        "/api/scan",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              domains,

              paymentMethods:
                state.paymentMethods
            })
        }
      );

  } catch (error) {
    throw makeApiError(
      `Scanner network error: ${
        error?.message ||
        "Network request failed"
      }`,

      "WEBSITE SCANNER",

      "NETWORK",

      {
        error:
          error?.message ||
          "Unable to connect to /api/scan"
      }
    );
  }

  let data = null;

  try {
    data =
      await response.json();

  } catch {
    throw makeApiError(
      "Scanner returned invalid JSON.",

      "WEBSITE SCANNER",

      response.status,

      {
        error:
          "Server response could not be parsed as JSON."
      }
    );
  }

  if (
    !response.ok ||
    !data?.ok
  ) {
    throw makeApiError(
      "Website scanner failed.",

      data?.stage ||
      "WEBSITE SCANNER",

      response.status,

      data
    );
  }

  state.scannedCount =
    Number(
      data.scanned || 0
    );

  return data;
}


/* =========================================================
   ALREADY ANALYZED
========================================================= */

function hasValidSavedGeminiAnalysis(
  record
) {
  if (!record) {
    return false;
  }

  if (
    record.aiAnalyzed !== true
  ) {
    return false;
  }

  const score =
    Number(
      record.aiScore
    );

  return (
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100
  );
}


async function filterAlreadyAnalyzed(
  candidates
) {
  const fresh = [];

  let alreadyAnalyzed =
    0;

  for (
    const candidate
    of candidates
  ) {
    const domain =
      normalizeDomain(
        candidate?.domain
      );

    if (!domain) {
      continue;
    }

    let existing = null;

    try {
      existing =
        await getDomain(
          domain
        );

    } catch (error) {
      throw makeApiError(
        `Could not check local history for ${domain}.`,

        "HISTORY FILTER",

        "INDEXEDDB",

        {
          error:
            error?.message ||
            "IndexedDB read failed",

          domain
        }
      );
    }

    if (
      hasValidSavedGeminiAnalysis(
        existing
      )
    ) {
      alreadyAnalyzed++;
      continue;
    }

    fresh.push({
      ...(existing || {}),
      ...candidate,
      domain
    });
  }

  state.alreadyAnalyzedCount =
    alreadyAnalyzed;

  return fresh;
}


/* =========================================================
   GEMINI
========================================================= */

async function analyzeWithGemini(
  candidates
) {
  if (
    !state.geminiEnabled
  ) {
    return {
      skipped: true,
      results: [],
      requestCount: 0
    };
  }

  if (
    !Array.isArray(candidates) ||
    !candidates.length
  ) {
    return {
      skipped: false,
      results: [],
      requestCount: 0
    };
  }

  /*
   * NO arbitrary limit.
   * ALL fresh candidates are submitted.
   *
   * /api/analyze handles batching if needed.
   */

  const payloadCandidates =
    candidates.map(
      compactCandidate
    );

  setStatus(
    `Analyzing ALL ${payloadCandidates.length} fresh candidate(s) with Gemini...`
  );

  setProgress(
    `Sending ALL ${payloadCandidates.length} candidate(s) to Gemini...`
  );

  let response;

  try {
    response =
      await fetch(
        "/api/analyze",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              candidates:
                payloadCandidates
            })
        }
      );

  } catch (error) {
    throw makeApiError(
      `Gemini connection failed: ${
        error?.message ||
        "Network error"
      }`,

      "GEMINI CONNECTION",

      "NETWORK",

      {
        error:
          error?.message ||
          "Unable to connect to /api/analyze",

        submittedCandidates:
          payloadCandidates.length
      }
    );
  }

  let data = null;

  try {
    data =
      await response.json();

  } catch {
    throw makeApiError(
      "Gemini backend returned invalid JSON.",

      "GEMINI BACKEND",

      response.status,

      {
        error:
          "The /api/analyze response was not valid JSON."
      }
    );
  }

  state.geminiRequests =
    Number(
      data?.requestCount || 0
    );

  if (
    !response.ok
  ) {
    throw makeApiError(
      "Gemini analysis request failed.",

      data?.stage ||
      "GEMINI API",

      response.status,

      data
    );
  }

  if (
    !data?.ok
  ) {
    throw makeApiError(
      "Gemini backend returned ok=false.",

      data?.stage ||
      "GEMINI API",

      response.status,

      data
    );
  }

  const results =
    normalizeGeminiResults(
      data
    );

  const rawResultCount =
    Array.isArray(
      data.results
    )
      ? data.results.length
      : 0;

  if (
    !results.length
  ) {
    throw makeApiError(
      "Gemini returned no valid scored results.",

      "GEMINI RESULT VALIDATION",

      response.status,

      {
        error:
          "No result contained a valid scamScore between 0 and 100.",

        submittedCount:
          payloadCandidates.length,

        rawResultCount,

        requestCount:
          state.geminiRequests,

        backend:
          data
      }
    );
  }

  return {
    skipped: false,

    results,

    requestCount:
      state.geminiRequests,

    rawResultCount
  };
}


/* =========================================================
   COMPACT CANDIDATE
========================================================= */

function compactCandidate(
  candidate
) {
  return {
    domain:
      normalizeDomain(
        candidate?.domain
      ),

    websiteName:
      candidate?.websiteName ||
      candidate?.title ||
      null,

    title:
      candidate?.title ||
      null,

    description:
      candidate?.description ||
      null,

    registeredAt:
      candidate?.registeredAt ||
      null,

    registrationVerified:
      Boolean(
        candidate?.registrationVerified
      ),

    discoveredAt:
      candidate?.discoveredAt ||
      null,

    status:
      candidate?.status ||
      null,

    httpStatus:
      candidate?.httpStatus ||
      null,

    finalUrl:
      candidate?.finalUrl ||
      null,

    https:
      Boolean(
        candidate?.https
      ),

    pagesChecked:
      Array.isArray(
        candidate?.pagesChecked
      )
        ? candidate.pagesChecked
        : [],

    investment:
      candidate?.investment ||
      {},

    paymentMethods:
      candidate?.paymentMethods ||
      {},

    transparency:
      candidate?.transparency ||
      {},

    snippets:
      Array.isArray(
        candidate?.snippets
      )
        ? candidate.snippets
        : [],

    content:
      String(
        candidate?.content ||
        ""
      ).slice(
        0,
        30000
      )
  };
}


/* =========================================================
   GEMINI RESULT NORMALIZATION
========================================================= */

function normalizeGeminiResults(
  data
) {
  let rawResults =
    data?.results;

  if (
    !Array.isArray(
      rawResults
    )
  ) {
    rawResults =
      data?.analyses ||
      data?.analysis ||
      [];
  }

  if (
    !Array.isArray(
      rawResults
    )
  ) {
    return [];
  }

  const results = [];

  for (
    const item
    of rawResults
  ) {
    if (!item) {
      continue;
    }

    const domain =
      normalizeDomain(
        item.domain ||
        item.website ||
        item.url
      );

    if (!domain) {
      continue;
    }

    const score =
      Number(
        item.scamScore ??
        item.aiScore ??
        item.score ??
        item.geminiScamScore
      );

    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      console.warn(
        "Ignoring Gemini result without valid scamScore:",
        domain,
        item
      );

      continue;
    }

    results.push({
      domain,

      websiteName:
        item.websiteName ||
        item.title ||
        "",

      classification:
        item.classification ||
        "",

      aiScore:
        Math.round(score),

      geminiScamScore:
        Math.round(score),

      confidence:
        normalizeConfidence(
          item.confidence
        ),

      analysis:
        item.summary ||
        item.analysis ||
        item.reasoning ||
        "",

      redFlags:
        normalizeStringArray(
          item.redFlags ||
          item.red_flags
        ),

      positiveSignals:
        normalizeStringArray(
          item.positiveSignals ||
          item.positive_signals
        ),

      missingInformation:
        normalizeStringArray(
          item.missingInformation ||
          item.missing_information
        ),

      investmentClaims:
        normalizeStringArray(
          item.investmentClaims ||
          item.investment_claims
        ),

      paymentMethods:
        normalizeStringArray(
          item.paymentMethods ||
          item.payment_methods
        ),

      evidence:
        normalizeStringArray(
          item.evidence
        ),

      recommendation:
        item.recommendation ||
        "",

      band:
        scamBand(
          score
        )
    });
  }

  return results;
}


/* =========================================================
   SAVE GEMINI RESULTS
========================================================= */

async function saveAnalysisResults(
  candidates,
  geminiResults
) {
  if (
    !Array.isArray(
      geminiResults
    ) ||
    !geminiResults.length
  ) {
    return 0;
  }

  const submittedDomains =
    new Set(
      candidates
        .map(
          candidate =>
            normalizeDomain(
              candidate?.domain
            )
        )
        .filter(Boolean)
    );

  let savedCount = 0;

  for (
    const analysis
    of geminiResults
  ) {
    const domain =
      normalizeDomain(
        analysis?.domain
      );

    if (!domain) {
      continue;
    }

    if (
      !submittedDomains.has(
        domain
      )
    ) {
      continue;
    }

    const score =
      Number(
        analysis?.aiScore
      );

    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      continue;
    }

    let existing = null;

    try {
      existing =
        await getDomain(
          domain
        );
    } catch (error) {
      console.error(
        "Failed reading existing record:",
        domain,
        error
      );

      continue;
    }

    const candidate =
      candidates.find(
        item =>
          normalizeDomain(
            item?.domain
          ) === domain
      );

    const finalScore =
      Math.round(score);

    /*
     * First save with aiAnalyzed=false.
     */
    const record = {
      ...(existing || {}),
      ...(candidate || {}),

      domain,

      websiteName:
        analysis.websiteName ||
        candidate?.websiteName ||
        candidate?.title ||
        "",

      aiScore:
        finalScore,

      geminiScamScore:
        finalScore,

      aiClassification:
        analysis.classification ||
        "",

      confidence:
        analysis.confidence ||
        null,

      aiAnalysis:
        analysis.analysis ||
        "",

      aiRedFlags:
        analysis.redFlags ||
        [],

      aiPositiveSignals:
        analysis.positiveSignals ||
        [],

      aiMissingInformation:
        analysis.missingInformation ||
        [],

      aiInvestmentClaims:
        analysis.investmentClaims ||
        [],

      aiPaymentMethods:
        analysis.paymentMethods ||
        [],

      aiEvidence:
        analysis.evidence ||
        [],

      aiRecommendation:
        analysis.recommendation ||
        "",

      aiBand:
        analysis.band ||
        scamBand(
          finalScore
        ),

      aiAnalyzedAt:
        new Date().toISOString(),

      aiAnalyzed:
        false
    };

    try {
      await saveDomain(
        record
      );
    } catch (error) {
      console.error(
        "Failed saving Gemini result:",
        domain,
        error
      );

      continue;
    }

    let verified = null;

    try {
      verified =
        await getDomain(
          domain
        );
    } catch (error) {
      continue;
    }

    if (
      !verified ||
      Number(
        verified.aiScore
      ) !== finalScore
    ) {
      continue;
    }

    /*
     * ONLY after successful save verification:
     * aiAnalyzed=true
     */
    const analyzedRecord = {
      ...verified,

      aiAnalyzed:
        true
    };

    try {
      await saveDomain(
        analyzedRecord
      );
    } catch (error) {
      continue;
    }

    let finalVerified = null;

    try {
      finalVerified =
        await getDomain(
          domain
        );
    } catch (error) {
      continue;
    }

    if (
      finalVerified?.aiAnalyzed === true &&
      Number.isFinite(
        Number(
          finalVerified.aiScore
        )
      ) &&
      Number(
        finalVerified.aiScore
      ) >= 0 &&
      Number(
        finalVerified.aiScore
      ) <= 100
    ) {
      savedCount++;

      state.results.push(
        finalVerified
      );
    }
  }

  state.successfullySavedCount =
    savedCount;

  return savedCount;
}


/* =========================================================
   MAIN SCAN
========================================================= */

async function startScan() {
  if (
    state.scanning
  ) {
    return;
  }

  clearError();

  state.scanning =
    true;

  state.lastError =
    null;

  state.discoveredCount =
    0;

  state.scannedCount =
    0;

  state.relevantCount =
    0;

  state.alreadyAnalyzedCount =
    0;

  state.sentToGeminiCount =
    0;

  state.successfullySavedCount =
    0;

  state.geminiRequests =
    0;

  state.domains =
    [];

  state.candidates =
    [];

  state.results =
    [];

  updateScanButton();

  showElement(
    "#progressSection",
    true
  );

  setProgressPercent(
    2
  );

  try {

    /* =====================================================
       STEP 1 — DISCOVERY
    ===================================================== */

    setStatus(
      `Discovering new ${state.selectedTld} domains (${state.selectedPeriod.toUpperCase()})...`
    );

    setProgress(
      `Starting ${state.selectedPeriod.toUpperCase()} discovery...`
    );

    const discovery =
      await discoverDomains();

    /*
     * NEW discover.js:
     * discovery.candidates
     */
    state.domains =
      Array.isArray(
        discovery.candidates
      )
        ? discovery.candidates
        : [];

    state.discoveredCount =
      Number(
        discovery.count ??
        state.domains.length
      );

    setProgressPercent(
      20
    );

    setProgress(
      `Discovered ${state.discoveredCount} registered-domain candidate(s).`
    );

    if (
      !state.domains.length
    ) {
      setStatus(
        "No domains discovered."
      );

      renderResults();

      return;
    }


    /* =====================================================
       STEP 2 — WEBSITE SCANNER
    ===================================================== */

    setStatus(
      `Scanning ALL ${state.domains.length} discovered domains...`
    );

    setProgress(
      `Scanning all ${state.domains.length} domains for investment + payment evidence...`
    );

    const scan =
      await scanDomains(
        state.domains
      );

    state.candidates =
      Array.isArray(
        scan.candidates
      )
        ? scan.candidates
        : [];

    state.relevantCount =
      state.candidates.length;

    setProgressPercent(
      55
    );

    updateProgressText();


    /* =====================================================
       STEP 3 — HISTORY FILTER
    ===================================================== */

    setStatus(
      "Checking previous Gemini analyses..."
    );

    const candidatesForAi =
      await filterAlreadyAnalyzed(
        state.candidates
      );

    state.sentToGeminiCount =
      candidatesForAi.length;

    updateProgressText();

    if (
      !candidatesForAi.length
    ) {
      setProgressPercent(
        100
      );

      setStatus(
        state.candidates.length
          ? "All matching domains were already successfully analyzed by Gemini."
          : "No investment/payment candidates were found."
      );

      renderResults();

      return;
    }


    /* =====================================================
       STEP 4 — GEMINI
    ===================================================== */

    setStatus(
      `Sending ALL ${candidatesForAi.length} fresh candidate(s) to Gemini...`
    );

    setProgressPercent(
      70
    );

    updateProgressText();

    const aiResponse =
      await analyzeWithGemini(
        candidatesForAi
      );

    if (
      !Array.isArray(
        aiResponse.results
      ) ||
      !aiResponse.results.length
    ) {
      throw makeApiError(
        `Gemini returned no valid scored results for ${candidatesForAi.length} candidate(s).`,

        "GEMINI RESULT VALIDATION",

        200,

        {
          submittedCount:
            candidatesForAi.length,

          resultCount:
            aiResponse.results?.length ||
            0,

          requestCount:
            state.geminiRequests
        }
      );
    }


    /* =====================================================
       STEP 5 — SAVE
    ===================================================== */

    setStatus(
      `Saving ${aiResponse.results.length} Gemini result(s) to local history...`
    );

    setProgressPercent(
      85
    );

    const saved =
      await saveAnalysisResults(
        candidatesForAi,
        aiResponse.results
      );

    state.successfullySavedCount =
      saved;

    setProgressPercent(
      100
    );

    updateProgressText();

    if (
      saved > 0
    ) {
      setStatus(
        `Gemini analysis successfully saved for ${saved} domain(s).`
      );
    } else {
      throw makeApiError(
        "Gemini returned scores, but no result could be verified in local history.",

        "INDEXEDDB SAVE",

        "LOCAL",

        {
          submittedCount:
            candidatesForAi.length,

          geminiResultCount:
            aiResponse.results.length,

          successfullySaved:
            saved
        }
      );
    }

    renderResults();

  } catch (error) {
    state.lastError =
      error?.message ||
      "Unknown scan error";

    console.error(
      "LD76 scan failed:",
      error
    );

    displayScanError(
      error
    );

    updateProgressText();

  } finally {
    state.scanning =
      false;

    updateScanButton();
  }
}


/* =========================================================
   RESULTS
========================================================= */

function renderResults() {
  const container =
    $("#resultsContainer") ||
    $("#results");

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  if (
    !state.results.length
  ) {
    container.innerHTML = `
      <div class="empty-state">
        No Gemini-analyzed results yet.
      </div>
    `;

    return;
  }

  const sorted =
    [...state.results].sort(
      (a, b) =>
        new Date(
          b.aiAnalyzedAt || 0
        ) -
        new Date(
          a.aiAnalyzedAt || 0
        )
    );

  for (
    const result
    of sorted
  ) {
    container.appendChild(
      createResultCard(
        result
      )
    );
  }
}


function createResultCard(
  result
) {
  const card =
    document.createElement(
      "article"
    );

  card.className =
    "result-card";

  const score =
    Number(
      result.aiScore
    );

  const safeScore =
    Number.isFinite(score)
      ? Math.round(score)
      : 0;

  const redFlags =
    Array.isArray(
      result.aiRedFlags
    )
      ? result.aiRedFlags
      : [];

  const positiveSignals =
    Array.isArray(
      result.aiPositiveSignals
    )
      ? result.aiPositiveSignals
      : [];

  const missingInformation =
    Array.isArray(
      result.aiMissingInformation
    )
      ? result.aiMissingInformation
      : [];

  const paymentMethods =
    Array.isArray(
      result.aiPaymentMethods
    )
      ? result.aiPaymentMethods
      : [];

  card.innerHTML = `
    <div class="result-header">

      <div>

        <div class="result-label">
          🚨 GEMINI SCAM SCORE
        </div>

        <div class="result-score">
          ${escapeHtml(
            String(
              safeScore
            )
          )}
          / 100
        </div>

        <div class="result-band">
          ${escapeHtml(
            result.aiBand ||
            scamBand(
              safeScore
            )
          )}
        </div>

      </div>

      <div class="result-confidence">
        Confidence:
        ${escapeHtml(
          result.confidence ||
          "Unknown"
        )}
      </div>

    </div>

    <div class="result-domain">
      ${escapeHtml(
        result.domain ||
        ""
      )}
    </div>

    ${
      result.websiteName ||
      result.title
        ? `
          <div class="result-title">
            ${escapeHtml(
              result.websiteName ||
              result.title ||
              ""
            )}
          </div>
        `
        : ""
    }

    ${
      result.aiClassification
        ? `
          <div class="result-classification">
            ${escapeHtml(
              result.aiClassification
            )}
          </div>
        `
        : ""
    }

    <div class="result-analysis">
      ${escapeHtml(
        result.aiAnalysis ||
        "No analysis summary returned."
      )}
    </div>

    ${
      redFlags.length
        ? `
          <div class="result-flags">
            <strong>Red Flags</strong>

            <ul>
              ${redFlags
                .map(
                  flag =>
                    `<li>${escapeHtml(
                      flag
                    )}</li>`
                )
                .join("")}
            </ul>
          </div>
        `
        : ""
    }

    ${
      positiveSignals.length
        ? `
          <div class="result-positive">
            <strong>Positive Signals</strong>

            <ul>
              ${positiveSignals
                .map(
                  item =>
                    `<li>${escapeHtml(
                      item
                    )}</li>`
                )
                .join("")}
            </ul>
          </div>
        `
        : ""
    }

    ${
      missingInformation.length
        ? `
          <div class="result-missing">
            <strong>Missing Information</strong>

            <ul>
              ${missingInformation
                .map(
                  item =>
                    `<li>${escapeHtml(
                      item
                    )}</li>`
                )
                .join("")}
            </ul>
          </div>
        `
        : ""
    }

    ${
      paymentMethods.length
        ? `
          <div class="result-payments">
            <strong>Payment Methods</strong>

            <div>
              ${paymentMethods
                .map(
                  item =>
                    `<span>${escapeHtml(
                      item
                    )}</span>`
                )
                .join(", ")}
            </div>
          </div>
        `
        : ""
    }

    ${
      result.aiRecommendation
        ? `
          <div class="result-recommendation">
            <strong>Recommendation</strong>

            <div>
              ${escapeHtml(
                result.aiRecommendation
              )}
            </div>
          </div>
        `
        : ""
    }

    <div class="result-actions">

      ${
        isSafeHttpUrl(
          result.finalUrl
        )
          ? `
            <a
              href="${escapeAttribute(
                result.finalUrl
              )}"
              target="_blank"
              rel="noopener noreferrer"
              class="open-website"
            >
              OPEN WEBSITE
            </a>
          `
          : ""
      }

    </div>
  `;

  return card;
}


/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {
  const records =
    await getAllDomains();

  state.results =
    records
      .filter(
        hasValidSavedGeminiAnalysis
      )
      .sort(
        (a, b) =>
          new Date(
            b.aiAnalyzedAt || 0
          ) -
          new Date(
            a.aiAnalyzedAt || 0
          )
      );

  renderResults();

  return state.results;
}


/* =========================================================
   TLD / PERIOD / PAYMENT
========================================================= */

function readSelectedTld() {
  const select =
    $("#tldSelect");

  if (!select) {
    return;
  }

  state.selectedTld =
    String(
      select.value ||
      ".top"
    ).trim();
}


function readSelectedPeriod() {
  const activeButton =
    document.querySelector(
      ".period-button.active"
    );

  if (
    activeButton
  ) {
    state.selectedPeriod =
      String(
        activeButton.dataset.period ||
        "1d"
      );
  }
}


function readPaymentMethods() {
  const methods = [];

  const checkboxes =
    $all(
      "#paymentBank, " +
      "#paymentEasypaisa, " +
      "#paymentJazzcash, " +
      "#paymentCrypto"
    );

  for (
    const checkbox
    of checkboxes
  ) {
    if (
      checkbox.checked &&
      checkbox.value
    ) {
      methods.push(
        String(
          checkbox.value
        )
      );
    }
  }

  state.paymentMethods =
    methods;
}


function setupTldSelector() {
  const select =
    $("#tldSelect");

  if (!select) {
    return;
  }

  readSelectedTld();

  select.addEventListener(
    "change",
    () => {
      readSelectedTld();
      updateSettingsView();
    }
  );
}


function updatePeriodIndicator() {
  let indicator =
    $("#periodSelectionIndicator");

  const buttons =
    $all(
      ".period-button"
    );

  if (
    !buttons.length
  ) {
    return;
  }

  let activeButton =
    buttons.find(
      button =>
        button.classList.contains(
          "active"
        )
    );

  if (
    !activeButton
  ) {
    activeButton =
      buttons.find(
        button =>
          button.dataset.period ===
          "1d"
      ) ||
      buttons[0];

    activeButton.classList.add(
      "active"
    );
  }

  const period =
    String(
      activeButton.dataset.period ||
      "1d"
    );

  for (
    const button
    of buttons
  ) {
    const active =
      button ===
      activeButton;

    button.setAttribute(
      "aria-pressed",
      active
        ? "true"
        : "false"
    );

    button.dataset.active =
      active
        ? "true"
        : "false";

    button.style.fontWeight =
      active
        ? "800"
        : "500";

    button.style.opacity =
      active
        ? "1"
        : "0.65";
  }

  if (!indicator) {
    indicator =
      document.createElement(
        "div"
      );

    indicator.id =
      "periodSelectionIndicator";

    indicator.style.marginTop =
      "8px";

    indicator.style.fontWeight =
      "700";

    indicator.style.fontSize =
      "13px";

    activeButton.parentElement?.after(
      indicator
    );
  }

  const labels = {
    "1d": "1 DAY",
    "3d": "3 DAYS",
    "7d": "7 DAYS",
    "15d": "15 DAYS",
    "1m": "1 MONTH"
  };

  indicator.textContent =
    `ACTIVE PERIOD: ${
      labels[period] ||
      period.toUpperCase()
    }`;
}


function setupPeriodButtons() {
  const buttons =
    $all(
      ".period-button"
    );

  if (
    !buttons.length
  ) {
    return;
  }

  let activeFound =
    buttons.some(
      button =>
        button.classList.contains(
          "active"
        )
    );

  /*
   * New default = 1 Day.
   */
  if (!activeFound) {
    const defaultButton =
      buttons.find(
        button =>
          button.dataset.period ===
          "1d"
      ) ||
      buttons[0];

    defaultButton.classList.add(
      "active"
    );
  }

  for (
    const button
    of buttons
  ) {
    button.addEventListener(
      "click",
      () => {

        for (
          const item
          of buttons
        ) {
          item.classList.remove(
            "active"
          );
        }

        button.classList.add(
          "active"
        );

        state.selectedPeriod =
          String(
            button.dataset.period ||
            "1d"
          );

        updatePeriodIndicator();
        updateSettingsView();
      }
    );
  }

  readSelectedPeriod();
  updatePeriodIndicator();
}


function setupPaymentMethods() {
  const checkboxes =
    $all(
      "#paymentBank, " +
      "#paymentEasypaisa, " +
      "#paymentJazzcash, " +
      "#paymentCrypto"
    );

  for (
    const checkbox
    of checkboxes
  ) {
    checkbox.addEventListener(
      "change",
      () => {
        readPaymentMethods();
        updateSettingsView();
      }
    );
  }

  readPaymentMethods();
}


/* =========================================================
   SETTINGS
========================================================= */

function getSettingsPanel() {
  let panel =
    $("#ld76SettingsPanel");

  if (panel) {
    return panel;
  }

  panel =
    document.createElement(
      "section"
    );

  panel.id =
    "ld76SettingsPanel";

  panel.className =
    "settings-section";

  panel.style.display =
    "none";

  panel.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Settings</h2>
        <p>
          Configure discovery and payment filters.
        </p>
      </div>
    </div>

    <div
      id="ld76SettingsContent"
      class="settings-content"
    ></div>

    <button
      id="ld76BackToScan"
      class="primary-button"
      type="button"
    >
      BACK TO SCAN
    </button>
  `;

  const main =
    document.querySelector(
      "main"
    );

  if (main) {
    main.appendChild(
      panel
    );
  } else {
    document.body.appendChild(
      panel
    );
  }

  const backButton =
    $("#ld76BackToScan");

  if (backButton) {
    backButton.addEventListener(
      "click",
      () =>
        showView(
          "home"
        )
    );
  }

  return panel;
}


function updateSettingsView() {
  const panel =
    $("#ld76SettingsPanel");

  if (!panel) {
    return;
  }

  const content =
    $("#ld76SettingsContent");

  if (!content) {
    return;
  }

  const paymentLabels = {
    bank:
      "Bank Transfer / Bank",

    easypaisa:
      "Easypaisa",

    jazzcash:
      "JazzCash",

    crypto:
      "Crypto"
  };

  const payments =
    state.paymentMethods.length
      ? state.paymentMethods
          .map(
            method =>
              paymentLabels[
                method
              ] ||
              method
          )
          .join(", ")
      : "None selected";

  const periodLabels = {
    "1d": "1 Day",
    "3d": "3 Days",
    "7d": "7 Days",
    "15d": "15 Days",
    "1m": "1 Month"
  };

  content.innerHTML = `
    <div class="settings-item">
      <strong>TLD</strong>
      <div>
        ${escapeHtml(
          state.selectedTld
        )}
      </div>
    </div>

    <div class="settings-item">
      <strong>Discovery Period</strong>
      <div>
        ${escapeHtml(
          periodLabels[
            state.selectedPeriod
          ] ||
          state.selectedPeriod
        )}
      </div>
    </div>

    <div class="settings-item">
      <strong>Payment Filters</strong>
      <div>
        ${escapeHtml(
          payments
        )}
      </div>
    </div>

    <div class="settings-item">
      <strong>Gemini</strong>
      <div>
        ${
          state.geminiEnabled
            ? "ENABLED"
            : "DISABLED"
        }
      </div>
    </div>

    <div class="settings-item">
      <strong>AI Rule</strong>
      <div>
        Only successfully saved Gemini scores
        are excluded from future scans.
      </div>
    </div>

    <div class="settings-item">
      <strong>Current Gemini Requests</strong>
      <div>
        ${escapeHtml(
          String(
            state.geminiRequests
          )
        )}
      </div>
    </div>
  `;
}


/* =========================================================
   VIEW NAVIGATION
========================================================= */

function setActiveNav(
  view
) {
  const navButtons =
    $all(
      ".nav-button"
    );

  for (
    const button
    of navButtons
  ) {
    const active =
      button.dataset.view ===
      view;

    button.classList.toggle(
      "active",
      active
    );

    button.setAttribute(
      "aria-current",
      active
        ? "page"
        : "false"
    );
  }
}


async function showView(
  view
) {
  state.currentView =
    view;

  setActiveNav(
    view
  );

  const settingsPanel =
    getSettingsPanel();

  const scanPanel =
    document.querySelector(
      ".scan-panel"
    );

  const progressSection =
    $("#progressSection");

  const resultsSection =
    $("#resultsSection");

  if (
    view ===
    "settings"
  ) {
    if (scanPanel) {
      scanPanel.style.display =
        "none";
    }

    if (progressSection) {
      progressSection.style.display =
        "none";
    }

    if (resultsSection) {
      resultsSection.style.display =
        "none";
    }

    settingsPanel.style.display =
      "";

    updateSettingsView();

    return;
  }

  if (settingsPanel) {
    settingsPanel.style.display =
      "none";
  }

  if (
    view ===
    "history"
  ) {
    if (scanPanel) {
      scanPanel.style.display =
        "none";
    }

    if (progressSection) {
      progressSection.style.display =
        "none";
    }

    if (resultsSection) {
      resultsSection.style.display =
        "";
    }

    setText(
      "#resultsTitle",
      "History"
    );

    await loadHistory();

    return;
  }

  if (scanPanel) {
    scanPanel.style.display =
      "";
  }

  if (resultsSection) {
    resultsSection.style.display =
      "";
  }

  setText(
    "#resultsTitle",
    "Results"
  );

  updatePeriodIndicator();
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
  const navButtons =
    $all(
      ".nav-button"
    );

  for (
    const button
    of navButtons
  ) {
    button.addEventListener(
      "click",
      async event => {
        event.preventDefault();

        if (
          state.scanning
        ) {
          return;
        }

        const view =
          button.dataset.view ||
          "home";

        try {
          await showView(
            view
          );
        } catch (error) {
          showError(
            "Navigation failed",

            error?.stack ||
            error?.message ||
            "Unknown navigation error.",

            {
              stage:
                "NAVIGATION",

              status:
                "LOCAL",

              reason:
                error?.message ||
                "Unknown error"
            }
          );
        }
      }
    );
  }
}


/* =========================================================
   SETTINGS BUTTON
========================================================= */

function setupSettingsButton() {
  const button =
    $("#settingsButton");

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    async event => {
      event.preventDefault();

      if (
        state.scanning
      ) {
        return;
      }

      try {
        await showView(
          "settings"
        );
      } catch (error) {
        showError(
          "Settings view failed",

          error?.stack ||
          error?.message ||
          "Unknown settings error.",

          {
            stage:
              "SETTINGS",

            status:
              "LOCAL",

            reason:
              error?.message ||
              "Unknown error"
          }
        );
      }
    }
  );
}


/* =========================================================
   REFRESH
========================================================= */

function setupRefreshButton() {
  const button =
    $("#refreshResultsButton");

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    async event => {
      event.preventDefault();

      button.disabled =
        true;

      clearError();

      try {
        await loadHistory();

        setStatus(
          "History refreshed."
        );

      } catch (error) {
        showError(
          "History refresh failed",

          error?.stack ||
          error?.message ||
          "Unknown error.",

          {
            stage:
              "HISTORY REFRESH",

            status:
              "LOCAL",

            reason:
              error?.message ||
              "Unknown error"
          }
        );

      } finally {
        button.disabled =
          false;
      }
    }
  );
}


/* =========================================================
   SCAN BUTTON
========================================================= */

function setupScanButton() {
  const button =
    $("#findSitesButton") ||
    $("#findSites") ||
    $("#findNewSites") ||
    $("#scanButton");

  if (!button) {
    showError(
      "Scan button not found",

      "The frontend could not find #findSitesButton, #findSites, #findNewSites or #scanButton in index.html.",

      {
        stage:
          "INITIALIZATION",

        status:
          "DOM",

        reason:
          "Scan button selector did not match any element."
      }
    );

    return;
  }

  button.addEventListener(
    "click",
    async event => {
      event.preventDefault();

      if (
        state.scanning
      ) {
        return;
      }

      readSelectedTld();
      readSelectedPeriod();
      readPaymentMethods();

      await startScan();
    }
  );
}


/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeDomain(
  value
) {
  if (value == null) {
    return "";
  }

  let domain =
    String(value)
      .trim()
      .toLowerCase();

  if (!domain) {
    return "";
  }

  domain =
    domain.replace(
      /^https?:\/\//i,
      ""
    );

  domain =
    domain.replace(
      /^www\./i,
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

  return domain;
}


function normalizeStringArray(
  value
) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        item =>
          String(
            item
          ).trim()
      )
      .filter(Boolean);
  }

  if (
    value == null
  ) {
    return [];
  }

  const text =
    String(value)
      .trim();

  return text
    ? [text]
    : [];
}


function normalizeConfidence(
  value
) {
  if (
    value == null
  ) {
    return "Unknown";
  }

  return (
    String(value)
      .trim() ||
    "Unknown"
  );
}


/* =========================================================
   SCORE BANDS
========================================================= */

function scamBand(
  score
) {
  const value =
    Number(score);

  if (
    value <= 20
  ) {
    return "Very Low Scam Indicators";
  }

  if (
    value <= 40
  ) {
    return "Low";
  }

  if (
    value <= 60
  ) {
    return "Moderate / Uncertain";
  }

  if (
    value <= 80
  ) {
    return "Suspicious";
  }

  return "Highly Suspicious";
}


/* =========================================================
   HTML / URL SAFETY
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value == null
      ? ""
      : value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


function escapeAttribute(
  value
) {
  return escapeHtml(
    value
  )
    .replace(
      /javascript:/gi,
      ""
    )
    .replace(
      /data:/gi,
      ""
    );
}


function isSafeHttpUrl(
  value
) {
  if (!value) {
    return false;
  }

  try {
    const url =
      new URL(
        String(value),
        window.location.origin
      );

    return (
      url.protocol ===
        "http:" ||
      url.protocol ===
        "https:"
    );

  } catch {
    return false;
  }
}


/* =========================================================
   GLOBAL ERRORS
========================================================= */

window.addEventListener(
  "error",
  event => {
    console.error(
      "LD76 GLOBAL JS ERROR:",
      event.error
    );

    showError(
      "Frontend JavaScript error",

      event.error?.stack ||
      event.message ||
      "Unknown JavaScript error.",

      {
        stage:
          "FRONTEND",

        status:
          "JS",

        reason:
          event.message ||
          "JavaScript runtime error"
      }
    );
  }
);


window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "LD76 UNHANDLED PROMISE:",
      event.reason
    );

    showError(
      "Unhandled frontend promise error",

      event.reason?.stack ||
      event.reason?.message ||
      String(
        event.reason
      ),

      {
        stage:
          "FRONTEND PROMISE",

        status:
          "JS",

        reason:
          event.reason?.message ||
          String(
            event.reason
          )
      }
    );
  }
);


/* =========================================================
   INITIALIZATION
========================================================= */

async function initApp() {
  console.log(
    "LD76 Investment Radar initializing..."
  );

  try {
    setupTldSelector();
    setupPeriodButtons();
    setupPaymentMethods();

    setupScanButton();
    setupSettingsButton();
    setupRefreshButton();
    setupNavigation();

    updateScanButton();

    setProgressPercent(
      0
    );

    clearError();

    await loadHistory();

    await showView(
      "home"
    );

    console.log(
      "LD76 Investment Radar ready."
    );

  } catch (error) {
    console.error(
      "LD76 initialization failed:",
      error
    );

    showError(
      "Application initialization failed",

      error?.stack ||
      error?.message ||
      "Unknown initialization error.",

      {
        stage:
          "INITIALIZATION",

        status:
          "LOCAL",

        reason:
          error?.message ||
          "Unknown initialization error"
      }
    );
  }
}


/* =========================================================
   START
========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initApp,
    {
      once: true
    }
  );
} else {
  initApp();
}
