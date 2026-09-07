"use strict";

/*
 * LD76 INVESTMENT RADAR
 * =====================
 * GEMINI FINAL ANALYSIS
 *
 * Scanner evidence collect karta hai.
 * Ye file sirf Gemini ko evidence deti hai.
 *
 * Gemini:
 * - scamScore 0-100
 * - red flags
 * - positive signals
 * - missing information
 * - investment claims
 * - payment methods
 *
 * IMPORTANT:
 * - Investment website automatically scam nahi.
 * - Payment method automatically scam nahi.
 * - Missing information automatically scam nahi.
 * - Gemini result valid JSON hona zaroori hai.
 * - Invalid Gemini result ko successful analysis nahi maana jayega.
 */

const DEFAULT_MODEL =
  "gemini-2.5-flash";

const MAX_CANDIDATES_PER_REQUEST =
  20;

const MAX_EVIDENCE_CHARS =
  10000;

const GEMINI_TIMEOUT_MS =
  30000;

const MAX_RETRIES =
  1;


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  const startedAt =
    Date.now();

  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      ok: false,
      stage: "gemini-api",
      error:
        "Method not allowed. Use POST."
    });
  }

  const apiKey =
    String(
      process.env.GEMINI_API_KEY || ""
    ).trim();

  const model =
    String(
      process.env.GEMINI_MODEL ||
        DEFAULT_MODEL
    ).trim();

  const enabled =
    String(
      process.env.GEMINI_ENABLED ||
        "true"
    ).toLowerCase() !== "false";


  /* =======================================================
     CONFIG
  ======================================================= */

  if (!enabled) {
    return res.status(200).json({
      ok: true,
      enabled: false,
      stage: "gemini-disabled",
      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: [],
      message:
        "Gemini is disabled."
    });
  }


  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      enabled: false,
      stage:
        "gemini-configuration",
      error:
        "GEMINI_API_KEY is missing.",
      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: []
    });
  }


  /* =======================================================
     INPUT
  ======================================================= */

  try {
    const body =
      parseBody(req);

    const candidates =
      Array.isArray(
        body.candidates
      )
        ? body.candidates
        : [];


    if (
      candidates.length === 0
    ) {
      return res.status(200).json({
        ok: true,
        enabled: true,
        stage: "gemini-input",
        requestCount: 0,
        submittedCount: 0,
        resultCount: 0,
        results: [],
        message:
          "No candidates were supplied."
      });
    }


    /*
     * No arbitrary 4/5 site limit.
     *
     * Large scans are automatically divided
     * into batches.
     */

    const batches =
      createBatches(
        candidates,
        MAX_CANDIDATES_PER_REQUEST
      );

    const allResults = [];

    let requestCount = 0;


    /* =======================================================
       GEMINI BATCHES
    ======================================================= */

    for (
      let i = 0;
      i < batches.length;
      i++
    ) {
      const batch =
        batches[i];

      requestCount++;

      try {
        const results =
          await analyzeBatch({
            candidates: batch,
            apiKey,
            model
          });

        if (
          Array.isArray(results)
        ) {
          for (
            const result of results
          ) {
            allResults.push(
              result
            );
          }
        }

      } catch (error) {
        console.error(
          "[LD76][GEMINI] Batch failed",
          error
        );

        return res.status(
          error.httpStatus || 502
        ).json({
          ok: false,
          enabled: true,
          stage:
            "gemini-request",

          requestCount,

          submittedCount:
            candidates.length,

          resultCount:
            allResults.length,

          results:
            allResults,

          error:
            error.message ||
            "Gemini analysis failed.",

          diagnostic:
            error.diagnostic || {
              stage:
                "gemini-request",
              model,
              batch:
                i + 1,
              totalBatches:
                batches.length,
              elapsedMs:
                Date.now() -
                startedAt
            }
        });
      }
    }


    /* =======================================================
       ORDER RESULTS
    ======================================================= */

    const order =
      new Map();

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {
      const domain =
        normalizeDomain(
          candidates[i]?.domain
        );

      if (domain) {
        order.set(
          domain,
          i
        );
      }
    }


    allResults.sort(
      (a, b) => {
        const aIndex =
          order.get(
            normalizeDomain(
              a?.domain
            )
          );

        const bIndex =
          order.get(
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


    /* =======================================================
       SUCCESS
    ======================================================= */

    return res.status(200).json({
      ok: true,
      enabled: true,
      stage:
        "gemini-complete",

      requestCount,

      submittedCount:
        candidates.length,

      resultCount:
        allResults.length,

      results:
        allResults,

      diagnostic: {
        model,

        totalBatches:
          batches.length,

        submittedCandidates:
          candidates.length,

        returnedResults:
          allResults.length,

        elapsedMs:
          Date.now() -
          startedAt
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
      stage:
        "gemini-handler",

      requestCount: 0,
      submittedCount: 0,
      resultCount: 0,
      results: [],

      error:
        error.message ||
        "Unexpected Gemini handler error."
    });
  }
}


/* =========================================================
   BODY
========================================================= */

function parseBody(req) {
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
   BATCHES
========================================================= */

function createBatches(
  items,
  size
) {
  const batches = [];

  if (
    !Array.isArray(items)
  ) {
    return batches;
  }

  const batchSize =
    Math.max(
      1,
      Number(size) || 1
    );

  for (
    let i = 0;
    i < items.length;
    i += batchSize
  ) {
    batches.push(
      items.slice(
        i,
        i + batchSize
      )
    );
  }

  return batches;
}


/* =========================================================
   ANALYZE BATCH
========================================================= */

async function analyzeBatch({
  candidates,
  apiKey,
  model
}) {
  const prompt =
    buildPrompt(
      candidates
    );

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

  let lastError = null;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      return await requestGemini({
        endpoint,
        prompt
      });

    } catch (error) {
      lastError =
        error;

      const status =
        Number(
          error.httpStatus || 0
        );

      /*
       * Don't retry authentication,
       * invalid request, missing model,
       * or quota errors.
       */

      const noRetry =
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 429;

      if (
        noRetry ||
        attempt >= MAX_RETRIES
      ) {
        break;
      }

      await sleep(
        1000
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
   GEMINI REQUEST
========================================================= */

async function requestGemini({
  endpoint,
  prompt
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
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
                      text:
                        prompt
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
    const networkError =
      new Error(
        error?.name ===
        "AbortError"
          ? "Gemini request timed out."
          : `Gemini network error: ${
              error?.message ||
              "Unknown error"
            }`
      );

    networkError.httpStatus =
      error?.name ===
      "AbortError"
        ? 504
        : 502;

    networkError.diagnostic = {
      stage:
        "gemini-network",

      reason:
        error?.name ===
        "AbortError"
          ? "GEMINI_TIMEOUT"
          : "GEMINI_NETWORK_ERROR"
    };

    throw networkError;

  } finally {
    clearTimeout(
      timer
    );
  }


  /* =======================================================
     PROVIDER ERROR
  ======================================================= */

  if (
    !response.ok
  ) {
    let providerText =
      "";

    try {
      providerText =
        await response.text();
    } catch {
      providerText =
        "";
    }

    providerText =
      providerText.slice(
        0,
        2500
      );

    let providerMessage =
      "";

    try {
      const parsed =
        JSON.parse(
          providerText
        );

      providerMessage =
        parsed?.error?.message ||
        parsed?.message ||
        "";

    } catch {
      providerMessage =
        providerText;
    }


    const status =
      response.status;

    let reason =
      "GEMINI_REQUEST_ERROR";

    if (
      status === 400
    ) {
      reason =
        "GEMINI_INVALID_REQUEST";
    } else if (
      status === 401 ||
      status === 403
    ) {
      reason =
        "GEMINI_AUTH";
    } else if (
      status === 404
    ) {
      reason =
        "GEMINI_MODEL_NOT_FOUND";
    } else if (
      status === 429
    ) {
      reason =
        "GEMINI_QUOTA";
    } else if (
      status >= 500
    ) {
      reason =
        "GEMINI_SERVICE";
    }


    const error =
      new Error(
        providerMessage
          ? `Gemini HTTP ${status}: ${providerMessage}`
          : `Gemini HTTP ${status}.`
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


  /* =======================================================
     RESPONSE JSON
  ======================================================= */

  let data;

  try {
    data =
      await response.json();

  } catch {
    const error =
      new Error(
        "Gemini returned invalid JSON."
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
    extractGeminiText(
      data
    );

  if (!text) {
    const error =
      new Error(
        "Gemini returned an empty response."
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
      parseGeminiJson(
        text
      );

  } catch (error) {
    const parseError =
      new Error(
        `Gemini analysis JSON could not be parsed: ${
          error.message
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


  return normalizeResults(
    rawResults
  );
}


/* =========================================================
   PROMPT
========================================================= */

function buildPrompt(
  candidates
) {
  const compact =
    candidates.map(
      candidate => ({
        domain:
          normalizeDomain(
            candidate?.domain
          ),

        websiteName:
          candidate?.websiteName ||
          candidate?.title ||
          "",

        registeredAt:
          candidate?.registeredAt ||
          null,

        discoveredAt:
          candidate?.discoveredAt ||
          null,

        registrationVerified:
          candidate?.registrationVerified ===
          true,

        evidence:
          compactEvidence(
            candidate
          )
      })
    );


  return `
You are the final evidence-based analyst for LD76 Investment Radar.

Analyze each supplied website using ONLY the evidence provided.

This is research and risk assessment, not an accusation.

IMPORTANT RULES:

1. Do NOT automatically classify an investment or earning website as a scam.
2. Do NOT automatically classify a website as a scam because it accepts crypto.
3. Do NOT automatically classify a website as a scam because it accepts Bank, Easypaisa, JazzCash, or another payment method.
4. Do NOT treat Telegram, WhatsApp, referral programs, or social media as automatic proof of fraud.
5. Do NOT invent facts.
6. Do NOT invent company registration, license, regulator, owners, addresses, payment details, returns, or legal status.
7. Missing evidence is NOT proof of fraud. Put missing information in missingInformation.
8. Evaluate guaranteed returns, fixed returns, unrealistic ROI, daily profit claims, deposit requirements, withdrawal restrictions, referral structures, company identity, legal information, and contradictory evidence carefully.
9. Separate suspicious indicators from positive signals.
10. Scam score must represent the strength of scam indicators found in the supplied evidence.
11. 0 means almost no scam indicators found.
12. 100 means extremely strong scam indicators found.
13. Confidence is how confident you are in the assessment based on the amount and quality of evidence.
14. Return one object for every supplied candidate.
15. Return ONLY valid JSON.

CLASSIFICATION:

0-20   = Very Low Scam Indicators
21-40  = Low
41-60  = Moderate / Uncertain
61-80  = Suspicious
81-100 = Highly Suspicious

OUTPUT FORMAT:

{
  "results": [
    {
      "domain": "example.com",
      "websiteName": "Example",
      "scamScore": 0,
      "classification": "Very Low Scam Indicators",
      "confidence": 0,
      "summary": "Evidence-based assessment.",
      "redFlags": [],
      "positiveSignals": [],
      "missingInformation": [],
      "investmentClaims": [],
      "paymentMethods": []
    }
  ]
}

Every array must contain strings only.

Candidates:

${JSON.stringify(
  compact,
  null,
  2
)}
`;
}


/* =========================================================
   EVIDENCE
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
    "Website name",
    candidate?.websiteName
  );

  addEvidence(
    parts,
    "Description",
    candidate?.description
  );

  addEvidence(
    parts,
    "Investment",
    candidate?.investment
  );

  addEvidence(
    parts,
    "Investment claims",
    candidate?.investmentClaims
  );

  addEvidence(
    parts,
    "Financial signals",
    candidate?.financialSignals
  );

  addEvidence(
    parts,
    "Payment methods",
    candidate?.paymentMethods
  );

  addEvidence(
    parts,
    "Company",
    candidate?.company
  );

  addEvidence(
    parts,
    "Legal",
    candidate?.legal
  );

  addEvidence(
    parts,
    "Contact",
    candidate?.contact
  );

  addEvidence(
    parts,
    "Referral",
    candidate?.referral
  );

  addEvidence(
    parts,
    "Withdrawal",
    candidate?.withdrawal
  );

  addEvidence(
    parts,
    "Deposit",
    candidate?.deposit
  );

  addEvidence(
    parts,
    "Website text",
    candidate?.content
  );

  addEvidence(
    parts,
    "Website text",
    candidate?.text
  );

  addEvidence(
    parts,
    "Snippets",
    candidate?.snippets
  );

  addEvidence(
    parts,
    "Evidence",
    candidate?.evidence
  );


  let result =
    parts.join(
      "\n\n"
    );

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
    text =
      value.trim();

  } else {
    try {
      text =
        JSON.stringify(
          value
        );
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
   GEMINI TEXT
========================================================= */

function extractGeminiText(
  data
) {
  const parts =
    data?.candidates?.[0]
      ?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return "";
  }

  return parts
    .map(
      part =>
        typeof part?.text ===
        "string"
          ? part.text
          : ""
    )
    .join("")
    .trim();
}


/* =========================================================
   PARSE GEMINI JSON
========================================================= */

function parseGeminiJson(
  text
) {
  let cleaned =
    String(text || "")
      .trim();

  if (!cleaned) {
    throw new Error(
      "Empty response."
    );
  }


  /*
   * Remove markdown fences.
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


  /*
   * First attempt:
   * direct JSON.
   */

  try {
    return JSON.parse(
      cleaned
    );
  } catch {
    // Continue.
  }


  /*
   * Sometimes Gemini may put
   * text before/after JSON.
   *
   * Extract first JSON object.
   */

  const objectStart =
    cleaned.indexOf(
      "{"
    );

  const objectEnd =
    cleaned.lastIndexOf(
      "}"
    );

  if (
    objectStart >= 0 &&
    objectEnd > objectStart
  ) {
    const objectText =
      cleaned.slice(
        objectStart,
        objectEnd + 1
      );

    return JSON.parse(
      objectText
    );
  }


  /*
   * Or JSON array.
   */

  const arrayStart =
    cleaned.indexOf(
      "["
    );

  const arrayEnd =
    cleaned.lastIndexOf(
      "]"
    );

  if (
    arrayStart >= 0 &&
    arrayEnd > arrayStart
  ) {
    const arrayText =
      cleaned.slice(
        arrayStart,
        arrayEnd + 1
      );

    return JSON.parse(
      arrayText
    );
  }


  throw new Error(
    "No valid JSON object or array found."
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

  const output = [];

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

    const scamScore =
      normalizeNumber(
        raw.scamScore
      );

    /*
     * Invalid score means this is NOT
     * a successfully analyzed result.
     */

    if (
      scamScore === null
    ) {
      continue;
    }

    const confidence =
      normalizeNumber(
        raw.confidence
      );


    output.push({
      domain,

      websiteName:
        cleanString(
          raw.websiteName
        ),

      scamScore,

      classification:
        normalizeClassification(
          raw.classification,
          scamScore
        ),

      confidence:
        confidence === null
          ? 0
          : confidence,

      summary:
        cleanString(
          raw.summary
        ),

      redFlags:
        normalizeArray(
          raw.redFlags
        ),

      positiveSignals:
        normalizeArray(
          raw.positiveSignals
        ),

      missingInformation:
        normalizeArray(
          raw.missingInformation
        ),

      investmentClaims:
        normalizeArray(
          raw.investmentClaims
        ),

      paymentMethods:
        normalizeArray(
          raw.paymentMethods
        )
    });
  }

  return output;
}


/* =========================================================
   NUMBER
========================================================= */

function normalizeNumber(
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
  const supplied =
    cleanString(
      value
    );

  if (supplied) {
    return supplied;
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
   ARRAY
========================================================= */

function normalizeArray(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map(
      item =>
        cleanString(item)
    )
    .filter(Boolean);
}


/* =========================================================
   STRING
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


/* =========================================================
   DOMAIN
========================================================= */

function normalizeDomain(
  value
) {
  let domain =
    cleanString(
      value
    ).toLowerCase();

  if (!domain) {
    return "";
  }

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


/* =========================================================
   SLEEP
========================================================= */

function sleep(
  milliseconds
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
       }
