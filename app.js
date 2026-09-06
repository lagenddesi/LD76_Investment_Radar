"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Main frontend controller
 *
 * IMPORTANT AI RULE:
 * A domain is considered previously analyzed ONLY when:
 *   aiAnalyzed === true
 *   AND a valid aiScore 0-100 exists.
 *
 * Failed Gemini requests are NOT marked as analyzed.
 *
 * IMPORTANT:
 * There is NO arbitrary 4/5 candidate limit.
 * All fresh candidates are sent to Gemini in one request.
 */


/* =========================================================
   APP STATE
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

  lastError: null
};


/* =========================================================
   INDEXED DB
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
   UI HELPERS
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
          state.selectedPeriod
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
   SCANNER
========================================================= */

async function scanDomains(domains) {
  if (!Array.isArray(domains) || !domains.length) {
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
    Number(data.scanned || 0);

  state.relevantCount =
    Number(
      data.paymentMatches ??
      data.investmentMatches ??
      0
    );

  return data;
}


/* =========================================================
   ANALYZED FILTER
========================================================= */

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

    const validSavedAnalysis =
      Boolean(
        existing &&
        existing.aiAnalyzed === true &&
        Number.isFinite(
          Number(existing.aiScore)
        ) &&
        Number(existing.aiScore) >= 0 &&
        Number(existing.aiScore) <= 100
      );

    if (validSavedAnalysis) {
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
   GEMINI ANALYSIS
========================================================= */

async function analyzeWithGemini(candidates) {
  if (!state.geminiEnabled) {
    return {
      skipped: true,
      results: []
    };
  }

  if (
    !Array.isArray(candidates) ||
    !candidates.length
  ) {
    return {
      skipped: false,
      results: []
    };
  }

  /*
   * NO 4/5 SITE LIMIT.
   *
   * Every fresh candidate is included.
   */

  const payloadCandidates =
    candidates.map(
      candidate =>
        compactCandidate(candidate)
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

  /*
   * A response was received from /api/analyze.
   */

  state.geminiRequests++;

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

  const results =
    normalizeGeminiResults(data);

  if (!results.length) {
    throw new Error(
      "Gemini returned no valid analysis results"
    );
  }

  return {
    skipped: false,
    results,
    returnedCount:
      results.length
  };
}


/* =========================================================
   COMPACT GEMINI CANDIDATE
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
      Boolean(candidate?.https),

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

    const score =
      Number(
        item.aiScore ??
        item.score ??
        item.scamScore ??
        item.geminiScamScore
      );

    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      continue;
    }

    results.push({
      domain,

      aiScore:
        Math.round(score),

      confidence:
        normalizeConfidence(
          item.confidence
        ),

      analysis:
        item.analysis ||
        item.summary ||
        item.reasoning ||
        "",

      redFlags:
        normalizeStringArray(
          item.redFlags ||
          item.red_flags
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
    !Array.isArray(geminiResults)
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
        "Ignoring Gemini result for domain not submitted:",
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
     * First save complete result with aiAnalyzed false.
     */

    const record = {
      ...(existing || {}),
      ...(candidate || {}),

      domain,

      aiScore:
        finalScore,

      geminiScamScore:
        finalScore,

      confidence:
        analysis.confidence ||
        null,

      aiAnalysis:
        analysis.analysis ||
        "",

      aiRedFlags:
        analysis.redFlags ||
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
     * Verify score was actually saved.
     */

    let verified = null;

    try {
      verified =
        await getDomain(domain);
    } catch {
      verified = null;
    }

    const saveSucceeded =
      Boolean(
        verified &&
        Number(
          verified.aiScore
        ) === finalScore
      );

    if (!saveSucceeded) {
      console.error(
        "Gemini result could not be verified:",
        domain
      );

      continue;
    }

    /*
     * ONLY after successful verification:
     * mark aiAnalyzed true.
     */

    const analyzedRecord = {
      ...verified,

      aiAnalyzed: true
    };

    try {
      await saveDomain(
        analyzedRecord
      );
    } catch (error) {
      console.error(
        "Failed setting aiAnalyzed=true:",
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
     * STEP 1: DISCOVERY
     */

    setStatus(
      "Discovering domains..."
    );

    setProgress(
      "Starting discovery..."
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
     * STEP 2: SCAN
     */

    setStatus(
      `Scanning ${state.domains.length} domains...`
    );

    setProgress(
      `Scanning ${state.domains.length} discovered domains...`
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
      Number(
        scan.paymentMatches ??
        state.candidates.length
      );

    setProgressPercent(55);

    /*
     * STEP 3:
     * Remove ONLY successfully analyzed domains.
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

    if (!state.geminiEnabled) {
      setProgressPercent(100);

      setStatus(
        "Gemini is OFF."
      );

      renderResults();

      return;
    }

    /*
     * No fresh candidates.
     */

    if (!candidatesForAi.length) {
      setProgressPercent(100);

      setStatus(
        "No new candidates require Gemini analysis."
      );

      renderResults();

      return;
    }

    /*
     * STEP 4: GEMINI
     *
     * ALL fresh candidates.
     * No arbitrary limit.
     */

    setStatus(
      `Sending ${candidatesForAi.length} candidate(s) to Gemini...`
    );

    setProgressPercent(70);

    const aiResponse =
      await analyzeWithGemini(
        candidatesForAi
      );

    /*
     * STEP 5: SAVE
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
        `Gemini analysis saved for ${saved} domain(s).`
      );
    } else {
      setStatus(
        "Gemini returned results, but none were successfully saved."
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

  /*
   * Newest first.
   */

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
        result.domain ||
        ""
      )}
    </div>

    ${
      result.title ||
      result.websiteName
        ? `
          <div class="result-title">
            ${escapeHtml(
              result.websiteName ||
              result.title
            )}
          </div>
        `
        : ""
    }

    <div class="result-analysis">
      ${escapeHtml(
        result.aiAnalysis ||
        "No analysis text returned."
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
          record =>
            record?.aiAnalyzed === true &&
            Number.isFinite(
              Number(
                record.aiScore
              )
            )
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

  } catch (error) {
    console.error(
      "History load failed:",
      error
    );
  }
}


/* =========================================================
   SETTINGS / SELECTIONS
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

  state.selectedTld =
    String(
      select.value ||
      ".top"
    ).trim();

  select.addEventListener(
    "change",
    () => {
      state.selectedTld =
        String(
          select.value ||
          ".top"
        ).trim();
    }
  );
}


function setupPeriodButtons() {
  const buttons =
    $all(
      ".period-button"
    );

  if (!buttons.length) {
    return;
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
      }
    );
  }

  readSelectedPeriod();
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
      readPaymentMethods
    );
  }

  readPaymentMethods();
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
  const navButtons =
    $all(
      ".nav-button"
    );

  for (const button of navButtons) {
    button.addEventListener(
      "click",
      async () => {

        for (const item of navButtons) {
          item.classList.remove(
            "active"
          );
        }

        button.classList.add(
          "active"
        );

        const view =
          button.dataset.view;

        if (view === "history") {
          await loadHistory();

          showElement(
            "#resultsSection",
            true
          );

          return;
        }

        if (view === "settings") {
          /*
           * Settings is handled by the existing
           * HTML/settings UI if present.
           */
          showElement(
            "#settingsSection",
            true
          );

          return;
        }

        /*
         * HOME
         */

        showElement(
          "#settingsSection",
          false
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
    () => {

      const settingsSection =
        $("#settingsSection");

      if (settingsSection) {
        const currentlyVisible =
          settingsSection.style.display !== "none";

        settingsSection.style.display =
          currentlyVisible
            ? "none"
            : "";
      }

      const settingsNav =
        document.querySelector(
          '.nav-button[data-view="settings"]'
        );

      if (settingsNav) {
        settingsNav.click();
      }
    }
  );
}


/* =========================================================
   REFRESH RESULTS
========================================================= */

function setupRefreshButton() {
  const button =
    $("#refreshResultsButton");

  if (!button) {
    return;
  }

  button.addEventListener(
    "click",
    async () => {
      button.disabled = true;

      try {
        await loadHistory();

        setStatus(
          "Results refreshed."
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
        button.disabled = false;
      }
    }
  );
}


/* =========================================================
   MAIN BUTTON
========================================================= */

function setupScanButton() {
  /*
   * Actual index.html ID:
   * #findSitesButton
   */

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
   NORMALIZATION HELPERS
========================================================= */

function normalizeDomain(value) {
  if (
    value == null
  ) {
    return "";
  }

  let domain =
    String(value)
      .trim()
      .toLowerCase();

  if (!domain) {
    return "";
  }

  /*
   * Remove protocol.
   */

  domain =
    domain.replace(
      /^https?:\/\//i,
      ""
    );

  /*
   * Remove www.
   */

  domain =
    domain.replace(
      /^www\./i,
      ""
    );

  /*
   * Remove path/query/hash.
   */

  domain =
    domain.split("/")[0];

  domain =
    domain.split("?")[0];

  domain =
    domain.split("#")[0];

  /*
   * Remove trailing dot.
   */

  domain =
    domain.replace(
      /\.$/,
      ""
    );

  return domain;
}


function normalizeStringArray(value) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        item =>
          String(item)
            .trim()
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

  if (!text) {
    return [];
  }

  return [text];
}


function normalizeConfidence(value) {
  if (
    value == null
  ) {
    return "Unknown";
  }

  const text =
    String(value)
      .trim();

  return text || "Unknown";
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
  return escapeHtml(value)
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
   * Load already saved Gemini results.
   */

  await loadHistory();

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
