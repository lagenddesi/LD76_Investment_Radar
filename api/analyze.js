const DEFAULT_MODEL = "gemini-2.5-flash";

const MAX_CANDIDATES_PER_REQUEST = 30;
const MAX_EVIDENCE_CHARS = 12000;
const GEMINI_TIMEOUT_MS = 30000;


export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  /*
   * Gemini is automatically enabled when
   * a valid API key is configured.
   *
   * GEMINI_ENABLED is still supported:
   * explicitly setting it to "false" disables AI.
   */

  const explicitlyDisabled =
    String(
      process.env.GEMINI_ENABLED || ""
    ).toLowerCase() === "false";

  const enabled =
    Boolean(apiKey) &&
    !explicitlyDisabled;


  /*
   * No API key.
   */

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      enabled: false,
      requestCount: 0,
      results: [],
      error:
        "Gemini API key is not configured in Vercel Environment Variables."
    });
  }


  /*
   * Explicitly disabled.
   */

  if (!enabled) {
    return res.status(200).json({
      ok: true,
      enabled: false,
      requestCount: 0,
      results: [],
      message:
        "Gemini analysis is disabled by GEMINI_ENABLED=false."
    });
  }


  try {
    const body =
      req.body || {};

    const candidates =
      Array.isArray(body.candidates)
        ? body.candidates
        : [];


    if (!candidates.length) {
      return res.status(200).json({
        ok: true,
        enabled: true,
        requestCount: 0,
        results: []
      });
    }


    /*
     * IMPORTANT:
     *
     * There is NO 4/5 candidate limit.
     *
     * Up to 30 candidates are sent per Gemini
     * request. More than 30 are split into the
     * smallest required number of batches.
     */

    const batches =
      createBatches(
        candidates,
        MAX_CANDIDATES_PER_REQUEST
      );


    const allResults = [];


    for (
      const batch
      of batches
    ) {
      const results =
        await analyzeBatch(
          batch,
          apiKey
        );

      allResults.push(
        ...results
      );
    }


    /*
     * Keep result order equal to
     * candidate order.
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


    return res.status(200).json({
      ok: true,
      enabled: true,

      requestCount:
        batches.length,

      submittedCount:
        candidates.length,

      resultCount:
        allResults.length,

      results:
        allResults
    });


  } catch (error) {
    console.error(
      "Gemini analysis error:",
      error
    );


    const status =
      getGeminiErrorStatus(
        error
      );


    return res.status(status).json({
      ok: false,
      enabled: true,
      requestCount: 0,

      error:
        getUserFriendlyGeminiError(
          error
        )
    });
  }
}


/* =========================================================
   GEMINI BATCH
========================================================= */

async function analyzeBatch(
  candidates,
  apiKey
) {
  const model =
    process.env.GEMINI_MODEL ||
    DEFAULT_MODEL;


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


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => controller.abort(),
      GEMINI_TIMEOUT_MS
    );


  let response;


  try {
    response =
      await fetch(
        endpoint,
        {
          method: "POST",

          signal:
            controller.signal,

          headers: {
            "Content-Type":
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
            })
        }
      );

  } catch (error) {
    clearTimeout(
      timeout
    );


    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "GEMINI_TIMEOUT"
      );
    }


    throw new Error(
      "GEMINI_NETWORK_ERROR"
    );
  }


  clearTimeout(
    timeout
  );


  if (!response.ok) {
    let errorBody = "";


    try {
      errorBody =
        await response.text();
    } catch {
      // Ignore.
    }


    console.error(
      "Gemini HTTP error:",
      response.status,
      errorBody.slice(
        0,
        3000
      )
    );


    if (
      response.status === 429
    ) {
      throw new Error(
        "GEMINI_QUOTA"
      );
    }


    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        "GEMINI_AUTH"
      );
    }


    if (
      response.status >= 500
    ) {
      throw new Error(
        "GEMINI_SERVICE"
      );
    }


    throw new Error(
      "GEMINI_REQUEST_ERROR"
    );
  }


  let data;


  try {
    data =
      await response.json();

  } catch {
    throw new Error(
      "GEMINI_INVALID_RESPONSE"
    );
  }


  /*
   * Log only structural information.
   * NEVER log API key.
   */

  console.log(
    "Gemini response received:",
    {
      model,
      candidateCount:
        Array.isArray(
          data?.candidates
        )
          ? data.candidates.length
          : 0,

      hasPromptFeedback:
        Boolean(
          data?.promptFeedback
        )
    }
  );


  const text =
    extractGeminiText(
      data
    );


  if (!text) {
    console.error(
      "Gemini returned no text:",
      JSON.stringify(
        data
      ).slice(
        0,
        5000
      )
    );

    throw new Error(
      "GEMINI_EMPTY_RESPONSE"
    );
  }


  const parsed =
    parseGeminiJson(
      text
    );


  return validateResults(
    parsed,
    candidates
  );
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
              candidate.domain ||
              "Unknown"
            }`,

            `Website name: ${
              candidate.websiteName ||
              "Unknown"
            }`,

            `Title: ${
              candidate.title ||
              "Unknown"
            }`,

            `Status: ${
              candidate.status ||
              "Unknown"
            }`,

            `HTTP status: ${
              candidate.httpStatus ??
              "Unknown"
            }`,

            `HTTPS: ${
              candidate.https === true
                ? "Yes"
                : candidate.https === false
                  ? "No"
                  : "Unknown"
            }`,

            `Discovered at: ${
              candidate.discoveredAt ||
              "Unknown"
            }`,

            `Registered at: ${
              candidate.registeredAt ||
              "Not verified"
            }`,

            `Local investment score: ${
              candidate.investment?.score ??
              0
            }`,

            `Investment keywords: ${
              formatArray(
                candidate.investment?.keywords
              )
            }`,

            `Daily return claims: ${
              formatArray(
                candidate.investment?.dailyReturnClaims
              )
            }`,

            `ROI claims: ${
              formatArray(
                candidate.investment?.roiClaims
              )
            }`,

            `Payment methods: ${
              formatArray(
                candidate.paymentMethods?.detected
              )
            }`,

            `Company/business evidence: ${
              formatArray(
                candidate.transparency?.company
              )
            }`,

            `Legal evidence: ${
              formatArray(
                candidate.transparency?.legal
              )
            }`,

            `Support evidence: ${
              formatArray(
                candidate.transparency?.support
              )
            }`,

            `Pages checked: ${
              formatArray(
                candidate.pagesChecked
              )
            }`,

            `Relevant snippets:\n${
              formatSnippets(
                candidate.snippets
              )
            }`,

            `Website evidence:\n${
              String(
                candidate.content ||
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

IMPORTANT RULES:

- Do NOT automatically classify a website as a scam merely because it is new.
- Do NOT assume every investment or HYIP-style website is fraudulent.
- Do NOT invent company registrations, licenses, people, addresses, payment methods, returns, or other facts.
- Use ONLY supplied evidence.
- Unknown or unverified information is not automatically proof of fraud.
- Missing transparency can be a risk indicator, but distinguish it from confirmed evidence.
- Telegram, WhatsApp, Discord, or social-media support is NOT automatically a scam indicator.
- ROI or profit claims alone are NOT proof of fraud.
- Consider the total evidence.
- If evidence is insufficient, use lower confidence.

SCORING:

0-20   = Very Low Scam Indicators
21-40  = Low
41-60  = Moderate / Uncertain
61-80  = Suspicious
81-100 = Highly Suspicious

The score represents scam-related indicators in the supplied evidence, NOT legal proof that a website is a scam.

Analyze:

1. Company/business registration
2. Privacy/legal information
3. About/company transparency
4. Support/contact
5. Payment methods
6. Investment/earning claims
7. Referral/affiliate structure
8. Website/technical evidence

For EVERY supplied candidate return:

- domain
- websiteName
- scamScore
- classification
- confidence
- summary
- redFlags
- positiveSignals
- missingInformation
- investmentClaims
- paymentMethods

Return ONLY valid JSON.

EXACT STRUCTURE:

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

CRITICAL:

- Return exactly one result for every supplied candidate.
- Do not omit candidates.
- Do not invent candidates.
- Keep each domain exactly matched to the supplied candidate.
- scamScore MUST be a number from 0 to 100.

CANDIDATE EVIDENCE:

${evidence}
`;
}


/* =========================================================
   GEMINI TEXT EXTRACTION
========================================================= */

function extractGeminiText(
  data
) {
  const candidates =
    data?.candidates;


  if (
    !Array.isArray(candidates) ||
    !candidates.length
  ) {
    return "";
  }


  const parts =
    candidates[0]
      ?.content
      ?.parts;


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
   JSON PARSER
========================================================= */

function parseGeminiJson(
  text
) {
  let cleaned =
    String(text || "")
      .trim();


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
      try {
        return JSON.parse(
          cleaned.slice(
            start,
            end + 1
          )
        );
      } catch {
        // Continue.
      }
    }


    throw new Error(
      "GEMINI_MALFORMED_JSON"
    );
  }
}


/* =========================================================
   VALIDATION
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


  const byDomain =
    new Map();


  for (
    const result
    of rawResults
  ) {
    const domain =
      normalizeDomain(
        result?.domain
      );


    if (!domain) {
      continue;
    }


    const normalized =
      normalizeResult(
        result
      );


    /*
     * Only store actual valid scores.
     */

    if (
      normalized.scamScore ===
      null
    ) {
      continue;
    }


    byDomain.set(
      domain,
      normalized
    );
  }


  /*
   * Return one result for every candidate.
   *
   * Missing Gemini result gets scamScore:null.
   * Frontend will NOT save it as aiAnalyzed.
   */

  return candidates.map(
    candidate => {
      const domain =
        normalizeDomain(
          candidate?.domain
        );


      const result =
        byDomain.get(
          domain
        );


      if (result) {
        return result;
      }


      return {
        domain,

        websiteName:
          candidate?.websiteName ||
          candidate?.title ||
          domain,

        scamScore: null,

        classification:
          "Analysis Unavailable",

        confidence:
          "Unknown",

        summary:
          "Gemini did not return a valid scored analysis for this candidate.",

        redFlags: [],

        positiveSignals: [],

        missingInformation: [
          "Valid Gemini score was not returned."
        ],

        investmentClaims: [],

        paymentMethods:
          candidate?.paymentMethods
            ?.detected || []
      };
    }
  );
}


/* =========================================================
   RESULT NORMALIZATION
========================================================= */

function normalizeResult(
  result
) {
  const score =
    normalizeScore(
      result?.scamScore
    );


  return {
    domain:
      normalizeDomain(
        result?.domain
      ),

    websiteName:
      cleanString(
        result?.websiteName
      ),

    scamScore:
      score,

    classification:
      score === null
        ? "Analysis Unavailable"
        : normalizeClassification(
            score
          ),

    confidence:
      normalizeConfidence(
        result?.confidence
      ),

    summary:
      cleanString(
        result?.summary
      ) ||
      "No summary was returned.",

    redFlags:
      normalizeArray(
        result?.redFlags
      ),

    positiveSignals:
      normalizeArray(
        result?.positiveSignals
      ),

    missingInformation:
      normalizeArray(
        result?.missingInformation
      ),

    investmentClaims:
      normalizeArray(
        result?.investmentClaims
      ),

    paymentMethods:
      normalizeArray(
        result?.paymentMethods
      )
  };
}


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


function normalizeClassification(
  score
) {
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


function normalizeConfidence(
  value
) {
  const text =
    cleanString(
      value
    ).toLowerCase();


  if (text === "high") {
    return "High";
  }

  if (text === "medium") {
    return "Medium";
  }

  if (text === "low") {
    return "Low";
  }

  return "Unknown";
}


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
    .filter(Boolean)
    .slice(
      0,
      30
    );
}


/* =========================================================
   BATCHING
========================================================= */

function createBatches(
  candidates,
  maxPerBatch
) {
  const batches = [];


  for (
    let i = 0;
    i < candidates.length;
    i += maxPerBatch
  ) {
    batches.push(
      candidates.slice(
        i,
        i + maxPerBatch
      )
    );
  }


  return batches;
}


/* =========================================================
   HELPERS
========================================================= */

function formatArray(
  value
) {
  if (
    !Array.isArray(value) ||
    !value.length
  ) {
    return "None detected";
  }


  return value
    .slice(
      0,
      30
    )
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
    !Array.isArray(value) ||
    !value.length
  ) {
    return "No relevant snippets available.";
  }


  return value
    .slice(
      0,
      25
    )
    .join(
      "\n---\n"
    )
    .slice(
      0,
      8000
    );
}


function normalizeDomain(
  value
) {
  let domain =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


  domain =
    domain
      .replace(
        /^https?:\/\//,
        ""
      )
      .split("/")[0]
      .split(":")[0]
      .replace(
        /^www\./,
        ""
      )
      .replace(
        /^\*\./,
        ""
      )
      .replace(
        /\.$/,
        ""
      );


  return domain;
}


function cleanString(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }


  return String(value)
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      2000
    );
}


/* =========================================================
   ERROR HANDLING
========================================================= */

function getGeminiErrorStatus(
  error
) {
  switch (
    error?.message
  ) {
    case "GEMINI_QUOTA":
      return 429;

    case "GEMINI_AUTH":
      return 503;

    case "GEMINI_TIMEOUT":
      return 504;

    case "GEMINI_NETWORK_ERROR":
      return 502;

    case "GEMINI_SERVICE":
      return 503;

    default:
      return 502;
  }
}


function getUserFriendlyGeminiError(
  error
) {
  switch (
    error?.message
  ) {
    case "GEMINI_QUOTA":
      return "Gemini quota or service limit was reached.";

    case "GEMINI_AUTH":
      return "Gemini API authentication failed. Check GEMINI_API_KEY.";

    case "GEMINI_TIMEOUT":
      return "Gemini request timed out.";

    case "GEMINI_NETWORK_ERROR":
      return "Gemini could not be reached.";

    case "GEMINI_MALFORMED_JSON":
      return "Gemini returned malformed JSON.";

    case "GEMINI_INVALID_RESPONSE":
      return "Gemini returned an invalid API response.";

    case "GEMINI_EMPTY_RESPONSE":
      return "Gemini returned an empty response.";

    case "GEMINI_SERVICE":
      return "Gemini service is temporarily unavailable.";

    default:
      return "Gemini could not complete the analysis.";
  }
}
