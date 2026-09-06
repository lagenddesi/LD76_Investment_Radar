"use strict";

/*
 * LD76 Investment Radar
 * Frontend application controller
 *
 * Responsibilities:
 * - UI state
 * - Scan configuration
 * - API communication
 * - IndexedDB storage
 * - Results rendering
 * - History
 * - Settings
 * - PWA registration
 */

const APP_CONFIG = {
  dbName: "LD76InvestmentRadar",
  dbVersion: 1,
  storeName: "domains",
  scanStoreName: "scans"
};

const state = {
  period: "24h",
  isScanning: false,
  currentView: "home",
  geminiEnabled: false,
  results: []
};

/* =========================================================
   DOM
========================================================= */

const elements = {
  tldSelect: document.getElementById("tldSelect"),

  periodButtons: document.querySelectorAll(".period-button"),

  paymentBank: document.getElementById("paymentBank"),
  paymentEasypaisa: document.getElementById("paymentEasypaisa"),
  paymentJazzcash: document.getElementById("paymentJazzcash"),
  paymentCrypto: document.getElementById("paymentCrypto"),

  findSitesButton: document.getElementById("findSitesButton"),
  settingsButton: document.getElementById("settingsButton"),

  progressSection: document.getElementById("progressSection"),
  progressStatus: document.getElementById("progressStatus"),
  progressBarFill: document.getElementById("progressBarFill"),
  progressDetails: document.getElementById("progressDetails"),

  resultsSection: document.getElementById("resultsSection"),
  resultsContainer: document.getElementById("resultsContainer"),
  refreshResultsButton: document.getElementById(
    "refreshResultsButton"
  ),

  navButtons: document.querySelectorAll(".nav-button")
};

/* =========================================================
   IndexedDB
========================================================= */

let dbPromise = null;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(
      APP_CONFIG.dbName,
      APP_CONFIG.dbVersion
    );

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(APP_CONFIG.storeName)) {
        const domainStore = db.createObjectStore(
          APP_CONFIG.storeName,
          {
            keyPath: "domain"
          }
        );

        domainStore.createIndex(
          "aiAnalyzed",
          "aiAnalyzed",
          { unique: false }
        );

        domainStore.createIndex(
          "lastScanned",
          "lastScanned",
          { unique: false }
        );
      }

      if (
        !db.objectStoreNames.contains(
          APP_CONFIG.scanStoreName
        )
      ) {
        const scanStore = db.createObjectStore(
          APP_CONFIG.scanStoreName,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        scanStore.createIndex(
          "createdAt",
          "createdAt",
          { unique: false }
        );
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

async function getDomain(domain) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      APP_CONFIG.storeName,
      "readonly"
    );

    const store = transaction.objectStore(
      APP_CONFIG.storeName
    );

    const request = store.get(domain);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function saveDomain(domainRecord) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      APP_CONFIG.storeName,
      "readwrite"
    );

    const store = transaction.objectStore(
      APP_CONFIG.storeName
    );

    const request = store.put(domainRecord);

    request.onsuccess = () => {
      resolve(domainRecord);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function getAllDomains() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      APP_CONFIG.storeName,
      "readonly"
    );

    const store = transaction.objectStore(
      APP_CONFIG.storeName
    );

    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function saveScan(scanRecord) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      APP_CONFIG.scanStoreName,
      "readwrite"
    );

    const store = transaction.objectStore(
      APP_CONFIG.scanStoreName
    );

    const request = store.add(scanRecord);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/* =========================================================
   Settings
========================================================= */

function loadSettings() {
  try {
    const saved = localStorage.getItem(
      "ld76RadarSettings"
    );

    if (!saved) {
      return;
    }

    const settings = JSON.parse(saved);

    if (settings.tld) {
      elements.tldSelect.value = settings.tld;
    }

    if (
      settings.period === "24h" ||
      settings.period === "48h"
    ) {
      state.period = settings.period;
    }

    if (typeof settings.bank === "boolean") {
      elements.paymentBank.checked = settings.bank;
    }

    if (typeof settings.easypaisa === "boolean") {
      elements.paymentEasypaisa.checked =
        settings.easypaisa;
    }

    if (typeof settings.jazzcash === "boolean") {
      elements.paymentJazzcash.checked =
        settings.jazzcash;
    }

    if (typeof settings.crypto === "boolean") {
      elements.paymentCrypto.checked =
        settings.crypto;
    }

    updatePeriodButtons();
  } catch (error) {
    console.warn(
      "Could not load saved settings.",
      error
    );
  }
}

function saveSettings() {
  const settings = {
    tld: elements.tldSelect.value,
    period: state.period,
    bank: elements.paymentBank.checked,
    easypaisa: elements.paymentEasypaisa.checked,
    jazzcash: elements.paymentJazzcash.checked,
    crypto: elements.paymentCrypto.checked
  };

  localStorage.setItem(
    "ld76RadarSettings",
    JSON.stringify(settings)
  );
}

/* =========================================================
   UI Helpers
========================================================= */

function updatePeriodButtons() {
  elements.periodButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.period === state.period
    );
  });
}

function setProgress(
  status,
  details = "",
  percentage = 0
) {
  elements.progressSection.classList.remove("hidden");

  elements.progressStatus.textContent = status;
  elements.progressDetails.textContent = details;

  const safePercentage = Math.max(
    0,
    Math.min(100, Number(percentage) || 0)
  );

  elements.progressBarFill.style.width =
    `${safePercentage}%`;
}

function setScanning(scanning) {
  state.isScanning = scanning;

  elements.findSitesButton.disabled = scanning;

  if (scanning) {
    elements.findSitesButton.textContent =
      "SCANNING...";
  } else {
    elements.findSitesButton.textContent =
      "FIND NEW SITES";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(Boolean);
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

/* =========================================================
   Scan Configuration
========================================================= */

function getSelectedPayments() {
  const payments = [];

  if (elements.paymentBank.checked) {
    payments.push("bank");
  }

  if (elements.paymentEasypaisa.checked) {
    payments.push("easypaisa");
  }

  if (elements.paymentJazzcash.checked) {
    payments.push("jazzcash");
  }

  if (elements.paymentCrypto.checked) {
    payments.push("crypto");
  }

  return payments;
}

function getScanConfig() {
  return {
    tlds: [elements.tldSelect.value],
    period: state.period,
    paymentMethods: getSelectedPayments()
  };
}

/* =========================================================
   API
========================================================= */

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error ||
      `Request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   Discovery
========================================================= */

async function discoverDomains(config) {
  setProgress(
    "Discovering recent domains...",
    `Searching ${config.tlds.join(", ")} during ${config.period}.`,
    10
  );

  return postJson("/api/discover", {
    tlds: config.tlds,
    period: config.period
  });
}

/* =========================================================
   Scan
========================================================= */

async function scanSites(config, domains) {
  setProgress(
    "Checking active websites...",
    `${domains.length} discovered domains received.`,
    30
  );

  return postJson("/api/scan", {
    domains,
    paymentMethods: config.paymentMethods
  });
}

/* =========================================================
   Previously Analyzed Filtering
========================================================= */

async function removePreviouslyAnalyzed(domains) {
  const fresh = [];

  for (const domainItem of domains) {
    const domain =
      typeof domainItem === "string"
        ? domainItem
        : domainItem.domain;

    if (!domain) {
      continue;
    }

    const saved = await getDomain(domain);

    if (saved?.aiAnalyzed === true) {
      continue;
    }

    fresh.push(domainItem);
  }

  return fresh;
}

/* =========================================================
   Gemini Analysis
========================================================= */

async function analyzeWithGemini(candidates) {
  if (!candidates.length) {
    return {
      results: [],
      requestsMade: 0
    };
  }

  setProgress(
    "Preparing Gemini analysis...",
    `${candidates.length} sites are ready for AI analysis.`,
    80
  );

  try {
    setProgress(
      "AI analysis...",
      "Sending the final candidate set to Gemini.",
      88
    );

    const response = await postJson("/api/analyze", {
      candidates
    });

    return {
      results: normalizeArray(response.results),
      requestsMade:
        Number(response.requestsMade) || 1
    };
  } catch (error) {
    console.warn(
      "Gemini analysis unavailable.",
      error
    );

    return {
      results: [],
      requestsMade: 0,
      error:
        "AI analysis unavailable. Gemini quota or service limit was reached. Local scan results are still available."
    };
  }
}

/* =========================================================
   Save Results
========================================================= */

async function saveAnalysisResults(results) {
  for (const result of results) {
    if (!result?.domain) {
      continue;
    }

    const existing =
      await getDomain(result.domain);

    const record = {
      ...(existing || {}),

      domain: result.domain,

      firstSeen:
        existing?.firstSeen ||
        result.firstSeen ||
        new Date().toISOString(),

      lastSeen:
        result.lastSeen ||
        existing?.lastSeen ||
        new Date().toISOString(),

      registeredAt:
        result.registeredAt ||
        existing?.registeredAt ||
        null,

      discoveredAt:
        result.discoveredAt ||
        existing?.discoveredAt ||
        new Date().toISOString(),

      lastScanned:
        new Date().toISOString(),

      keywordScore:
        Number(result.keywordScore) || 0,

      paymentScore:
        Number(result.paymentScore) || 0,

      aiAnalyzed: true,

      aiScore:
        Number(result.scamScore) || 0,

      aiAnalysis: result,

      websiteName:
        result.websiteName ||
        existing?.websiteName ||
        result.domain,

      status:
        result.status ||
        existing?.status ||
        "active"
    };

    await saveDomain(record);
  }
}

/* =========================================================
   Result Rendering
========================================================= */

function getScoreClass(score) {
  const numericScore = Number(score) || 0;

  if (numericScore >= 81) {
    return "status-danger";
  }

  if (numericScore >= 61) {
    return "status-warning";
  }

  return "status-success";
}

function getClassification(score) {
  const numericScore = Number(score) || 0;

  if (numericScore <= 20) {
    return "Very Low Scam Indicators";
  }

  if (numericScore <= 40) {
    return "Low";
  }

  if (numericScore <= 60) {
    return "Moderate / Uncertain";
  }

  if (numericScore <= 80) {
    return "Suspicious";
  }

  return "Highly Suspicious";
}

function renderList(items, emptyText) {
  const normalized = normalizeArray(items);

  if (!normalized.length) {
    return `<li>${escapeHtml(emptyText)}</li>`;
  }

  return normalized
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderPaymentMethods(methods) {
  const normalized = normalizeArray(methods);

  if (!normalized.length) {
    return `<div class="evidence-item">
      <span class="evidence-icon">❓</span>
      <span>No payment method verified.</span>
    </div>`;
  }

  return normalized
    .map(method => {
      return `
        <div class="evidence-item">
          <span class="evidence-icon">✓</span>
          <span>${escapeHtml(method)}</span>
        </div>
      `;
    })
    .join("");
}

function renderResultCard(result) {
  const score = Number(result.scamScore) || 0;

  const classification =
    result.classification ||
    getClassification(score);

  const scoreClass = getScoreClass(score);

  const company =
    result.company ||
    result.companyRegistration ||
    {};

  const legal =
    result.legal ||
    result.privacy ||
    {};

  const support =
    result.support ||
    {};

  const payments =
    result.paymentMethods ||
    [];

  const claims =
    result.investmentClaims ||
    [];

  return `
    <article
      class="result-card"
      data-domain="${escapeHtml(result.domain)}"
    >

      <div class="result-card-header">

        <div>
          <h3 class="website-name">
            ${escapeHtml(
              result.websiteName ||
              result.domain
            )}
          </h3>

          <div class="domain-name">
            ${escapeHtml(result.domain)}
          </div>
        </div>

        <div class="scam-score">
          <div class="scam-score-label">
            GEMINI SCAM SCORE
          </div>

          <div class="scam-score-value ${scoreClass}">
            ${score}
          </div>

          <div class="scam-classification">
            ${escapeHtml(classification)}
          </div>
        </div>

      </div>

      <div class="evidence-grid">

        <div class="evidence-item">
          <span class="evidence-icon">
            ${company.verified ? "✓" : "❌"}
          </span>

          <span>
            <strong>Company Registration:</strong>
            ${escapeHtml(
              company.summary ||
              (company.verified
                ? "Verified"
                : "Not verified")
            )}
          </span>
        </div>

        <div class="evidence-item">
          <span class="evidence-icon">
            ${legal.verified ? "✓" : "❌"}
          </span>

          <span>
            <strong>Privacy / Legal:</strong>
            ${escapeHtml(
              legal.summary ||
              (legal.verified
                ? "Meaningful legal information found"
                : "Missing or not verified")
            )}
          </span>
        </div>

        <div class="evidence-item">
          <span class="evidence-icon">
            ${support.verified ? "✓" : "❌"}
          </span>

          <span>
            <strong>Support:</strong>
            ${escapeHtml(
              support.summary ||
              (support.verified
                ? "Support information found"
                : "No meaningful support found")
            )}
          </span>
        </div>

      </div>

      ${
        payments.length
          ? `
            <div class="card-section">
              <div class="card-section-title">
                Payment Methods
              </div>

              <div class="evidence-grid">
                ${renderPaymentMethods(payments)}
              </div>
            </div>
          `
          : ""
      }

      ${
        claims.length
          ? `
            <div class="card-section">
              <div class="card-section-title">
                Investment / Earning Claims
              </div>

              <ul>
                ${renderList(
                  claims,
                  "No specific claim extracted."
                )}
              </ul>
            </div>
          `
          : ""
      }

      ${
        result.summary
          ? `
            <div class="card-section">
              <div class="card-section-title">
                Why
              </div>

              <div class="evidence-item">
                ${escapeHtml(result.summary)}
              </div>
            </div>
          `
          : ""
      }

      ${
        result.redFlags?.length
          ? `
            <div class="card-section">
              <div class="card-section-title">
                Red Flags
              </div>

              <ul>
                ${renderList(
                  result.redFlags,
                  "No red flags reported."
                )}
              </ul>
            </div>
          `
          : ""
      }

      ${
        result.positiveSignals?.length
          ? `
            <div class="card-section">
              <div class="card-section-title">
                Positive Signals
              </div>

              <ul>
                ${renderList(
                  result.positiveSignals,
                  "No positive signals reported."
                )}
              </ul>
            </div>
          `
          : ""
      }

      <div class="card-actions">

        ${
          result.url
            ? `
              <button
                type="button"
                class="card-action primary"
                data-open-url="${escapeHtml(
                  result.url
                )}"
              >
                OPEN WEBSITE
              </button>
            `
            : ""
        }

        <button
          type="button"
          class="card-action"
          data-details-domain="${escapeHtml(
            result.domain
          )}"
        >
          DETAILS
        </button>

      </div>

    </article>
  `;
}

function renderResults(results) {
  state.results = normalizeArray(results);

  if (!state.results.length) {
    elements.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔎</div>
        <h3>No new candidates</h3>
        <p>
          No new sites were available for Gemini analysis.
          Previously analyzed domains are excluded.
        </p>
      </div>
    `;

    return;
  }

  elements.resultsContainer.innerHTML =
    state.results
      .map(renderResultCard)
      .join("");
}

/* =========================================================
   Main Scan
========================================================= */

async function startScan() {
  if (state.isScanning) {
    return;
  }

  saveSettings();

  const config = getScanConfig();

  if (!config.tlds.length) {
    alert("Please select at least one TLD.");
    return;
  }

  if (!config.paymentMethods.length) {
    alert(
      "Please select at least one payment method."
    );
    return;
  }

  setScanning(true);

  try {
    setProgress(
      "Starting scan...",
      "Preparing discovery request.",
      5
    );

    const discoveryResponse =
      await discoverDomains(config);

    const discovered =
      normalizeArray(
        discoveryResponse.domains
      );

    if (!discovered.length) {
      setProgress(
        "Complete",
        "No domains were discovered in the selected period.",
        100
      );

      renderResults([]);

      return;
    }

    const scanResponse =
      await scanSites(
        config,
        discovered
      );

    const scannedCandidates =
      normalizeArray(
        scanResponse.candidates ||
        scanResponse.results
      );

    setProgress(
      "Filtering investment sites...",
      `${scannedCandidates.length} relevant candidates found.`,
      55
    );

    const freshCandidates =
      await removePreviouslyAnalyzed(
        scannedCandidates
      );

    setProgress(
      "Removing previously analyzed...",
      `${freshCandidates.length} new sites remain.`,
      70
    );

    if (!freshCandidates.length) {
      setProgress(
        "Complete",
        "All matching domains were already analyzed previously.",
        100
      );

      renderResults([]);

      return;
    }

    const aiResponse =
      await analyzeWithGemini(
        freshCandidates
      );

    if (aiResponse.error) {
      setProgress(
        "Complete",
        aiResponse.error,
        100
      );

      renderResults(
        freshCandidates.map(item => ({
          ...(typeof item === "object"
            ? item
            : { domain: item }),
          scamScore: 0,
          classification: "AI unavailable",
          summary:
            "Local scan completed. Gemini analysis was unavailable."
        }))
      );

      return;
    }

    await saveAnalysisResults(
      aiResponse.results
    );

    const scanRecord = {
      createdAt: new Date().toISOString(),

      tlds: config.tlds,

      period: config.period,

      paymentMethods:
        config.paymentMethods,

      discoveredCount:
        discovered.length,

      candidateCount:
        scannedCandidates.length,

      newCandidateCount:
        freshCandidates.length,

      analyzedCount:
        aiResponse.results.length,

      geminiRequests:
        aiResponse.requestsMade
    };

    await saveScan(scanRecord);

    renderResults(
      aiResponse.results
    );

    setProgress(
      "Complete",
      `Analyzed ${aiResponse.results.length} sites using ${aiResponse.requestsMade} Gemini request${aiResponse.requestsMade === 1 ? "" : "s"}.`,
      100
    );
  } catch (error) {
    console.error(error);

    setProgress(
      "Scan failed",
      error.message ||
        "An unexpected error occurred.",
      100
    );

    alert(
      error.message ||
      "Scan failed. Please try again."
    );
  } finally {
    setScanning(false);
  }
}

/* =========================================================
   Result Actions
========================================================= */

function handleResultAction(event) {
  const openButton =
    event.target.closest(
      "[data-open-url]"
    );

  if (openButton) {
    const url =
      openButton.dataset.openUrl;

    if (url) {
      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );
    }

    return;
  }

  const detailsButton =
    event.target.closest(
      "[data-details-domain]"
    );

  if (detailsButton) {
    const domain =
      detailsButton.dataset.detailsDomain;

    const result =
      state.results.find(
        item => item.domain === domain
      );

    if (result) {
      showDetails(result);
    }
  }
}

function showDetails(result) {
  const details = [
    `Website: ${result.websiteName || result.domain}`,
    `Domain: ${result.domain}`,
    `GEMINI SCAM SCORE: ${result.scamScore ?? "N/A"}`,
    `Classification: ${
      result.classification ||
      getClassification(result.scamScore)
    }`,
    `Confidence: ${result.confidence || "Unknown"}`,
    "",
    result.summary || "No summary available."
  ].join("\n");

  alert(details);
}

/* =========================================================
   Navigation
========================================================= */

function setActiveView(view) {
  state.currentView = view;

  elements.navButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });

  if (view === "home") {
    elements.resultsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  if (view === "history") {
    showHistory();
    return;
  }

  if (view === "settings") {
    showSettings();
  }
}

/* =========================================================
   History
========================================================= */

async function showHistory() {
  try {
    const domains =
      await getAllDomains();

    const analyzed =
      domains.filter(
        item => item.aiAnalyzed
      );

    if (!analyzed.length) {
      elements.resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <h3>No history yet</h3>
          <p>
            Completed Gemini analyses will appear here.
          </p>
        </div>
      `;

      return;
    }

    elements.resultsContainer.innerHTML =
      analyzed
        .sort(
          (a, b) =>
            new Date(
              b.lastScanned || 0
            ) -
            new Date(
              a.lastScanned || 0
            )
        )
        .map(item =>
          renderResultCard(
            item.aiAnalysis || {
              domain: item.domain,
              websiteName:
                item.websiteName,
              scamScore: item.aiScore,
              status: item.status
            }
          )
        )
        .join("");

    elements.resultsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    console.error(error);

    alert(
      "Could not load scan history."
    );
  }
}

/* =========================================================
   Settings
========================================================= */

function showSettings() {
  const enabled =
    localStorage.getItem(
      "ld76GeminiEnabled"
    ) === "true";

  const answer = confirm(
    `Gemini analysis is currently ${
      enabled ? "ON" : "OFF"
    }.\n\nPress OK to turn it ${
      enabled ? "OFF" : "ON"
    }.`
  );

  if (!answer) {
    return;
  }

  const newValue = !enabled;

  localStorage.setItem(
    "ld76GeminiEnabled",
    String(newValue)
  );

  state.geminiEnabled = newValue;

  alert(
    `Gemini analysis is now ${
      newValue ? "ON" : "OFF"
    }.`
  );
}

/* =========================================================
   Event Listeners
========================================================= */

elements.periodButtons.forEach(button => {
  button.addEventListener(
    "click",
    () => {
      state.period =
        button.dataset.period;

      updatePeriodButtons();
      saveSettings();
    }
  );
});

elements.tldSelect.addEventListener(
  "change",
  saveSettings
);

[
  elements.paymentBank,
  elements.paymentEasypaisa,
  elements.paymentJazzcash,
  elements.paymentCrypto
].forEach(input => {
  input.addEventListener(
    "change",
    saveSettings
  );
});

elements.findSitesButton.addEventListener(
  "click",
  startScan
);

elements.refreshResultsButton.addEventListener(
  "click",
  () => {
    if (
      state.currentView === "history"
    ) {
      showHistory();
      return;
    }

    renderResults(state.results);
  }
);

elements.settingsButton.addEventListener(
  "click",
  showSettings
);

elements.resultsContainer.addEventListener(
  "click",
  handleResultAction
);

elements.navButtons.forEach(button => {
  button.addEventListener(
    "click",
    () => {
      setActiveView(
        button.dataset.view
      );
    }
  );
});

/* =========================================================
   Initialization
========================================================= */

async function initializeApp() {
  loadSettings();

  state.geminiEnabled =
    localStorage.getItem(
      "ld76GeminiEnabled"
    ) === "true";

  try {
    await openDatabase();
  } catch (error) {
    console.error(
      "IndexedDB initialization failed.",
      error
    );
  }

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register(
        "/sw.js"
      );
    } catch (error) {
      console.warn(
        "Service worker registration failed.",
        error
      );
    }
  }

  updatePeriodButtons();
}

initializeApp();
