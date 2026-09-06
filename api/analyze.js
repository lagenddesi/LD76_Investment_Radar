"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Gemini Analysis API
 *
 * - Gemini 3.6 Flash
 * - No arbitrary 4/5 candidate limit
 * - Up to 30 candidates per Gemini request
 * - Larger scans are automatically batched
 * - Only valid Gemini results are returned
 * - API key is never exposed to client
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

const MAX_CANDIDATES_PER_REQUEST = 30;

const MAX_EVIDENCE_CHARS = 12000;

const GEMINI_TIMEOUT_MS = 30000;

const MAX_RETRIES = 1;


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      stage: "gemini-api",
      error: "Method not allowed. Use POST.",
      diagnostic: {
        stage: "gemini-api",
        reason: "METHOD_NOT_ALLOWED",
        httpStatus: 405
      }
    });
  }

  const apiKey = String(
    process.env.GEMINI_API_KEY || ""
  ).trim();

  const explicitlyDisabled =
    String(
      process.env.GEMINI_ENABLED || ""
    ).toLowerCase() === "false";

  const model = String(
    process.env.GEMINI_MODEL ||
      DEFAULT_MODEL
  ).trim();


  /* =======================================================
     CONFIGURATION
  ======================================================= */

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      enabled: false,
      stage: "gemini-configuration",
      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: [],
      error:
        "Gemini API key is missing. Add GEMINI_API_KEY in Vercel Environment Variables and redeploy.",
      diagnostic: {
        stage: "gemini-configuration",
        reason: "GEMINI_API_KEY_MISSING",
        model,
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  if (explicitlyDisabled) {
    return res.status(200).json({
      ok: true,
      enabled: false,
      stage: "gemini-disabled",
      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: [],
      message:
        "Gemini is disabled because GEMINI_ENABLED=false.",
      diagnostic: {
        stage: "gemini-disabled",
        reason: "GEMINI_ENABLED_FALSE",
        model
      }
    });
  }


  /* =======================================================
     INPUT
  ======================================================= */

  try {
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    /*
     * IMPORTANT:
     * candidates is declared here and passed explicitly
     * to every function that needs it.
     */

    const candidates = Array.isArray(
      body.candidates
    )
      ? body.candidates
      : [];

    if (candidates.length === 0) {
      return res.status(200).json({
        ok: true,
        enabled: true,
        stage: "gemini-input",
        requestCount: 0,
        submittedCount: 0,
        resultCount: 0,
        results: [],
        message:
          "No candidates were supplied to Gemini.",
        diagnostic: {
          stage: "gemini-input",
          reason: "NO_CANDIDATES",
          model
        }
      });
    }


    /* =====================================================
       BATCHING

       1-30   = 1 request
       31-60  = 2 requests
       61-90  = 3 requests
       etc.

       NO arbitrary 4/5 site limit.
    ===================================================== */

    const batches = createBatches(
      candidates,
      MAX_CANDIDATES_PER_REQUEST
    );

    const allResults = [];

    let attemptedRequests = 0;


    /* =====================================================
       GEMINI REQUEST LOOP
    ===================================================== */

    for (
      let batchIndex = 0;
      batchIndex < batches.length;
      batchIndex++
    ) {
      const batch = batches[batchIndex];

      attemptedRequests++;

      console.log(
        "[LD76][GEMINI] Starting batch",
        {
          batch: batchIndex + 1,
          totalBatches: batches.length,
          candidateCount: batch.length,
          model
        }
      );

      try {
        const batchResults =
          await analyzeBatch({
            candidates: batch,
            apiKey,
            model
          });

        if (Array.isArray(batchResults)) {
          allResults.push(
            ...batchResults
          );
        }

        console.log(
          "[LD76][GEMINI] Batch complete",
          {
            batch: batchIndex + 1,
            resultCount:
              Array.isArray(batchResults)
                ? batchResults.length
                : 0
          }
        );

      } catch (error) {
        console.error(
          "[LD76][GEMINI] Batch failed",
          {
            batch: batchIndex + 1,
            error:
              error?.message ||
              "Unknown Gemini error"
          }
        );

        const diagnostic =
          error?.diagnostic || {};

        return res.status(
          Number(error?.httpStatus) || 502
        ).json({
          ok: false,
          enabled: true,
          stage: "gemini-request",

          requestCount:
            attemptedRequests,

          submittedCount:
            candidates.length,

          resultCount:
            allResults.length,

          results:
            allResults,

          error:
            error?.message ||
            "Gemini could not complete the analysis.",

          diagnostic: {
            stage:
              diagnostic.stage ||
              "gemini-request",

            reason:
              diagnostic.reason ||
              "UNKNOWN_GEMINI_ERROR",

            httpStatus:
              diagnostic.httpStatus ||
              error?.httpStatus ||
              null,

            model,

            batch:
              batchIndex + 1,

            totalBatches:
              batches.length,

            batchCandidates:
              batch.length,

            attemptedRequests,

            completedResults:
              allResults.length,

            elapsedMs:
              Date.now() - startedAt,

            providerMessage:
              diagnostic.providerMessage ||
              null
          }
        });
      }
    }


    /* =====================================================
       SORT RESULTS IN ORIGINAL INPUT ORDER
    ===================================================== */

    const inputOrder =
      new Map();

    candidates.forEach(
      (candidate, index) => {
        inputOrder.set(
          normalizeDomain(
            candidate?.domain
          ),
          index
        );
      }
    );

    allResults.sort(
      (a, b) => {
        const aIndex =
          inputOrder.get(
            normalizeDomain(
              a?.domain
            )
          );

        const bIndex =
          inputOrder.get(
            normalizeDomain(
              b?.domain
            )
          );

        return (
          (aIndex ?? 999999) -
          (bIndex ?? 999999)
        );
      }
    );


    /* =====================================================
       SUCCESS
    ===================================================== */

    return res.status(200).json({
      ok: true,
      enabled: true,
      stage: "gemini-complete",

      requestCount:
        batches.length,

      submittedCount:
        candidates.length,

      resultCount:
        allResults.length,

      results:
        allResults,

      diagnostic: {
        stage: "gemini-complete",
        model,

        totalBatches:
          batches.length,

        submittedCandidates:
          candidates.length,

        returnedResults:
          allResults.length,

        elapsedMs:
          Date.now() - startedAt
      }
    });

  } catch (error) {
    console.error(
      "[LD76][GEMINI] Handler error",
      error
    );

    return res.status(500).json({
      ok: false,
      enabled: true,
      stage: "gemini-handler",

      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: [],

      error:
        error?.message ||
        "Unexpected Gemini handler error.",

      diagnostic: {
        stage: "gemini-handler",
        reason:
          "UNEXPECTED_HANDLER_ERROR",
        model,
        elapsedMs:
          Date.now() - startedAt
      }
    });
  }
}


/* =========================================================
   CREATE BATCHES
========================================================= */

function createBatches(
  items,
  batchSize
) {
  const result = [];

  if (!Array.isArray(items)) {
    return result;
  }

  const safeSize =
    Math.max(
      1,
      Number(batchSize) || 1
    );

  for (
    let i = 0;
    i < items.length;
    i += safeSize
  ) {
    result.push(
      items.slice(
        i,
        i + safeSize
      )
    );
  }

  return result;
}


/* =========================================================
   ANALYZE ONE BATCH
========================================================= */

async function analyzeBatch({
  candidates,
  apiKey,
  model
}) {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return [];
  }

  const prompt =
    buildPrompt(candidates);

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES + 1;
    attempt++
  ) {
    try {
      return await performGeminiRequest({
        endpoint,
        prompt
      });

    } catch (error) {
      lastError = error;

      const status =
        Number(
          error?.httpStatus
        ) || 0;

      const reason =
        error?.diagnostic?.reason ||
        "";

      const nonRetryable =
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 429 ||
        reason ===
          "GEMINI_AUTH" ||
        reason ===
          "GEMINI_INVALID_REQUEST" ||
        reason ===
          "GEMINI_MODEL_NOT_FOUND";

      if (
        nonRetryable ||
        attempt >= MAX_RETRIES + 1
      ) {
        break;
      }

      await sleep(
        1000 * attempt
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "Gemini request failed."
    )
  );
}


/* =========================================================
   GEMINI HTTP REQUEST
========================================================= */

async function performGeminiRequest({
  endpoint,
  prompt
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      GEMINI_TIMEOUT_MS
    );

  let response;

  try {
    response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({
              contents: [
                {
                  role: "user",

                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ],

              generationConfig: {
                temperature: 0.1,

                responseMimeType:
                  "application/json"
              }
            }),

          signal:
            controller.signal
        }
      );

  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          `Gemini request timed out after ${
            GEMINI_TIMEOUT_MS / 1000
          } seconds.`
        );

      timeoutError.httpStatus =
        504;

      timeoutError.diagnostic = {
        stage:
          "gemini-network",

        reason:
          "GEMINI_TIMEOUT"
      };

      throw timeoutError;
    }

    const networkError =
      new Error(
        `Gemini network connection failed: ${
          error?.message ||
          "Unknown network error"
        }`
      );

    networkError.httpStatus =
      502;

    networkError.diagnostic = {
      stage:
        "gemini-network",

      reason:
        "GEMINI_NETWORK_ERROR"
    };

    throw networkError;

  } finally {
    clearTimeout(timer);
  }


  /* =====================================================
     HTTP ERROR
  ===================================================== */

  if (!response.ok) {
    let providerBody = "";

    try {
      providerBody =
        await response.text();
    } catch {
      providerBody = "";
    }

    providerBody =
      String(
        providerBody || ""
      ).slice(0, 2500);

    let providerMessage = "";

    try {
      const parsed =
        JSON.parse(
          providerBody
        );

      providerMessage =
        parsed?.error?.message ||
        parsed?.message ||
        "";

    } catch {
      providerMessage =
        providerBody;
    }

    const status =
      response.status;

    let reason =
      "GEMINI_REQUEST_ERROR";

    let friendly =
      `Gemini API returned HTTP ${status}.`;


    if (status === 400) {
      reason =
        "GEMINI_INVALID_REQUEST";

      friendly =
        "Gemini rejected the request (HTTP 400).";
    }


    if (
      status === 401 ||
      status === 403
    ) {
      reason =
        "GEMINI_AUTH";

      friendly =
        `Gemini authentication/permission failed (HTTP ${status}). Check GEMINI_API_KEY.`;
    }


    if (status === 404) {
      reason =
        "GEMINI_MODEL_NOT_FOUND";

      friendly =
        `Gemini model/endpoint was not found (HTTP 404). Current model: ${modelSafeFromEndpoint(
          endpoint
        )}`;
    }


    if (status === 429) {
      reason =
        "GEMINI_QUOTA";

      friendly =
        "Gemini quota/rate limit was reached (HTTP 429).";
    }


    if (status >= 500) {
      reason =
        "GEMINI_SERVICE";

      friendly =
        `Gemini service returned HTTP ${status}.`;
    }


    const finalMessage =
      providerMessage
        ? `${friendly} Provider: ${providerMessage}`
        : friendly;

    const error =
      new Error(
        finalMessage
      );

    error.httpStatus =
      status;

    error.diagnostic = {
      stage:
        "gemini-provider",

      reason,

      httpStatus:
        status,

      providerMessage:
        providerMessage || null
    };

    throw error;
  }


  /* =====================================================
     READ GEMINI RESPONSE
  ===================================================== */

  let data;

  try {
    data =
      await response.json();

  } catch {
    const error =
      new Error(
        "Gemini returned a response that was not valid JSON."
      );

    error.httpStatus =
      502;

    error.diagnostic = {
      stage:
        "gemini-response",

      reason:
        "INVALID_PROVIDER_JSON"
    };

    throw error;
  }


  const text =
    extractGeminiText(data);

  if (!text) {
    const error =
      new Error(
        "Gemini returned an empty analysis response."
      );

    error.httpStatus =
      502;

    error.diagnostic = {
      stage:
        "gemini-response",

      reason:
        "EMPTY_GEMINI_RESPONSE"
    };

    throw error;
  }


  let parsed;

  try {
    parsed =
      parseJsonResponse(text);

  } catch (error) {
    const parseError =
      new Error(
        `Gemini returned invalid analysis JSON: ${
          error?.message ||
          "JSON parse failed"
        }`
      );

    parseError.httpStatus =
      502;

    parseError.diagnostic = {
      stage:
        "gemini-response",

      reason:
        "INVALID_ANALYSIS_JSON"
    };

    throw parseError;
  }


  const rawResults =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray(
          parsed?.results
        )
        ? parsed.results
        : [];

  const normalized =
    normalizeResults(
      rawResults
    );

  return normalized;
}


/* =========================================================
   BUILD PROMPT
========================================================= */

function buildPrompt(
  candidates
) {
  const safeCandidates =
    Array.isArray(candidates)
      ? candidates
      : [];

  const compactCandidates =
    safeCandidates.map(
      (candidate) => {
        const evidence =
          compactEvidence(
            candidate
          );

        return {
          domain:
            normalizeDomain(
              candidate?.domain
            ),

          websiteName:
            candidate?.websiteName ||
            candidate?.title ||
            "",

          url:
            candidate?.url ||
            "",

          discoveredAt:
            candidate?.discoveredAt ||
            null,

          registeredAt:
            candidate?.registeredAt ||
            null,

          registrationVerified:
            Boolean(
              candidate?.registrationVerified
            ),

          investmentRelevant:
            Boolean(
              candidate?.investmentRelevant
            ),

          paymentMethods:
            Array.isArray(
              candidate?.paymentMethods
            )
              ? candidate.paymentMethods
              : [],

          evidence
        };
      }
    );


  return `
You are the final evidence-based analyst for LD76 Investment Radar.

Your task is to analyze recently discovered websites that may be related to investment, earning, profit, deposit, withdrawal, referral, HYIP, financial promotion, or similar online money-making activity.

IMPORTANT:

1. Do NOT assume a website is a scam merely because it is an investment or earning website.
2. Do NOT treat uncertainty or missing information as proof of fraud.
3. Evaluate the supplied evidence only.
4. Separate verified facts, suspicious indicators, positive signals, and missing information.
5. A Telegram, WhatsApp, referral program, crypto payment, or Pakistani payment method alone does NOT prove scam.
6. Give a numerical GEMINI SCAM SCORE from 0 to 100.
7. 0 means very few scam indicators in the supplied evidence.
8. 100 means extremely strong scam indicators in the supplied evidence.
9. Return exactly one result for every supplied candidate whenever possible.
10. Do not invent company registrations, licenses, owners, addresses, payment methods, returns, or other facts.
11. If information is unavailable, explicitly say it is unavailable or unverified.
12. Numerical return/profit claims should be highlighted when present.
13. Pay particular attention to guaranteed/fixed returns, unrealistic daily/monthly returns, deposit requirements, withdrawal conditions, referral/MLM structures, missing legal identity, unverifiable company claims, fake-looking legal pages, and contradictory information.
14. Payment methods should be reported when actually detected in the supplied evidence.
15. Keep the response compact but useful.

For EACH candidate return this exact structure:

{
  "domain": "example.com",
  "websiteName": "Example",
  "scamScore": 0,
  "classification": "Very Low Scam Indicators",
  "confidence": 0,
  "summary": "Short evidence-based assessment.",
  "redFlags": [],
  "positiveSignals": [],
  "missingInformation": [],
  "investmentClaims": [],
  "paymentMethods": []
}

Classification bands:

0-20   = "Very Low Scam Indicators"
21-40  = "Low"
41-60  = "Moderate / Uncertain"
61-80  = "Suspicious"
81-100 = "Highly Suspicious"

"confidence" must also be a number from 0 to 100.

Return ONLY valid JSON.

Candidates:

${JSON.stringify(
  compactCandidates,
  null,
  2
)}
`;
}


/* =========================================================
   COMPACT EVIDENCE
========================================================= */

function compactEvidence(
  candidate
) {
  const parts = [];

  addEvidence(
    parts,
    "Title",
    candidate?.title
  );

  addEvidence(
    parts,
    "Meta description",
    candidate?.metaDescription
  );

  addEvidence(
    parts,
    "Website name",
    candidate?.websiteName
  );

  addEvidence(
    parts,
    "Company",
    candidate?.company
  );

  addEvidence(
    parts,
    "Registration",
    candidate?.registration
  );

  addEvidence(
    parts,
    "Legal",
    candidate?.legal
  );

  addEvidence(
    parts,
    "About",
    candidate?.about
  );

  addEvidence(
    parts,
    "Contact",
    candidate?.contact
  );

  addEvidence(
    parts,
    "Support",
    candidate?.support
  );

  addEvidence(
    parts,
    "Payment methods",
    candidate?.paymentMethods
  );

  addEvidence(
    parts,
    "Investment claims",
    candidate?.investmentClaims
  );

  addEvidence(
    parts,
    "Referral",
    candidate?.referral
  );

  addEvidence(
    parts,
    "Website text",
    candidate?.text
  );

  addEvidence(
    parts,
    "Relevant snippets",
    candidate?.relevantSnippets
  );

  addEvidence(
    parts,
    "Links",
    candidate?.links
  );

  addEvidence(
    parts,
    "Other evidence",
    candidate?.evidence
  );


  let result =
    parts.join("\n\n");

  if (
    result.length >
    MAX_EVIDENCE_CHARS
  ) {
    result =
      result.slice(
        0,
        MAX_EVIDENCE_CHARS
      ) +
      "\n\n[Evidence truncated]";
  }

  return result;
}


function addEvidence(
  parts,
  label,
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  let text;

  if (
    typeof value ===
    "string"
  ) {
    text = value.trim();
  } else {
    try {
      text =
        JSON.stringify(value);
    } catch {
      text =
        String(value);
    }
  }

  if (!text) {
    return;
  }

  parts.push(
    `${label}: ${text}`
  );
}


/* =========================================================
   EXTRACT TEXT FROM GEMINI RESPONSE
========================================================= */

function extractGeminiText(
  data
) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return "";
  }

  return parts
    .map(
      (part) =>
        typeof part?.text ===
        "string"
          ? part.text
          : ""
    )
    .join("")
    .trim();
}


/* =========================================================
   PARSE JSON
========================================================= */

function parseJsonResponse(
  text
) {
  let cleaned =
    String(text || "")
      .trim();

  if (!cleaned) {
    throw new Error(
      "Empty Gemini response."
    );
  }


  /*
   * Remove markdown code fences
   * if Gemini unexpectedly adds them.
   */

  cleaned =
    cleaned
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();


  return JSON.parse(
    cleaned
  );
}


/* =========================================================
   NORMALIZE RESULTS
========================================================= */

function normalizeResults(
  rawResults
) {
  if (
    !Array.isArray(
      rawResults
    )
  ) {
    return [];
  }

  const results = [];

  for (
    const raw of rawResults
  ) {
    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      continue;
    }

    const domain =
      normalizeDomain(
        raw.domain
      );

    if (!domain) {
      continue;
    }

    const score =
      normalizeScore(
        raw.scamScore
      );

    /*
     * IMPORTANT:
     * A result without a valid score
     * is NOT treated as a successful
     * Gemini analysis.
     */

    if (score === null) {
      continue;
    }

    const classification =
      normalizeClassification(
        raw.classification,
        score
      );

    const confidence =
      normalizeScore(
        raw.confidence
      );

    results.push({
      domain,

      websiteName:
        cleanString(
          raw.websiteName
        ),

      scamScore:
        score,

      classification,

      confidence:
        confidence === null
          ? null
          : confidence,

      summary:
        cleanString(
          raw.summary
        ),

      redFlags:
        normalizeStringArray(
          raw.redFlags
        ),

      positiveSignals:
        normalizeStringArray(
          raw.positiveSignals
        ),

      missingInformation:
        normalizeStringArray(
          raw.missingInformation
        ),

      investmentClaims:
        normalizeStringArray(
          raw.investmentClaims
        ),

      paymentMethods:
        normalizeStringArray(
          raw.paymentMethods
        )
    });
  }

  return results;
}


/* =========================================================
   SCORE
========================================================= */

function normalizeScore(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number)
    )
  );
}


/* =========================================================
   CLASSIFICATION
========================================================= */

function normalizeClassification(
  value,
  score
) {
  const text =
    cleanString(value);

  if (text) {
    return text;
  }

  if (score <= 20) {
    return "Very Low Scam Indicators";
  }

  if (score <= 40) {
    return "Low";
  }

  if (score <= 60) {
    return "Moderate / Uncertain";
  }

  if (score <= 80) {
    return "Suspicious";
  }

  return "Highly Suspicious";
}


/* =========================================================
   STRING HELPERS
========================================================= */

function cleanString(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(
    value
  ).trim();
}


function normalizeStringArray(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map(
      (item) =>
        cleanString(item)
    )
    .filter(Boolean);
}


/* =========================================================
   DOMAIN NORMALIZATION
========================================================= */

function normalizeDomain(
  value
) {
  let domain =
    cleanString(value)
      .toLowerCase();

  if (!domain) {
    return "";
  }

  domain =
    domain.replace(
      /^https?:\/\//,
      ""
    );

  domain =
    domain.split("/")[0];

  domain =
    domain.replace(
      /^www\./,
      ""
    );

  domain =
    domain.replace(
      /\.$/,
      ""
    );

  return domain;
}


/* =========================================================
   MODEL DISPLAY HELPER
========================================================= */

function modelSafeFromEndpoint(
  endpoint
) {
  try {
    const match =
      String(endpoint)
        .match(
          /\/models\/([^:?#]+)/i
        );

    if (
      match?.[1]
    ) {
      return decodeURIComponent(
        match[1]
      );
    }
  } catch {
    // Ignore parsing failure.
  }

  return "configured Gemini model";
}


/* =========================================================
   SLEEP
========================================================= */

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
         }
