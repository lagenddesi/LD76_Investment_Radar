"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Main frontend controller
 *
 * IMPORTANT AI RULE:
 * aiAnalyzed === true is set ONLY after:
 * 1. Gemini request succeeds
 * 2. Gemini returns a valid analysis
 * 3. The analysis is successfully saved in IndexedDB
 *
 * Failed Gemini requests are NOT marked as analyzed.
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
    const request =
      indexedDB.open(
        DB_NAME,
        DB_VERSION
      );

    request.onupgradeneeded = event => {
      const db =
        event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
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
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error(
          "IndexedDB open failed"
        )
      );
    };
  });
}


async function getDomain(
  domain
) {
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
          normalizeDomain(domain)
        );

      request.onsuccess = () => {
        resolve(
          request.result ||
          null
        );
      };

      request.onerror = () => {
        reject(
          request.error
        );
      };
    }
  );
}


async function saveDomain(
  record
) {
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
        store.put(
          record
        );

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


/* =========================================================
   UI HELPERS
========================================================= */

function $(selector) {
  return document.querySelector(
    selector
  );
}


function setText(
  selector,
  value
) {
  const element =
    $(selector);

  if (element) {
    element.textContent =
      value == null
        ? ""
        : String(value);
  }
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


function setStatus(
  message
) {
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
}


function setProgress(
  message
) {
  setText(
    "#scanProgress",
    message
  );

  setText(
    "#progress",
    message
  );
}


/* =========================================================
   DISCOVERY
========================================================= */

async function discoverDomains() {
  const response =
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

  let data = null;

  try {
    data =
      await response.json();
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

async function scanDomains(
  domains
) {
  if (!domains.length) {
    return {
      candidates: []
    };
  }

  const response =
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


  let data = null;

  try {
    data =
      await response.json();
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

  state.relevantCount =
    Number(
      data.paymentMatches ||
      data.investmentMatches ||
      0
    );


  return data;
}


/* =========================================================
   ANALYZED FILTER
========================================================= */

/*
 * IMPORTANT:
 *
 * Only a record with:
 *
 * aiAnalyzed === true
 *
 * AND
 *
 * a valid saved aiScore
 *
 * is considered previously analyzed.
 *
 * Discovery / scanner / candidate status alone
 * NEVER prevents another Gemini request.
 */

async function filterAlreadyAnalyzed(
  candidates
) {
  const fresh = [];

  let alreadyAnalyzed = 0;


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


    const existing =
      await getDomain(
        domain
      );


    const validSavedAnalysis =
      Boolean(
        existing &&
        existing.aiAnalyzed === true &&
        Number.isFinite(
          Number(
            existing.aiScore
          )
        ) &&
        Number(
          existing.aiScore
        ) >= 0 &&
        Number(
          existing.aiScore
        ) <= 100
      );


    if (validSavedAnalysis) {
      alreadyAnalyzed++;
      continue;
    }


    /*
     * Merge existing scanner history
     * without treating it as AI analysis.
     */
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

async function analyzeWithGemini(
  candidates
) {
  if (!state.geminiEnabled) {
    return {
      skipped: true,
      results: []
    };
  }


  if (!Array.isArray(candidates)) {
    return {
      skipped: false,
      results: []
    };
  }


  if (!candidates.length) {
    return {
      skipped: false,
      results: []
    };
  }


  /*
   * IMPORTANT:
   * One request for ALL candidates.
   *
   * There is NO 4/5 candidate limit here.
   */

  const payloadCandidates =
    candidates.map(
      candidate =>
        compactCandidate(
          candidate
        )
    );


  setProgress(
    `Sending ${payloadCandidates.length} candidate(s) to Gemini...`
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
    throw new Error(
      `Gemini connection failed: ${
        error?.message ||
        "Network error"
      }`
    );
  }


  /*
   * THIS is the actual Gemini request.
   *
   * Count it only after fetch was actually
   * called and a response was received.
   */

  state.geminiRequests++;


  let data = null;


  try {
    data =
      await response.json();
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
    normalizeGeminiResults(
      data
    );


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

    /*
     * Limit raw content sent to Gemini.
     */
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
    /*
     * Support alternate API response
     * property names.
     */
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
        item.aiScore ??
        item.score ??
        item.scamScore ??
        item.geminiScamScore
      );


    if (
      !Number.isFinite(
        score
      )
    ) {
      continue;
    }


    if (
      score < 0 ||
      score > 100
    ) {
      continue;
    }


    results.push({
      domain,

      aiScore:
        Math.round(
          score
        ),

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
    )
  ) {
    return 0;
  }


  /*
   * Only domains that were actually sent
   * in THIS Gemini request are accepted.
   */

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
      !Number.isFinite(
        score
      ) ||
      score < 0 ||
      score > 100
    ) {
      continue;
    }


    /*
     * Get current record again.
     */
    const existing =
      await getDomain(
        domain
      );


    const candidate =
      candidates.find(
        item =>
          normalizeDomain(
            item?.domain
          ) === domain
      );


    const record = {
      ...(existing || {}),
      ...(candidate || {}),

      domain,

      aiScore:
        Math.round(
          score
        ),

      geminiScamScore:
        Math.round(
          score
        ),

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
        scamBand(score),

      aiAnalyzedAt:
        new Date().toISOString(),

      /*
       * DO NOT set this before save.
       */
      aiAnalyzed: false
    };


    /*
     * First save the result.
     */
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

      /*
       * aiAnalyzed remains false.
       */
      continue;
    }


    /*
     * Verify the record actually exists
     * with the AI score.
     */
    let verified = null;


    try {
      verified =
        await getDomain(
          domain
        );
    } catch {
      verified = null;
    }


    const saveSucceeded =
      Boolean(
        verified &&
        Number(
          verified.aiScore
        ) ===
          Math.round(score)
      );


    if (!saveSucceeded) {
      console.error(
        "Gemini result could not be verified after save:",
        domain
      );

      continue;
    }


    /*
     * ONLY NOW mark as analyzed.
     */
    const finalRecord = {
      ...verified,

      aiAnalyzed:
        true
    };


    try {
      await saveDomain(
        finalRecord
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
        await getDomain(
          domain
        );
    } catch {
      finalVerified = null;
    }


    if (
      finalVerified?.aiAnalyzed ===
        true &&
      Number.isFinite(
        Number(
          finalVerified.aiScore
        )
      )
    ) {
      savedCount++;

      state.successfullySavedCount++;

      state.results.push(
        finalVerified
      );
    }
  }


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

  state.candidates = [];
  state.results = [];


  try {
    setStatus(
      "Discovering domains..."
    );


    setProgress(
      "Starting discovery..."
    );


    /*
     * STEP 1
     */
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


    /*
     * Use backend count when available.
     */
    if (
      Number.isFinite(
        Number(
          scan.paymentMatches
        )
      )
    ) {
      state.relevantCount =
        Number(
          scan.paymentMatches
        );
    }


    /*
     * STEP 3
     */
    const candidatesForAi =
      await filterAlreadyAnalyzed(
        state.candidates
      );


    state.sentToGeminiCount =
      candidatesForAi.length;


    setProgress(
      `Discovered ${state.discoveredCount} → ` +
      `${state.candidates.length} relevant → ` +
      `${state.alreadyAnalyzedCount} already analyzed → ` +
      `${state.sentToGeminiCount} sent to Gemini`
    );


    /*
     * STEP 4
     *
     * Gemini can be disabled during development.
     */
    if (!state.geminiEnabled) {
      setStatus(
        "Gemini is OFF."
      );

      renderResults();

      return;
    }


    if (!candidatesForAi.length) {
      setStatus(
        "No new candidates require Gemini analysis."
      );

      renderResults();

      return;
    }


    /*
     * STEP 5
     */
    setStatus(
      `Analyzing ${candidatesForAi.length} candidate(s) with Gemini...`
    );


    const aiResponse =
      await analyzeWithGemini(
        candidatesForAi
      );


    /*
     * STEP 6
     */
    const saved =
      await saveAnalysisResults(
        candidatesForAi,
        aiResponse.results
      );


    /*
     * IMPORTANT:
     * saved count comes only from verified
     * IndexedDB saves.
     */
    state.successfullySavedCount =
      saved;


    setProgress(
      `Discovered ${state.discoveredCount} → ` +
      `${state.candidates.length} relevant → ` +
      `${state.alreadyAnalyzedCount} already analyzed → ` +
      `${state.sentToGeminiCount} sent to Gemini → ` +
      `${state.successfullySavedCount} successfully saved. ` +
      `Gemini requests: ${state.geminiRequests}.`
    );


    setStatus(
      saved > 0
        ? `Gemini analysis saved for ${saved} domain(s).`
        : "Gemini returned results, but none were successfully saved."
    );


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


    setProgress(
      `Discovered ${state.discoveredCount} → ` +
      `${state.candidates.length} relevant → ` +
      `${state.alreadyAnalyzedCount} already analyzed → ` +
      `${state.sentToGeminiCount} sent to Gemini → ` +
      `${state.successfullySavedCount} successfully saved. ` +
      `Gemini requests: ${state.geminiRequests}.`
    );

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
    $(
      "#results"
    ) ||
    $(
      "#resultsContainer"
    );


  if (!container) {
    return;
  }


  container.innerHTML = "";


  if (!state.results.length) {
    container.innerHTML =
      `
        <div class="empty-state">
          No Gemini-analyzed results yet.
        </div>
      `;

    return;
  }


  for (
    const result
    of state.results
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


  card.innerHTML =
    `
      <div class="result-header">
        <div>
          <div class="result-label">
            🚨 GEMINI SCAM SCORE
          </div>

          <div class="result-score">
            ${escapeHtml(
              String(score)
            )}
            / 100
          </div>

          <div class="result-band">
            ${escapeHtml(
              result.aiBand ||
              scamBand(score)
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
          result.domain
        )}
      </div>

      <div class="result-analysis">
        ${escapeHtml(
          result.aiAnalysis ||
          "No analysis text returned."
        )}
      </div>

      ${
        Array.isArray(
          result.aiRedFlags
        ) &&
        result.aiRedFlags.length
          ? `
            <div class="result-flags">
              <strong>Red Flags</strong>
              <ul>
                ${result.aiRedFlags
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
   SCORE BANDS
========================================================= */

function scamBand(
  score
) {
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
   CONFIDENCE
========================================================= */

function normalizeConfidence(
  value
) {
  const text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


  if (
    text === "high"
  ) {
    return "High";
  }


  if (
    text === "medium" ||
    text === "moderate"
  ) {
    return "Medium";
  }


  if (
    text === "low"
  ) {
    return "Low";
  }


  return value
    ? String(value)
    : "Unknown";
}


/* =========================================================
   STRING ARRAYS
========================================================= */

function normalizeStringArray(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }


  return value
    .map(
      item =>
        String(
          item
        ).trim()
    )
    .filter(Boolean)
    .slice(
      0,
      50
    );
}


/* =========================================================
   DOMAIN NORMALIZATION
========================================================= */

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


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value ?? ""
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
  );
}


/* =========================================================
   SCAN BUTTON
========================================================= */

function updateScanButton() {
  const buttons =
    document.querySelectorAll(
      "#findSites, #findNewSites, #scanButton, [data-action='scan']"
    );


  buttons.forEach(
    button => {
      button.disabled =
        state.scanning;

      if (
        state.scanning
      ) {
        button.textContent =
          "SCANNING...";
      } else {
        button.textContent =
          "FIND NEW SITES";
      }
    }
  );
}


/* =========================================================
   UI SETTINGS
========================================================= */

function readSettingsFromUI() {
  const tldSelect =
    $(
      "#tld"
    ) ||
    $(
      "#tldSelect"
    );


  if (tldSelect?.value) {
    state.selectedTld =
      tldSelect.value;
  }


  const period =
    document.querySelector(
      "input[name='period']:checked"
    );


  if (period?.value) {
    state.selectedPeriod =
      period.value;
  }


  const paymentInputs =
    document.querySelectorAll(
      "input[name='paymentMethods']:checked, input[data-payment]:checked"
    );


  if (paymentInputs.length) {
    state.paymentMethods =
      Array.from(
        paymentInputs
      )
        .map(
          input =>
            input.value ||
            input.dataset.payment
        )
        .map(
          value =>
            String(
              value || ""
            )
              .trim()
              .toLowerCase()
        )
        .filter(
          value =>
            [
              "bank",
              "easypaisa",
              "jazzcash",
              "crypto"
            ].includes(value)
        );
  }
}


/* =========================================================
   GEMINI TOGGLE
========================================================= */

function setupGeminiToggle() {
  const toggles =
    document.querySelectorAll(
      "#geminiToggle, #geminiEnabled, [data-gemini-toggle]"
    );


  toggles.forEach(
    toggle => {
      toggle.checked =
        state.geminiEnabled;


      toggle.addEventListener(
        "change",
        () => {
          state.geminiEnabled =
            Boolean(
              toggle.checked
            );


          toggles.forEach(
            other => {
              other.checked =
                state.geminiEnabled;
            }
          );


          console.log(
            "Gemini enabled:",
            state.geminiEnabled
          );
        }
      );
    }
  );
}


/* =========================================================
   EVENT SETUP
========================================================= */

function setupEvents() {
  const scanButtons =
    document.querySelectorAll(
      "#findSites, #findNewSites, #scanButton, [data-action='scan']"
    );


  scanButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        async event => {
          event.preventDefault();

          readSettingsFromUI();

          await startScan();
        }
      );
    }
  );
}


/* =========================================================
   INITIALIZATION
========================================================= */

function initializeApp() {
  console.log(
    "LD76 Investment Radar initialized."
  );


  setupGeminiToggle();

  setupEvents();

  updateScanButton();


  setStatus(
    "Ready."
  );


  setProgress(
    "Select TLD, period and payment methods."
  );
}


if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp
  );
} else {
  initializeApp();
        }
