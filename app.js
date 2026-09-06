"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Main frontend controller
 *
 * RULE:
 * A domain is "already analyzed" ONLY when:
 *   aiAnalyzed === true
 *   AND aiScore is a valid 0-100 number.
 *
 * Failed / missing Gemini analysis is NEVER treated as analyzed.
 *
 * IMPORTANT:
 * There is NO arbitrary 4/5 candidate limit.
 * All fresh candidates are sent to /api/analyze.
 */


/* =========================================================
   STATE
========================================================= */

const state = {
  domains: [],
  candidates: [],
  results: [],

  selectedTld: ".top",
  selectedPeriod: "24h",

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
    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION
    );

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
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
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error("IndexedDB open failed")
      );
    };
  });
}


async function getDomain(domain) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readonly"
    );

    const store = transaction.objectStore(
      STORE_NAME
    );

    const request = store.get(
      normalizeDomain(domain)
    );

    request.onsuccess = () => {
      resolve(
        request.result || null
      );
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error("IndexedDB read failed")
      );
    };
  });
}


async function saveDomain(record) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(
      STORE_NAME
    );

    const request = store.put(record);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error("IndexedDB save failed")
      );
    };
  });
}


async function getAllDomains() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      STORE_NAME,
      "readonly"
    );

    const store = transaction.objectStore(
      STORE_NAME
    );

    const request = store.getAll();

    request.onsuccess = () => {
      resolve(
        Array.isArray(request.result)
          ? request.result
          : []
      );
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error("IndexedDB getAll failed")
      );
    };
  });
}


/* =========================================================
   DOM HELPERS
========================================================= */

function $(selector) {
  return document.querySelector(selector);
}


function $all(selector) {
  return Array.from(
    document.querySelectorAll(selector)
  );
}


function setText(selector, value) {
  const element = $(selector);

  if (element) {
    element.textContent =
      value == null
        ? ""
        : String(value);
  }
}


function showElement(selector, visible) {
  const element = $(selector);

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
    "[LD76]",
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


function setProgressPercent(percent) {
  const value = Math.max(
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
  const response = await fetch(
    "/api/discover",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        tld:
          state.selectedTld,

        period:
          state.selectedPeriod,

        periodHours:
          state.selectedPeriod === "48h"
            ? 48
            : 24
      })
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Discovery returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `Discovery failed (${response.status})`
    );
  }

  return data;
}


/* =========================================================
   WEBSITE SCANNER
========================================================= */

async function scanDomains(domains) {
  if (
    !Array.isArray(domains) ||
    !domains.length
  ) {
    return {
      candidates: [],
      scanned: 0,
      active: 0,
      investmentMatches: 0,
      paymentMatches: 0
    };
  }

  const response = await fetch(
    "/api/scan",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        domains,

        paymentMethods:
          state.paymentMethods
      })
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Scanner returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `Scanner failed (${response.status})`
    );
  }

  state.scannedCount =
    Number(
      data.scanned || 0
    );

  return data;
}


/* =========================================================
   ALREADY ANALYZED FILTER
========================================================= */

function hasValidSavedGeminiAnalysis(record) {
  if (!record) {
    return false;
  }

  if (record.aiAnalyzed !== true) {
    return false;
  }

  const score =
    Number(record.aiScore);

  return (
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100
  );
}


async function filterAlreadyAnalyzed(candidates) {
  const fresh = [];

  let alreadyAnalyzed = 0;

  for (const candidate of candidates) {
    const domain =
      normalizeDomain(
        candidate?.domain
      );

    if (!domain) {
      continue;
    }

    const existing =
      await getDomain(domain);

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

async function analyzeWithGemini(candidates) {
  if (!state.geminiEnabled) {
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
   * NO candidate limit here.
   *
   * Every fresh candidate is sent.
   * /api/analyze handles batching if required.
   */

  const payloadCandidates =
    candidates.map(
      compactCandidate
    );

  setStatus(
    `Analyzing ${payloadCandidates.length} candidate(s) with Gemini...`
  );

  setProgress(
    `Sending ${payloadCandidates.length} candidate(s) to Gemini...`
  );

  let response;

  try {
    response = await fetch(
      "/api/analyze",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          candidates:
            payloadCandidates
        })
      }
    );
  } catch (error) {
    throw new Error(
      `Gemini connection failed: ${
        error?.message ||
        "Network error"
      }`
    );
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Gemini API returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `Gemini API failed (${response.status})`
    );
  }

  if (!data?.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      "Gemini API returned ok=false"
    );
  }

  /*
   * IMPORTANT:
   * Use backend's real requestCount.
   *
   * Backend may split a large request into
   * multiple batches.
   */

  state.geminiRequests =
    Number(
      data.requestCount || 0
    );

  const results =
    normalizeGeminiResults(data);

  return {
    skipped: false,
    results,

    requestCount:
      state.geminiRequests,

    rawResultCount:
      Array.isArray(data.results)
        ? data.results.length
        : 0
  };
}


/* =========================================================
   COMPACT CANDIDATE
========================================================= */

function compactCandidate(candidate) {
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
      candidate?.investment || {
        relevant: false,
        score: 0,
        keywords: [],
        dailyReturnClaims: [],
        roiClaims: []
      },

    paymentMethods:
      candidate?.paymentMethods || {
        bank: false,
        easypaisa: false,
        jazzcash: false,
        crypto: false,
        detected: []
      },

    transparency:
      candidate?.transparency || {
        company: [],
        legal: [],
        support: []
      },

    snippets:
      Array.isArray(
        candidate?.snippets
      )
        ? candidate.snippets
        : [],

    content:
      String(
        candidate?.content || ""
      ).slice(
        0,
        30000
      )
  };
}


/* =========================================================
   GEMINI RESULT NORMALIZATION
========================================================= */

function normalizeGeminiResults(data) {
  let rawResults =
    data?.results;

  if (!Array.isArray(rawResults)) {
    rawResults =
      data?.analyses ||
      data?.analysis ||
      data?.candidates ||
      [];
  }

  if (!Array.isArray(rawResults)) {
    return [];
  }

  const results = [];

  for (const item of rawResults) {
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

    /*
     * BACKEND FIELD:
     * scamScore
     *
     * Also accept older frontend names
     * for compatibility.
     */

    const rawScore =
      item.scamScore ??
      item.aiScore ??
      item.score ??
      item.geminiScamScore;

    const score =
      Number(rawScore);

    /*
     * A null score means Gemini did not
     * successfully analyze this candidate.
     */

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
        scamBand(score)
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
    !Array.isArray(geminiResults) ||
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

  for (const analysis of geminiResults) {
    const domain =
      normalizeDomain(
        analysis?.domain
      );

    if (!domain) {
      continue;
    }

    if (
      !submittedDomains.has(domain)
    ) {
      console.warn(
        "Ignoring Gemini result for unsubmitted domain:",
        domain
      );

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

    const existing =
      await getDomain(domain);

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
     * Save complete Gemini analysis.
     *
     * aiAnalyzed remains false until
     * the saved record has been verified.
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
        scamBand(finalScore),

      aiAnalyzedAt:
        new Date().toISOString(),

      aiAnalyzed: false
    };

    try {
      await saveDomain(record);
    } catch (error) {
      console.error(
        "Failed saving Gemini result:",
        domain,
        error
      );

      continue;
    }

    /*
     * Verify score was really stored.
     */

    let verified = null;

    try {
      verified =
        await getDomain(domain);
    } catch (error) {
      console.error(
        "Could not verify Gemini save:",
        domain,
        error
      );

      continue;
    }

    if (
      !verified ||
      Number(
        verified.aiScore
      ) !== finalScore
    ) {
      console.error(
        "Gemini result save verification failed:",
        domain
      );

      continue;
    }

    /*
     * ONLY NOW mark as analyzed.
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
      console.error(
        "Failed marking domain as analyzed:",
        domain,
        error
      );

      continue;
    }

    /*
     * Final verification.
     */

    let finalVerified = null;

    try {
      finalVerified =
        await getDomain(domain);
    } catch {
      finalVerified = null;
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
  if (state.scanning) {
    return;
  }

  state.scanning = true;
  state.lastError = null;

  state.discoveredCount = 0;
  state.scannedCount = 0;
  state.relevantCount = 0;
  state.alreadyAnalyzedCount = 0;
  state.sentToGeminiCount = 0;
  state.successfullySavedCount = 0;
  state.geminiRequests = 0;

  state.domains = [];
  state.candidates = [];
  state.results = [];

  updateScanButton();

  showElement(
    "#progressSection",
    true
  );

  setProgressPercent(5);

  try {
    /*
     * STEP 1
     * DISCOVERY
     */

    setStatus(
      `Discovering new ${state.selectedTld} domains (${state.selectedPeriod.toUpperCase()})...`
    );

    setProgress(
      `Starting ${state.selectedPeriod.toUpperCase()} discovery...`
    );

    const discovery =
      await discoverDomains();

    state.domains =
      Array.isArray(
        discovery.domains
      )
        ? discovery.domains
        : Array.isArray(
            discovery.results
          )
          ? discovery.results
          : [];

    state.discoveredCount =
      Number(
        discovery.count ??
        state.domains.length
      );

    setProgressPercent(20);

    setProgress(
      `Discovered ${state.discoveredCount} domains.`
    );

    if (!state.domains.length) {
      setStatus(
        "No domains discovered."
      );

      renderResults();

      return;
    }

    /*
     * STEP 2
     * WEBSITE SCAN
     */

    setStatus(
      `Scanning ${state.domains.length} domains...`
    );

    setProgress(
      `Scanning all ${state.domains.length} discovered domains...`
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

    /*
     * IMPORTANT:
     * Relevant count = actual final candidates,
     * not raw paymentMatches.
     */

    state.relevantCount =
      state.candidates.length;

    setProgressPercent(55);

    /*
     * STEP 3
     * REMOVE ONLY SUCCESSFULLY ANALYZED DOMAINS
     */

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

    /*
     * Nothing new for Gemini.
     */

    if (!candidatesForAi.length) {
      setProgressPercent(100);

      setStatus(
        state.candidates.length
          ? "All matching candidates were already successfully analyzed by Gemini."
          : "No investment/payment candidates were found."
      );

      renderResults();

      return;
    }

    /*
     * STEP 4
     * GEMINI
     */

    setStatus(
      `Sending ALL ${candidatesForAi.length} fresh candidate(s) to Gemini...`
    );

    setProgressPercent(70);

    const aiResponse =
      await analyzeWithGemini(
        candidatesForAi
      );

    /*
     * Gemini can return fewer valid
     * results than candidates.
     */

    if (
      !aiResponse.results.length
    ) {
      throw new Error(
        `Gemini returned no valid scored results for ${candidatesForAi.length} candidate(s).`
      );
    }

    /*
     * STEP 5
     * SAVE
     */

    setStatus(
      `Saving ${aiResponse.results.length} Gemini result(s)...`
    );

    setProgressPercent(85);

    const saved =
      await saveAnalysisResults(
        candidatesForAi,
        aiResponse.results
      );

    state.successfullySavedCount =
      saved;

    setProgressPercent(100);

    updateProgressText();

    if (saved > 0) {
      setStatus(
        `Gemini analysis successfully saved for ${saved} domain(s).`
      );
    } else {
      setStatus(
        "Gemini returned scored results, but none could be verified in local history."
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

    setStatus(
      `Scan error: ${state.lastError}`
    );

    updateProgressText();

  } finally {
    state.scanning = false;

    updateScanButton();
  }
}


/* =========================================================
   RESULT RENDERING
========================================================= */

function renderResults() {
  const container =
    $("#resultsContainer") ||
    $("#results");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!state.results.length) {
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

  for (const result of sorted) {
    container.appendChild(
      createResultCard(result)
    );
  }
}


function createResultCard(result) {
  const card =
    document.createElement(
      "article"
    );

  card.className =
    "result-card";

  const score =
    Number(result.aiScore);

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
            String(safeScore)
          )}
          / 100
        </div>

        <div class="result-band">
          ${escapeHtml(
            result.aiBand ||
            scamBand(safeScore)
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
        result.domain || ""
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
                    `<li>${escapeHtml(flag)}</li>`
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
                    `<li>${escapeHtml(item)}</li>`
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
                    `<li>${escapeHtml(item)}</li>`
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
                    `<span>${escapeHtml(item)}</span>`
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
        result.finalUrl
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
  try {
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

  } catch (error) {
    console.error(
      "History load failed:",
      error
    );

    setStatus(
      `History load failed: ${
        error?.message ||
        "Unknown error"
      }`
    );

    return [];
  }
}


/* =========================================================
   PERIOD / TLD / PAYMENT SETTINGS
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

  if (activeButton) {
    state.selectedPeriod =
      String(
        activeButton.dataset.period ||
        "24h"
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

  for (const checkbox of checkboxes) {
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

  const activeButton =
    document.querySelector(
      ".period-button.active"
    );

  if (!activeButton) {
    return;
  }

  const period =
    String(
      activeButton.dataset.period ||
      "24h"
    );

  /*
   * Make active state visually obvious
   * even if CSS does not have a dedicated
   * .period-button.active rule.
   */

  const buttons =
    $all(
      ".period-button"
    );

  for (const button of buttons) {
    const active =
      button === activeButton;

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

  indicator.textContent =
    `ACTIVE PERIOD: ${period.toUpperCase()}`;
}


function setupPeriodButtons() {
  const buttons =
    $all(
      ".period-button"
    );

  if (!buttons.length) {
    return;
  }

  let activeFound = false;

  for (const button of buttons) {
    if (
      button.classList.contains(
        "active"
      )
    ) {
      activeFound = true;
    }
  }

  if (!activeFound) {
    const defaultButton =
      buttons.find(
        button =>
          button.dataset.period ===
          "24h"
      ) ||
      buttons[0];

    defaultButton.classList.add(
      "active"
    );
  }

  for (const button of buttons) {
    button.addEventListener(
      "click",
      () => {

        for (const item of buttons) {
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
            "24h"
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

  for (const checkbox of checkboxes) {
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
   SETTINGS VIEW
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
      () => {
        showView("home");
      }
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
    bank: "Bank Transfer / Bank",
    easypaisa: "Easypaisa",
    jazzcash: "JazzCash",
    crypto: "Crypto"
  };

  const payments =
    state.paymentMethods.length
      ? state.paymentMethods
          .map(
            method =>
              paymentLabels[method] ||
              method
          )
          .join(", ")
      : "None selected";

  content.innerHTML = `
    <div class="settings-item">
      <strong>TLD</strong>
      <div>${escapeHtml(
        state.selectedTld
      )}</div>
    </div>

    <div class="settings-item">
      <strong>Discovery Period</strong>
      <div>${escapeHtml(
        state.selectedPeriod.toUpperCase()
      )}</div>
    </div>

    <div class="settings-item">
      <strong>Payment Filters</strong>
      <div>${escapeHtml(
        payments
      )}</div>
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
  `;
}


/* =========================================================
   VIEW NAVIGATION
========================================================= */

function setActiveNav(view) {
  const navButtons =
    $all(
      ".nav-button"
    );

  for (const button of navButtons) {
    const active =
      button.dataset.view === view;

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


async function showView(view) {
  state.currentView =
    view;

  setActiveNav(view);

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

  if (view === "settings") {
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

  /*
   * Hide settings for Home/History.
   */

  if (settingsPanel) {
    settingsPanel.style.display =
      "none";
  }

  if (view === "history") {
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

    await loadHistory();

    setText(
      "#resultsTitle",
      "History"
    );

    return;
  }

  /*
   * HOME
   */

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


function setupNavigation() {
  const navButtons =
    $all(
      ".nav-button"
    );

  for (const button of navButtons) {
    button.addEventListener(
      "click",
      async event => {
        event.preventDefault();

        if (state.scanning) {
          return;
        }

        const view =
          button.dataset.view ||
          "home";

        await showView(
          view
        );
      }
    );
  }
}


/* =========================================================
   HEADER SETTINGS BUTTON
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

      if (state.scanning) {
        return;
      }

      await showView(
        "settings"
      );
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

      try {
        await loadHistory();

        setStatus(
          "History refreshed."
        );

      } catch (error) {
        console.error(
          "Refresh failed:",
          error
        );

        setStatus(
          `Refresh failed: ${
            error?.message ||
            "Unknown error"
          }`
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
    console.warn(
      "LD76: Scan button not found."
    );

    return;
  }

  button.addEventListener(
    "click",
    async event => {
      event.preventDefault();

      if (state.scanning) {
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

function normalizeDomain(value) {
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
    domain.split("/")[0];

  domain =
    domain.split("?")[0];

  domain =
    domain.split("#")[0];

  domain =
    domain.replace(
      /\.$/,
      ""
    );

  return domain;
}


function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(
        item =>
          String(item)
            .trim()
      )
      .filter(Boolean);
  }

  if (value == null) {
    return [];
  }

  const text =
    String(value)
      .trim();

  if (!text) {
    return [];
  }

  return [text];
}


function normalizeConfidence(value) {
  if (value == null) {
    return "Unknown";
  }

  const text =
    String(value)
      .trim();

  return text ||
    "Unknown";
}


/* =========================================================
   SCORE BANDS
========================================================= */

function scamBand(score) {
  const value =
    Number(score);

  if (value <= 20) {
    return "Very Low Scam Indicators";
  }

  if (value <= 40) {
    return "Low";
  }

  if (value <= 60) {
    return "Moderate / Uncertain";
  }

  if (value <= 80) {
    return "Suspicious";
  }

  return "Highly Suspicious";
}


/* =========================================================
   HTML SAFETY
========================================================= */

function escapeHtml(value) {
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


function escapeAttribute(value) {
  return escapeHtml(
    value
  )
    .replace(
      /javascript:/gi,
      ""
    );
}


/* =========================================================
   INITIALIZATION
========================================================= */

async function initApp() {
  console.log(
    "LD76 Investment Radar initializing..."
  );

  setupTldSelector();
  setupPeriodButtons();
  setupPaymentMethods();

  setupScanButton();
  setupSettingsButton();
  setupRefreshButton();
  setupNavigation();

  updateScanButton();

  setProgressPercent(0);

  /*
   * Load saved Gemini history.
   */

  await loadHistory();

  /*
   * Make Home the initial view.
   */

  await showView(
    "home"
  );

  console.log(
    "LD76 Investment Radar ready."
  );
}


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
