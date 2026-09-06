

# LD76 Investment Radar

LD76 Investment Radar is a mobile-first Progressive Web App (PWA) for researching newly discovered websites that may be related to investment, earning, deposits, returns, referrals, or similar financial opportunities.

The application is designed for research and detection purposes.

It does not determine with legal certainty whether a website is fraudulent.

---

## Main Features

- Discover recently discovered domains
- Select one or more TLDs
- Search within a 24-hour or 48-hour window
- Check whether discovered websites are active
- Detect investment and earning-related content
- Detect Pakistan payment methods
- Detect international/crypto payment methods
- Collect company, legal and support evidence
- Exclude domains already analyzed by Gemini
- Analyze multiple candidates with Gemini in batches
- Generate a GEMINI SCAM SCORE from 0 to 100
- Store scan history locally using IndexedDB
- PWA/mobile-first interface
- Gemini can be disabled during development
- No Firebase or Supabase database required
- API key remains server-side

---

# Architecture

```text
User
 │
 ▼
PWA Frontend
 │
 ├── TLD selection
 ├── 24H / 48H
 ├── Payment filters
 └── Scan controls
 │
 ▼
/api/discover
 │
 └── Recent domain discovery
 │
 ▼
/api/scan
 │
 ├── Website availability
 ├── HTTP/HTTPS
 ├── Website content
 ├── Investment filtering
 ├── Payment filtering
 └── Transparency/support evidence
 │
 ▼
Previously analyzed domains removed
 │
 ▼
/api/analyze
 │
 └── Gemini
       │
       ├── Evidence analysis
       ├── Scam indicators
       ├── Positive signals
       ├── Missing information
       └── GEMINI SCAM SCORE
 │
 ▼
IndexedDB
 │
 ▼
Results / History


---

Project Structure

LD76_Investment_Radar/
│
├── package.json
├── vercel.json
├── index.html
├── style.css
├── app.js
├── sw.js
├── manifest.json
├── README.md
│
└── api/
    ├── discover.js
    ├── scan.js
    └── analyze.js


---

Frontend

index.html

Contains the main application interface:

TLD selector

Search period

Payment method filters

Scan button

Progress display

Results section

History

Settings



---

style.css

Contains the mobile-first application styling.

The UI is designed to work on small Android screens, including approximately:

360 × 800
390 × 844
412 × 915
430 × 932


---

app.js

The frontend controller.

Responsibilities include:

Reading scan settings

Calling backend APIs

Showing scan progress

Saving results

Reading IndexedDB

Rendering results

Rendering history

Managing local settings

Registering the service worker



---

Backend

/api/discover

Discovers recently observed domains for the selected TLD.

Current discovery source:

Certificate Transparency / crt.sh

Important:

Certificate issuance/discovery time is NOT automatically treated as the domain's official registration date.

The application keeps:

registeredAt
discoveredAt

as separate values.

If an exact registration date cannot be verified, it should remain unknown rather than being fabricated.


---

/api/scan

Performs lightweight website scanning.

The scanner checks:

HTTPS

HTTP status

Website availability

Redirects

Website title

Basic description

Relevant website pages

Investment-related keywords

Return/ROI claims

Referral/affiliate indicators

Payment methods

Company information

Legal pages

Support information


Possible pages include:

/
 /about
 /about-us
 /contact
 /privacy
 /privacy-policy
 /terms
 /terms-and-conditions
 /refund
 /withdraw
 /withdrawal
 /deposit
 /investment
 /plans
 /support
 /faq

The scanner intentionally performs limited crawling.

It does not attempt:

Login bypass

Authentication bypass

Exploitation

Destructive actions

Credential attacks

Unauthorized access



---

Payment Detection

Pakistan payment methods

The scanner recognizes signals such as:

Bank Transfer
Bank Deposit
Bank Account
Account Number
Account Title
IBAN
PKR
Pakistani Rupees
Easypaisa
JazzCash

International / Crypto

Optional crypto detection includes:

USDT
TRC20
ERC20
BEP20
Bitcoin
Ethereum
Crypto
Crypto Wallet
PayPal

Payment method detection is only an evidence signal.

It is not proof of fraud.


---

Investment Detection

The scanner looks for terms and patterns related to:

Investment
Invest
Deposit
Profit
Return
ROI
Earning
Income
Passive Income
Withdrawal
Maturity
Investment Plan
Referral
Affiliate
Commission
Team Income
Bonus
Daily Profit
Daily Return
Daily Income
Guaranteed Return
Fixed Return

Numerical claims such as:

5% daily
10% daily
30% monthly

may also be extracted as evidence.


---

Internal Filtering

The scanner uses an internal relevance score to prioritize candidates.

Example signals:

Investment keyword     +10
Daily return           +15
ROI claim              +15
Deposit                +10
Withdrawal             +10
Referral/affiliate     +10

This internal score is NOT the final scam score.

It must never be presented to the user as the GEMINI SCAM SCORE.


---

Gemini Analysis

Gemini receives the final filtered candidates and the collected evidence.

The AI analyzes:

1. Company/business identity


2. Registration information


3. Legal information


4. Privacy and terms


5. Refund/withdrawal information


6. Company transparency


7. Support infrastructure


8. Payment methods


9. Investment claims


10. Referral/affiliate structure


11. Website/technical signals


12. Missing information


13. Positive signals


14. Suspicious indicators




---

GEMINI SCAM SCORE

Gemini returns a score from:

0 - 100

Classification:

0–20    Very Low Scam Indicators
21–40   Low
41–60   Moderate / Uncertain
61–80   Suspicious
81–100  Highly Suspicious

The score represents the strength of scam-related indicators in the supplied evidence.

It is not legal proof that a website is a scam.


---

Important AI Rules

Gemini must:

Use supplied evidence

Avoid inventing facts

Avoid assuming every investment website is a scam

Treat missing information as unknown

Distinguish weak signals from strong evidence

Lower confidence when evidence is insufficient

Avoid claiming a company is registered unless evidence supports it

Avoid claiming a website is fraudulent solely because it is new

Avoid treating Telegram or WhatsApp support as automatic proof of fraud

Avoid treating crypto payments as automatic proof of fraud

Avoid treating referral systems as automatic proof of fraud



---

Gemini Output

Expected structure:

{
  "results": [
    {
      "domain": "example.com",
      "websiteName": "Example",
      "scamScore": 75,
      "classification": "Suspicious",
      "confidence": "Medium",
      "summary": "Short evidence-based explanation.",
      "redFlags": [],
      "positiveSignals": [],
      "missingInformation": [],
      "investmentClaims": [],
      "paymentMethods": []
    }
  ]
}


---

Batch Processing

There is no arbitrary 4 or 5 site limit.

For example:

3 candidates
→ 1 Gemini request

10 candidates
→ 1 Gemini request

25 candidates
→ 1 Gemini request

If the evidence becomes too large for one safe request, the application splits the candidates into the smallest necessary number of batches.

The API response includes:

requestCount

so the application can show the actual number of Gemini requests used.


---

Previously Analyzed Domains

The frontend stores:

aiAnalyzed
aiScore
aiAnalysis

for analyzed domains.

During normal scanning:

aiAnalyzed = true

domains are excluded from another Gemini request.

This prevents unnecessary AI usage.

Re-analysis can be added later as an explicit user action.


---

IndexedDB

The application uses browser IndexedDB.

Database:

LD76InvestmentRadar

Stores:

domains
scans

Example domain record:

{
  "domain": "example.top",
  "firstSeen": "2026-01-01T00:00:00.000Z",
  "lastSeen": "2026-01-01T01:00:00.000Z",
  "registeredAt": null,
  "discoveredAt": "2026-01-01T01:00:00.000Z",
  "lastScanned": "2026-01-01T01:05:00.000Z",
  "keywordScore": 20,
  "paymentScore": 25,
  "aiAnalyzed": true,
  "aiScore": 75,
  "aiAnalysis": {},
  "websiteName": "Example",
  "status": "active"
}

No cloud database is required for V1.


---

Data Backup

Because IndexedDB is local browser storage, users should eventually be able to:

Export JSON
Import JSON

This protects scan history if browser data is cleared or the PWA is removed.


---

Environment Variables

Configure these variables in Vercel:

GEMINI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

During development:

GEMINI_ENABLED=false

This allows the scanner and frontend to be developed without making Gemini requests.

When Gemini is ready:

GEMINI_ENABLED=true

The API key must remain server-side.

Never put the Gemini API key inside:

index.html
app.js
style.css


---

Deployment

The intended deployment is:

GitHub
   ↓
Vercel
   ↓
LD76 Investment Radar

Basic deployment process:

1. Push the project to GitHub.


2. Open Vercel.


3. Import the GitHub repository.


4. Deploy the project.


5. Add the Gemini environment variables.


6. Redeploy after environment variable changes.


7. Open the deployed PWA on Android.




---

PWA

The project includes:

manifest.json
sw.js

The service worker caches the application shell.

API responses are intentionally not cached.

This means:

Frontend
→ can load from cache

Scanner
→ requires network

Gemini
→ requires network


---

Security

The project is intended for passive/lightweight research.

It should not:

Attempt unauthorized access

Bypass authentication

Exploit vulnerabilities

Perform destructive requests

Submit arbitrary forms to third-party websites

Collect passwords

Collect private credentials

Attempt account takeover

Circumvent access controls


The scanner should remain conservative and evidence-focused.


---

Limitations

The scanner cannot guarantee:

Exact domain registration date for every domain

True ownership of a company

Authenticity of claimed licenses

Whether a payment account belongs to a legitimate company

Whether an investment platform will actually pay

Whether a website is legally fraudulent

Whether a website will become fraudulent later


The GEMINI SCAM SCORE is an analytical indicator based on collected evidence.

It should not be treated as a legal or financial determination.


---

Troubleshooting

Gemini is not running

Check:

GEMINI_ENABLED=true

and verify:

GEMINI_API_KEY

is configured in Vercel.

Also check:

GEMINI_MODEL


---

Gemini quota error

The application should show:

AI analysis unavailable. Gemini quota or service limit was reached. Local scan results are still available.

Do not repeatedly retry failed requests.


---

Website cannot be scanned

Possible reasons:

DNS failure

Timeout

SSL problem

Website offline

Server blocking automated requests

Unsupported response type

Temporary server error


A failed HTTP request alone is not proof of a scam.


---

No candidates found

Possible reasons:

No recently discovered domains

Selected TLD had insufficient results

Websites were inactive

No investment-related evidence

Selected payment method was not detected

Domains were already analyzed



---

Development Order

Current implementation order:

1. package.json
2. vercel.json
3. index.html
4. style.css
5. app.js
6. sw.js
7. manifest.json
8. api/discover.js
9. api/scan.js
10. api/analyze.js
11. README.md

Next development stages should focus on:

Backend integration testing
↓
Environment configuration
↓
End-to-end scan testing
↓
IndexedDB/history verification
↓
Gemini testing
↓
Mobile UI polishing
↓
PWA installation testing
↓
Error handling improvements
↓
Export/import backup
↓
APK wrapper


---

Project Status

Current version:

V1 foundation

Core architecture:

PWA
+
Vercel Serverless API
+
IndexedDB
+
Certificate Transparency discovery
+
Website scanner
+
Gemini analysis

