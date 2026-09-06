"use strict";

/*
 * LD76 INVESTMENT RADAR
 * Gemini Analysis API
 *
 * Diagnostic version.
 *
 * IMPORTANT:
 * - No arbitrary 4/5 candidate limit.
 * - Up to 30 candidates per Gemini request.
 * - More candidates are automatically batched.
 * - Failed requests return detailed diagnostic information.
 * - API key is NEVER returned to the client.
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
  const requestStartedAt = Date.now();

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,

      stage: "gemini-api",

      error:
        "Method not allowed. Use POST.",

      diagnostic: {
        httpStatus: 405,
        stage: "gemini-api"
      }
    });
  }


  const apiKey =
    String(
      process.env.GEMINI_API_KEY || ""
    ).trim();

  const explicitlyDisabled =
    String(
      process.env.GEMINI_ENABLED || ""
    ).toLowerCase() === "false";

  const model =
    String(
      process.env.GEMINI_MODEL ||
      DEFAULT_MODEL
    ).trim();


  /*
   * -------------------------------------------------------
   * CONFIGURATION CHECK
   * -------------------------------------------------------
   */

  if (!apiKey) {
    return res.status(503).json({
      ok: false,

      enabled: false,

      stage:
        "gemini-configuration",

      requestCount: 0,

      submittedCount: 0,

      resultCount: 0,

      error:
        "Gemini API key is missing. Add GEMINI_API_KEY in Vercel Environment Variables, then redeploy.",

      diagnostic: {
        stage:
          "gemini-configuration",

        reason:
          "GEMINI_API_KEY_MISSING",

        model,

        elapsedMs:
          Date.now() -
          requestStartedAt
      }
    });
  }


  if (explicitlyDisabled) {
    return res.status(200).json({
      ok: true,

      enabled: false,

      stage:
        "gemini-disabled",

      requestCount: 0,

      submittedCount: 0,

      resultCount: 0,

      results: [],

      message:
        "Gemini is disabled because GEMINI_ENABLED=false.",

      diagnostic: {
        stage:
          "gemini-disabled",

        reason:
          "GEMINI_ENABLED_FALSE",

        model
      }
    });
  }


  /*
   * -------------------------------------------------------
   * INPUT
   * -------------------------------------------------------
   */

  try {
    const body =
      req.body || {};

    const candidates =
      Array.isArray(
        body.candidates
      )
        ? body.candidates
        : [];


    if (!candidates.length) {
      return res.status(200).json({
        ok: true,

        enabled: true,

        stage:
          "gemini-input",

        requestCount: 0,

        submittedCount: 0,

        resultCount: 0,

        results: [],

        message:
          "No candidates were supplied to Gemini.",

        diagnostic: {
          stage:
            "gemini-input",

          reason:
            "NO_CANDIDATES"
        }
      });
    }


    /*
     * -----------------------------------------------------
     * BATCHING
     * -----------------------------------------------------
     *
     * There is NO 4/5 site limit.
     *
     * 1-30   = 1 request
     * 31-60  = 2 requests
     * 61-90  = 3 requests
     * etc.
     */

    const batches =
      createBatches(
        candidates,
        MAX_CANDIDATES_PER_REQUEST
      );


    const allResults = [];

    let attemptedRequests = 0;


    /*
     * -----------------------------------------------------
     * GEMINI REQUESTS
     * -----------------------------------------------------
     */

    for (
      let batchIndex = 0;
      batchIndex < batches.length;
      batchIndex++
    ) {
      const batch =
        batches[batchIndex];

      attemptedRequests++;


      console.log(
        "[LD76][GEMINI] Starting request",
        {
          batch:
            batchIndex + 1,

          totalBatches:
            batches.length,

          candidates:
            batch.length,

          model
        }
      );


      try {
        const batchResults =
          await analyzeBatch(
            batch,
            apiKey,
            model,
            batchIndex + 1,
            batches.length
          );

        allResults.push(
          ...batchResults
        );


        console.log(
          "[LD76][GEMINI] Request successful",
          {
            batch:
              batchIndex + 1,

            resultCount:
              batchResults.length
          }
        );

      } catch (error) {
        console.error(
          "[LD76][GEMINI] Request failed",
          {
            batch:
              batchIndex + 1,

            error:
              error?.message ||
              "Unknown error"
          }
        );


        /*
         * IMPORTANT:
         *
         * Return the actual attempted
         * request count instead of 0.
         */

        const diagnostic =
          error?.diagnostic ||
          {};

        return res.status(
          Number(
            error?.httpStatus
          ) || 502
        ).json({
          ok: false,

          enabled: true,

          stage:
            "gemini-request",

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
              Date.now() -
              requestStartedAt,

            providerMessage:
              diagnostic.providerMessage ||
              null
          }
        });
      }
    }


    /*
     * -----------------------------------------------------
     * SORT RESULTS
     * -----------------------------------------------------
     */

    const inputOrder =
      new Map(
        candidates.map(
          (candidate, index) => [
            normalizeDomain(
              candidate?.domain
            ),
            index
          ]
        )
      );


    allResults.sort(
      (a, b) =>
        (
          inputOrder.get(
            normalizeDomain(
              a?.domain
            )
          ) ?? 999999
        ) -
        (
          inputOrder.get(
            normalizeDomain(
              b?.domain
            )
          ) ?? 999999
        )
    );


    /*
     * -----------------------------------------------------
     * SUCCESS
     * -----------------------------------------------------
     */

    return res.status(200).json({
      ok: true,

      enabled: true,

      stage:
        "gemini-complete",

      requestCount:
        batches.length,

      submittedCount:
        candidates.length,

      resultCount:
        allResults.length,

      results:
        allResults,

      diagnostic: {
        stage:
          "gemini-complete",

        model,

        totalBatches:
          batches.length,

        submittedCandidates:
          candidates.length,

        returnedResults:
          allResults.length,

        elapsedMs:
          Date.now() -
          requestStartedAt
      }
    });

  } catch (error) {
    console.error(
      "[LD76][GEMINI] Handler error:",
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

      error:
        error?.message ||
        "Unexpected Gemini handler error.",

      diagnostic: {
        stage:
          "gemini-handler",

        reason:
          "UNEXPECTED_HANDLER_ERROR",

        elapsedMs:
          Date.now() -
          requestStartedAt
      }
    });
  }
}


/* =========================================================
   GEMINI BATCH
========================================================= */

async function analyzeBatch(
  candidates,
  apiKey,
  model,
  batchNumber,
  totalBatches
) {
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
    let attempt = 1;
    attempt <= MAX_RETRIES + 1;
    attempt++
  ) {
    try {
      const result =
        await performGeminiRequest(
          endpoint,
          prompt
        );


      return result;

    } catch (error) {
      lastError =
        error;


      /*
       * Don't retry authentication,
       * quota, bad request or model errors.
       */

      const status =
        Number(
          error?.httpStatus
        ) || 0;

      const reason =
        error?.diagnostic?.reason;


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
        attempt >
          MAX_RETRIES
      ) {
        break;
      }


      await sleep(
        1000 * attempt
      );
    }
  }


  const error =
    lastError ||
    new Error(
      "Gemini request failed."
    );


  error.diagnostic = {
    ...(error.diagnostic || {}),

    batch:
      batchNumber,

    totalBatches
  };


  throw error;
}


/* =========================================================
   RAW GEMINI REQUEST
========================================================= */

async function performGeminiRequest(
  endpoint,
  prompt
) {
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
                  role:
                    "user",

                  parts: [
                    {
                      text:
                        prompt
                    }
                  ]
                }
              ],

              generationConfig: {
                temperature:
                  0.1,

                responseMimeType:
                  "application/json"
              }
            }),

          signal:
            controller.signal
        }
      );

  } catch (error) {
    clearTimeout(
      timer
    );


    if (
      error?.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          "Gemini request timed out after 30 seconds."
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
    clearTimeout(
      timer
    );
  }


  /*
   * -------------------------------------------------------
   * HTTP ERROR
   * -------------------------------------------------------
   */

  if (!response.ok) {
    let providerBody =
      "";

    try {
      providerBody =
        await response.text();
    } catch {
      providerBody =
        "";
    }


    /*
     * Don't expose enormous provider responses.
     */
    providerBody =
      String(
        providerBody || ""
      ).slice(
        0,
        2500
      );


    let providerMessage =
      "";


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


    if (
      status === 400
    ) {
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


    if (
      status === 404
    ) {
      reason =
        "GEMINI_MODEL_NOT_FOUND";

      friendly =
        `Gemini model/endpoint was not found (HTTP 404). Check GEMINI_MODEL.`;
    }


    if (
      status === 429
    ) {
      reason =
        "GEMINI_QUOTA";

      friendly =
        "Gemini quota/rate limit was reached (HTTP 429).";
    }


    if (
      status >= 500
    ) {
      reason =
        "GEMINI_SERVICE";

      friendly =
        `Gemini service returned HTTP ${status}.`;
    }


    /*
     * Put provider message in the error
     * so frontend can display EXACTLY what
     * Gemini returned.
     */

    if (
      providerMessage
    ) {
      friendly +=
        ` Provider: ${providerMessage}`;
    }


    const httpError =
      new Error(
        friendly
      );

    httpError.httpStatus =
      status;

    httpError.diagnostic = {
      stage:
        "gemini-provider",

      reason,

      httpStatus:
        status,

      providerMessage:
        providerMessage ||
        null
    };


    /*
     * Server console gets raw provider
     * response for debugging.
     *
     * API key is NOT included.
     */

    console.error(
      "[LD76][GEMINI] Provider response:",
      {
        status,

        body:
          providerBody
      }
    );


    throw httpError;
  }


  /*
   * -------------------------------------------------------
   * JSON RESPONSE
   * -------------------------------------------------------
   */

  let data;

  try {
    data =
      await response.json();

  } catch {
    const error =
      new Error(
        "Gemini returned a non-JSON response."
      );

    error.httpStatus =
      502;

    error.diagnostic = {
      stage:
        "gemini-provider",

      reason:
        "GEMINI_INVALID_RESPONSE"
    };

    throw error;
  }


  console.log(
    "[LD76][GEMINI] Response structure:",
    {
      candidateCount:
        Array.isArray(
          data?.candidates
        )
          ? data.candidates.length
          : 0,

      hasPromptFeedback:
        Boolean(
          data?.promptFeedback
        ),

      finishReason:
        data?.candidates?.[0]
          ?.finishReason ||
        null,

      hasUsageMetadata:
        Boolean(
          data?.usageMetadata
        )
    }
  );


  /*
   * Gemini may return prompt-level
   * blocking information.
   */

  if (
    data?.promptFeedback
      ?.blockReason
  ) {
    const error =
      new Error(
        `Gemini blocked the prompt: ${
          data.promptFeedback.blockReason
        }`
      );

    error.httpStatus =
      400;

    error.diagnostic = {
      stage:
        "gemini-safety",

      reason:
        "GEMINI_PROMPT_BLOCKED",

      providerMessage:
        data.promptFeedback.blockReason
    };

    throw error;
  }


  const text =
    extractGeminiText(
      data
    );


  if (!text) {
    const finishReason =
      data?.candidates?.[0]
        ?.finishReason ||
      "UNKNOWN";


    const error =
      new Error(
        `Gemini returned no analysis text. Finish reason: ${finishReason}.`
      );

    error.httpStatus =
      502;

    error.diagnostic = {
      stage:
        "gemini-response",

      reason:
        "GEMINI_EMPTY_RESPONSE",

      providerMessage:
        finishReason
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
    const jsonError =
      new Error(
        `Gemini returned invalid JSON: ${
          error?.message ||
          "JSON parse failed"
        }`
      );

    jsonError.httpStatus =
      502;

    jsonError.diagnostic = {
      stage:
        "gemini-response",

      reason:
        "GEMINI_MALFORMED_JSON"
    };

    throw jsonError;
  }


  const results =
    validateResults(
      parsed,
      candidates
    );


  if (
    !results.length
  ) {
    const error =
      new Error(
        "Gemini responded, but no valid 0-100 scam scores were found."
      );

    error.httpStatus =
      502;

    error.diagnostic = {
      stage:
        "gemini-validation",

      reason:
        "GEMINI_NO_VALID_SCORES",

      providerMessage:
        `Candidates submitted: ${candidates.length}`
    };

    throw error;
  }


  return results;
}


/* =========================================================
   PROMPT
========================================================= */

function buildPrompt(
  candidates
) {
  const evidence =
    candidates
      .map(
        (candidate, index) =>
          [
            `CANDIDATE ${index + 1}`,

            `Domain: ${
              candidate?.domain ||
              "Unknown"
            }`,

            `Website name: ${
              candidate?.websiteName ||
              "Unknown"
            }`,

            `Title: ${
              candidate?.title ||
              "Unknown"
            }`,

            `Status: ${
              candidate?.status ||
              "Unknown"
            }`,

            `HTTP status: ${
              candidate?.httpStatus ??
              "Unknown"
            }`,

            `HTTPS: ${
              candidate?.https === true
                ? "Yes"
                : candidate?.https === false
                  ? "No"
                  : "Unknown"
            }`,

            `Discovered at: ${
              candidate?.discoveredAt ||
              "Unknown"
            }`,

            `Registered at: ${
              candidate?.registeredAt ||
              "Not verified"
            }`,

            `Investment score: ${
              candidate?.investment?.score ??
              0
            }`,

            `Investment keywords: ${
              formatArray(
                candidate?.investment?.keywords
              )
            }`,

            `Daily return claims: ${
              formatArray(
                candidate?.investment?.dailyReturnClaims
              )
            }`,

            `ROI claims: ${
              formatArray(
                candidate?.investment?.roiClaims
              )
            }`,

            `Payment methods: ${
              formatArray(
                candidate?.paymentMethods?.detected
              )
            }`,

            `Company evidence: ${
              formatArray(
                candidate?.transparency?.company
              )
            }`,

            `Legal evidence: ${
              formatArray(
                candidate?.transparency?.legal
              )
            }`,

            `Support evidence: ${
              formatArray(
                candidate?.transparency?.support
              )
            }`,

            `Pages checked: ${
              formatArray(
                candidate?.pagesChecked
              )
            }`,

            `Relevant snippets:\n${
              formatSnippets(
                candidate?.snippets
              )
            }`,

            `Website evidence:\n${
              String(
                candidate?.content ||
                ""
              ).slice(
                0,
                MAX_EVIDENCE_CHARS
              )
            }`
          ].join("\n")
      )
      .join(
        "\n\n==============================\n\n"
      );


  return `
You are the AI analysis engine for LD76 Investment Radar.

Analyze newly discovered websites that appear related to investment, earning, deposits, returns, referrals, or similar financial opportunities.

IMPORTANT:

- Do not automatically call a website a scam because it is new.
- Do not invent facts.
- Use only supplied evidence.
- Unknown information is not proof of fraud.
- Missing transparency can be a risk indicator but is not automatically proof of fraud.
- Telegram, WhatsApp and Discord support are not automatically scam indicators.
- ROI/profit claims alone are not proof of fraud.
- Consider the total evidence.
- Use lower confidence when evidence is incomplete.

SCAM SCORE:

0-20 = Very Low Scam Indicators
21-40 = Low
41-60 = Moderate / Uncertain
61-80 = Suspicious
81-100 = Highly Suspicious

Return exactly one result for every supplied candidate.

scamScore MUST be a numeric value from 0 to 100.

Return ONLY JSON.

FORMAT:

{
  "results": [
    {
      "domain": "example.com",
      "websiteName": "Example",
      "scamScore": 75,
      "classification": "Suspicious",
      "confidence": "Medium",
      "summary": "Evidence-based explanation.",
      "redFlags": [],
      "positiveSignals": [],
      "missingInformation": [],
      "investmentClaims": [],
      "paymentMethods": []
    }
  ]
}

CANDIDATE EVIDENCE:

${evidence}
`;
}


/* =========================================================
   GEMINI TEXT
========================================================= */

function extractGeminiText(
  data
) {
  const candidates =
    data?.candidates;


  if (
    !Array.isArray(
      candidates
    ) ||
    !candidates.length
  ) {
    return "";
  }


  const parts =
    candidates[0]
      ?.content
      ?.parts;


  if (
    !Array.isArray(
      parts
    )
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
   JSON PARSER
========================================================= */

function parseGeminiJson(
  text
) {
  let cleaned =
    String(
      text || ""
    ).trim();


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


  try {
    return JSON.parse(
      cleaned
    );

  } catch {
    const start =
      cleaned.indexOf(
        "{"
      );

    const end =
      cleaned.lastIndexOf(
        "}"
      );


    if (
      start !== -1 &&
      end > start
    ) {
      return JSON.parse(
        cleaned.slice(
          start,
          end + 1
        )
      );
    }


    throw new Error(
      "No valid JSON object found."
    );
  }
}


/* =========================================================
   RESULT VALIDATION
========================================================= */

function validateResults(
  data,
  candidates
) {
  const rawResults =
    Array.isArray(
      data?.results
    )
      ? data.results
      : [];


  const candidateDomains =
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


  const resultsByDomain =
    new Map();


  for (
    const item
    of rawResults
  ) {
    const domain =
      normalizeDomain(
        item?.domain ||
        item?.website ||
        item?.url
      );


    if (
      !domain ||
      !candidateDomains.has(
        domain
      )
    ) {
      continue;
    }


    const score =
      Number(
        item?.scamScore ??
        item?.aiScore ??
        item?.score ??
        item?.geminiScamScore
      );


    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      continue;
    }


    resultsByDomain.set(
      domain,
      {
        domain,

        websiteName:
          item?.websiteName ||
          item?.title ||
          "",

        scamScore:
          Math.round(score),

        classification:
          item?.classification ||
          "",

        confidence:
          normalizeConfidence(
            item?.confidence
          ),

        summary:
          item?.summary ||
          item?.analysis ||
          item?.reasoning ||
          "",

        redFlags:
          normalizeStringArray(
            item?.redFlags
          ),

        positiveSignals:
          normalizeStringArray(
            item?.positiveSignals
          ),

        missingInformation:
          normalizeStringArray(
            item?.missingInformation
          ),

        investmentClaims:
          normalizeStringArray(
            item?.investmentClaims
          ),

        paymentMethods:
          normalizeStringArray(
            item?.paymentMethods
          ),

        recommendation:
          item?.recommendation ||
          ""
      }
    );
  }


  const ordered =
    [];

  for (
    const candidate
    of candidates
  ) {
    const domain =
      normalizeDomain(
        candidate?.domain
      );

    const result =
      resultsByDomain.get(
        domain
      );

    if (result) {
      ordered.push(
        result
      );
    }
  }


  return ordered;
}


/* =========================================================
   BATCHING
========================================================= */

function createBatches(
  items,
  size
) {
  const batches = [];

  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    batches.push(
      items.slice(
        i,
        i + size
      )
    );
  }

  return batches;
}


/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

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


  if (
    !domain ||
    domain.length > 253
  ) {
    return null;
  }


  return domain;
}


function normalizeConfidence(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "Unknown";
  }

  return String(
    value
  );
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
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return [];
  }

  return [
    String(value)
      .trim()
  ].filter(Boolean);
}


function formatArray(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return value
      ? String(value)
      : "None";
  }

  if (!value.length) {
    return "None";
  }

  return value
    .map(
      item =>
        String(item)
    )
    .join(", ");
}


function formatSnippets(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return value
      ? String(value).slice(
          0,
          5000
        )
      : "None";
  }

  if (!value.length) {
    return "None";
  }

  return value
    .map(
      item =>
        String(item)
    )
    .join("\n")
    .slice(
      0,
      5000
    );
}


function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}
