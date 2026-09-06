const DEFAULT_MODEL = "gemini-2.5-flash";

const MAX_CANDIDATES_PER_REQUEST = 30;
const MAX_EVIDENCE_CHARS = 12000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const enabled =
    String(
      process.env.GEMINI_ENABLED || "false"
    ).toLowerCase() === "true";

  /*
   * Gemini can be disabled during development.
   * The application must continue working.
   */
  if (!enabled) {
    return res.status(200).json({
      ok: true,
      enabled: false,
      requestCount: 0,
      results: [],
      message:
        "Gemini analysis is disabled."
    });
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      enabled: true,
      error:
        "Gemini API key is not configured."
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
     * No arbitrary 4/5-site limit.
     *
     * We normally send all candidates together.
     * If there are too many for one safe request,
     * the smallest necessary number of batches
     * is created.
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
     * Keep result order predictable.
     */
    const inputOrder =
      new Map(
        candidates.map(
          (candidate, index) => [
            candidate.domain,
            index
          ]
        )
      );

    allResults.sort(
      (a, b) =>
        (
          inputOrder.get(a.domain) ?? 999999
        ) -
        (
          inputOrder.get(b.domain) ?? 999999
        )
    );

    return res.status(200).json({
      ok: true,
      enabled: true,
      requestCount:
        batches.length,
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


/* ================================================== */
/* GEMINI BATCH                                       */
/* ================================================== */

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
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      30000
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
    clearTimeout(timeout);

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

  clearTimeout(timeout);

  if (!response.ok) {
    let errorBody = "";

    try {
      errorBody =
        await response.text();
    } catch (error) {
      // Ignore response parsing error.
    }

    console.error(
      "Gemini HTTP error:",
      response.status,
      errorBody.slice(0, 2000)
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
  } catch (error) {
    throw new Error(
      "GEMINI_INVALID_RESPONSE"
    );
  }

  const text =
    extractGeminiText(
      data
    );

  if (!text) {
    throw new Error(
      "GEMINI_EMPTY_RESPONSE"
    );
  }

  const parsed =
    parseGeminiJson(
      text
    );

  const validated =
    validateResults(
      parsed,
      candidates
    );

  return validated;
}


/* ================================================== */
/* PROMPT                                             */
/* ================================================== */

function buildPrompt(
  candidates
) {
  const evidence =
    candidates
      .map(
        (candidate, index) => {
          return [
            `CANDIDATE ${index + 1}`,

            `Domain: ${candidate.domain || "Unknown"}`,

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
                candidate.content || ""
              )
                .slice(
                  0,
                  MAX_EVIDENCE_CHARS
                )
            }`
          ].join("\n");
        }
      )
      .join(
        "\n\n==============================\n\n"
      );

  return `
You are the AI analysis engine for LD76 Investment Radar.

Your task is to analyze newly discovered websites that appear to be related to investment, earning, deposits, returns, referrals, or similar financial opportunities.

IMPORTANT:
- Do NOT automatically classify a website as a scam merely because it is new.
- Do NOT assume that every investment or HYIP-style website is fraudulent.
- Do NOT invent company registrations, licenses, people, addresses, payment methods, returns, or other facts.
- Use ONLY the supplied evidence.
- "Unknown", "not verified", or missing information is not automatically proof of fraud.
- Missing transparency can be a risk indicator, but distinguish it from confirmed evidence.
- Telegram, WhatsApp, Discord, or social-media support is NOT automatically a scam indicator.
- ROI or profit claims are NOT by themselves proof of a scam.
- Consider the total evidence and the strength of each signal.
- If evidence is insufficient, lower confidence and explain what remains unknown.

SCORING:
Return a GEMINI SCAM SCORE from 0 to 100.

0-20   = Very Low Scam Indicators
21-40  = Low
41-60  = Moderate / Uncertain
61-80  = Suspicious
81-100 = Highly Suspicious

The score represents the strength of scam-related indicators in the supplied evidence, NOT legal proof that the website is a scam.

Analyze these areas:

1. Company / business registration
- Company identity
- Registration number
- Registration authority
- Country
- Regulatory/license information
- Physical address
- Directors/team
- Whether the supplied information appears verifiable
- Never claim verification unless evidence supports it.

2. Privacy and legal information
- Privacy Policy
- Terms
- Refund policy
- Withdrawal information
- Risk disclosure
- Legal disclaimer
- Cookie policy
- Distinguish meaningful pages from placeholders.

3. About/company transparency
- Business identity
- History
- Management
- Team
- Address
- Business model
- Internal consistency

4. Support/contact
- Email
- Phone
- Physical address
- Contact page
- Live chat
- Ticket system
- FAQ
- Telegram
- WhatsApp
- Discord
- Social links
Do not automatically treat any individual support method as proof of fraud.

5. Payment methods
Pay special attention to:
- Bank transfer
- Bank deposit
- Bank account
- Easypaisa
- JazzCash
- PKR
- IBAN
- Account number
- Account title
- USDT
- TRC20
- ERC20
- BEP20
- Bitcoin
- Ethereum
- PayPal
Do not automatically classify a site as fraudulent because it uses crypto or Pakistani payment methods.

6. Investment and earning claims
Look for:
- Investment
- Deposit
- Profit
- Return
- ROI
- Daily profit
- Daily income
- Fixed return
- Guaranteed return
- Passive income
- Withdrawal
- Maturity
- Investment plans
- Numerical percentage claims

7. Referral / affiliate structure
Look for:
- Referral bonus
- Affiliate
- MLM-style structure
- Commissions
- Invite-and-earn
- Team income
- Level bonuses
Referral systems alone are not proof of fraud.

8. Website / technical evidence
Consider:
- HTTPS
- HTTP status
- Redirects
- Domain discovery information
- Missing pages
- Broken/placeholder content
- Suspiciously inconsistent information
- Website structure
Do not treat normal technical errors alone as proof of fraud.

For every candidate, return:
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

Use concise strings in arrays.

Return ONLY valid JSON in this exact structure:

{
  "results": [
    {
      "domain": "example.com",
      "websiteName": "Example",
      "scamScore": 75,
      "classification": "Suspicious",
      "confidence": "Medium",
      "summary": "Short evidence-based explanation.",
      "redFlags": [
        "Evidence-based red flag"
      ],
      "positiveSignals": [
        "Evidence-based positive signal"
      ],
      "missingInformation": [
        "Information that could not be verified"
      ],
      "investmentClaims": [
        "Claim found in supplied evidence"
      ],
      "paymentMethods": [
        "Bank",
        "Easypaisa"
      ]
    }
  ]
}

The number of results MUST match the candidates supplied.
Do not omit candidates.
Do not add domains that were not supplied.

CANDIDATE EVIDENCE:

${evidence}
`;
}


/* ================================================== */
/* RESPONSE PARSING                                   */
/* ================================================== */

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
    candidates[0]?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return "";
  }

  return parts
    .map(
      part =>
        typeof part.text === "string"
          ? part.text
          : ""
    )
    .join("")
    .trim();
}


function parseGeminiJson(
  text
) {
  let cleaned =
    String(text || "")
      .trim();

  /*
   * Gemini may occasionally wrap JSON
   * inside a markdown code fence.
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

  try {
    return JSON.parse(
      cleaned
    );
  } catch (error) {
    /*
     * Attempt to recover a JSON object
     * if extra text surrounds it.
     */
    const start =
      cleaned.indexOf("{");

    const end =
      cleaned.lastIndexOf("}");

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
      } catch (nestedError) {
        // Fall through.
      }
    }

    throw new Error(
      "GEMINI_MALFORMED_JSON"
    );
  }
}


/* ================================================== */
/* VALIDATION                                         */
/* ================================================== */

function validateResults(
  data,
  candidates
) {
  const rawResults =
    Array.isArray(data?.results)
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

    byDomain.set(
      domain,
      normalizeResult(
        result
      )
    );
  }

  /*
   * Every submitted candidate must receive
   * a result. If Gemini omitted one, create a
   * safe "insufficient response" result rather
   * than inventing a score.
   */
  return candidates.map(
    candidate => {
      const domain =
        normalizeDomain(
          candidate.domain
        );

      const result =
        byDomain.get(
          domain
        );

      if (result) {
        return result;
      }

      return {
        domain:
          candidate.domain,

        websiteName:
          candidate.websiteName ||
          candidate.title ||
          candidate.domain,

        scamScore: null,

        classification:
          "Analysis Unavailable",

        confidence:
          "Unknown",

        summary:
          "Gemini did not return a valid analysis for this candidate.",

        redFlags: [],

        positiveSignals: [],

        missingInformation: [
          "Valid Gemini analysis was not returned."
        ],

        investmentClaims: [],

        paymentMethods:
          candidate.paymentMethods
            ?.detected || []
      };
    }
  );
}


function normalizeResult(
  result
) {
  const score =
    normalizeScore(
      result.scamScore
    );

  return {
    domain:
      normalizeDomain(
        result.domain
      ),

    websiteName:
      cleanString(
        result.websiteName
      ),

    scamScore:
      score,

    classification:
      score === null
        ? "Analysis Unavailable"
        : normalizeClassification(
            score,
            result.classification
          ),

    confidence:
      normalizeConfidence(
        result.confidence
      ),

    summary:
      cleanString(
        result.summary
      ) ||
      "No summary was returned.",

    redFlags:
      normalizeArray(
        result.redFlags
      ),

    positiveSignals:
      normalizeArray(
        result.positiveSignals
      ),

    missingInformation:
      normalizeArray(
        result.missingInformation
      ),

    investmentClaims:
      normalizeArray(
        result.investmentClaims
      ),

    paymentMethods:
      normalizeArray(
        result.paymentMethods
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
  score,
  supplied
) {
  if (
    score <= 20
  ) {
    return "Very Low Scam Indicators";
  }

  if (
    score <= 40
  ) {
    return "Low";
  }

  if (
    score <= 60
  ) {
    return "Moderate / Uncertain";
  }

  if (
    score <= 80
  ) {
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

  if (
    text === "high"
  ) {
    return "High";
  }

  if (
    text === "medium"
  ) {
    return "Medium";
  }

  if (
    text === "low"
  ) {
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
    .slice(0, 30);
}


/* ================================================== */
/* BATCHING                                           */
/* ================================================== */

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


/* ================================================== */
/* HELPERS                                            */
/* ================================================== */

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
    .slice(0, 30)
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
    .slice(0, 25)
    .join("\n---\n")
    .slice(
      0,
      8000
    );
}


function normalizeDomain(
  value
) {
  let domain =
    String(value || "")
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
        /^\*\./,
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
    .slice(0, 2000);
}


/* ================================================== */
/* ERROR HANDLING                                     */
/* ================================================== */

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
      return "AI analysis unavailable. Gemini quota or service limit was reached. Local scan results are still available.";

    case "GEMINI_AUTH":
      return "AI analysis unavailable. Gemini API configuration or authentication failed.";

    case "GEMINI_TIMEOUT":
      return "AI analysis unavailable. Gemini request timed out. Local scan results are still available.";

    case "GEMINI_NETWORK_ERROR":
      return "AI analysis unavailable. Gemini could not be reached. Local scan results are still available.";

    case "GEMINI_MALFORMED_JSON":
    case "GEMINI_INVALID_RESPONSE":
    case "GEMINI_EMPTY_RESPONSE":
      return "AI analysis unavailable. Gemini returned an invalid response. Local scan results are still available.";

    case "GEMINI_SERVICE":
      return "AI analysis unavailable. Gemini service is temporarily unavailable. Local scan results are still available.";

    default:
      return "AI analysis unavailable. Gemini could not complete the analysis. Local scan results are still available.";
  }
}
