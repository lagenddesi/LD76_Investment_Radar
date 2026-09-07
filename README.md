# LD76 Investment Radar

LD76 Investment Radar is a mobile-first investment domain discovery and detection application.

The current repository contains a FastAPI backend and a standalone mobile-friendly HTML interface. The system discovers domains from the configured SMET Newly Registered Domains feed, checks websites for investment-related signals, scores matching domains, categorizes detected investment platforms, and provides RDAP domain information.

## Current Architecture

The project currently consists of:

- FastAPI backend
- Python domain scanner
- Website investment detector
- IANA RDAP lookup module
- Mobile-first HTML/CSS/JavaScript UI

The current repository does not contain Android Studio, Gradle, Kotlin, or Java Android project files.

The `ui.html` file is the current frontend interface and can be used as the web UI layer for a future Android WebView/APK wrapper.

## Project Structure

LD76_Investment_Radar/
├── main.py
├── scanner.py
├── detector.py
├── rdap.py
├── requirements.txt
├── ui.html
└── README.md

## Backend

The backend is built with FastAPI.

Main API application:

    main.py

The backend exposes:

    GET  /
    GET  /health
    POST /api/scan
    GET  /api/scan/{scan_id}/results
    GET  /api/rdap

## Frontend

The current frontend is:

    ui.html

It is a standalone mobile-first interface with:

- Home screen
- Scan screen
- Results screen
- Domain details screen
- Settings screen
- Scan period selection
- TLD selection
- Scan progress
- Result scoring
- Investment category display
- Evidence display
- Domain information display
- RDAP lookup
- Website opening
- Dark/light theme handling
- Bottom navigation

The UI communicates with the backend through relative API paths such as:

    /api/scan
    /api/scan/{scan_id}/results
    /api/rdap

## Scanner

The domain scanning logic is implemented in:

    scanner.py

The scanner:

1. Fetches the configured SMET domain feed.
2. Extracts domain names from the feed.
3. Applies the selected TLD filter.
4. Checks domains using the investment detector.
5. Stores matching results in the active scan.
6. Reports scan progress.
7. Makes results available through the scan-results API.

Supported scan periods in the API are:

- 1 day
- 3 days
- 7 days

The current scanner uses an in-memory `SCANS` dictionary and a background Python thread.

Scan data is therefore temporary and is lost when the backend process restarts.

## Investment Detector

The detection engine is implemented in:

    detector.py

The detector fetches a domain website and analyzes its page content.

It looks for investment-related signals including:

- Investment plan
- Investment package
- Minimum investment
- Investment amount
- Investment period
- Expected return
- ROI
- Profit percentage
- Profit rate
- Daily profit
- Weekly profit
- Monthly profit
- Fixed return
- Guaranteed return
- Passive income
- Capital investment
- Investment opportunity
- Invest now
- Start investing
- Choose plan
- Make deposit
- Deposit funds
- Fund account
- Referral commission
- Referral bonus
- Referral income
- Investment dashboard
- Earning dashboard
- My investments
- Active investment
- Investment history
- Minimum deposit
- Minimum withdrawal
- Withdraw profit

Payment-related signals include:

- USDT
- BTC
- ETH
- TRX
- Bank transfer
- Wallet
- Deposit
- Withdraw

Account and referral signals include:

- Signup
- Sign up
- Register
- Login
- Referral
- Referral code
- Invite link

## False Positive Filtering

The detector rejects pages containing obvious non-investment indicators such as:

- Domain for sale
- Buy this domain
- This domain is available
- Premium domain
- Domain auction
- Domain marketplace
- Domain broker
- Parked domain
- Coming soon
- Under construction
- Default hosting page
- No website

The detector also requires a combination of strong investment signals and investment-related actions/money signals before returning a domain as a match.

## Scoring

Detected investment signals have different weights.

The final score is capped at 100.

Confidence is currently determined as:

- High: score >= 45
- Medium: score < 45

Only domains reaching the detector's minimum score threshold are returned.

## Investment Categories

The detector can classify matching domains into:

- General Investment
- Crypto Investment
- Forex Investment
- Real Estate Investment
- Trading Investment
- Mining Investment
- DeFi Investment
- Lending Investment

## RDAP

RDAP functionality is implemented in:

    rdap.py

The RDAP module uses the IANA RDAP bootstrap service to find the appropriate RDAP server for the domain TLD.

The domain RDAP record can provide:

- Domain name
- Actual registration date
- Expiration date
- Last changed date
- Domain status
- Registrar
- Nameservers
- RDAP server

The registration date is obtained from the RDAP `registration` event.

The SMET feed date must not be treated as the domain's registration date.

## Scan Flow

    ui.html
       |
       | POST /api/scan
       v
    main.py
       |
       v
    scanner.py
       |
       v
    SMET Domain Feed
       |
       v
    Domain List
       |
       v
    detector.py
       |
       +--> Website Fetch
       |
       +--> HTML/Text Extraction
       |
       +--> Investment Signal Detection
       |
       +--> Score Calculation
       |
       +--> Category Detection
       |
       v
    Scan Results
       |
       v
    ui.html

## RDAP Flow

    ui.html
       |
       | GET /api/rdap
       v
    main.py
       |
       v
    rdap.py
       |
       v
    IANA RDAP Bootstrap
       |
       v
    TLD RDAP Server
       |
       v
    Domain RDAP Record
       |
       v
    Domain Information

## Dependencies

Python dependencies are defined in:

    requirements.txt

Current dependencies:

    fastapi
    uvicorn[standard]
    pydantic

The scanning and RDAP modules otherwise use Python standard-library modules.

## Running the Backend

Install the Python dependencies:

    pip install -r requirements.txt

Start the FastAPI server:

    uvicorn main:app --host 0.0.0.0 --port 8000

The backend will then expose the API endpoints.

## API Examples

### Application Status

    GET /

Response:

    {
      "app": "LD76 Investment Radar",
      "status": "online"
    }

### Health Check

    GET /health

Response:

    {
      "status": "ok"
    }

### Start Scan

    POST /api/scan

Request:

    {
      "period": 1,
      "tld": "all"
    }

Response:

    {
      "scan_id": "generated-scan-id",
      "status": "started"
    }

### Scan Results

    GET /api/scan/{scan_id}/results

This endpoint returns the current scan state, progress, checked domains, found domains, and detected results.

### RDAP

    GET /api/rdap?domain=example.com

This endpoint returns RDAP information for the requested domain.

## Important Current Limitations

The current implementation is an early integrated version.

Known limitations include:

- Scan state is stored only in memory.
- Scan results disappear when the backend restarts.
- Scans run using Python background threads.
- There is currently no database.
- There is currently no persistent task queue.
- There is currently no authentication system.
- There is currently no Android native project in the repository.
- `ui.html` currently expects the backend API to be available under the same origin.
- RDAP data is retrieved separately from the investment detection result.

## Android / APK Status

The repository currently contains the mobile UI but not the native Android wrapper.

Current status:

    Backend: FastAPI
    Scanner: Python
    Detector: Python
    RDAP: Python
    UI: HTML/CSS/JavaScript
    Native Android APK project: Not yet present

The intended APK can later wrap the existing `ui.html` frontend inside an Android WebView or another Android frontend layer.

The backend can remain a separate service that the APK communicates with through the API.

## Development Status

Current repository modules:

- `main.py` — FastAPI application and API routes
- `scanner.py` — domain feed scanning and scan state
- `detector.py` — website investment detection and scoring
- `rdap.py` — RDAP server discovery and domain information
- `ui.html` — mobile-first application interface
- `requirements.txt` — Python dependencies
- `README.md` — project documentation

The next development stage is full integration testing of the backend, scanner, detector, RDAP system, and UI, followed by fixing any integration issues before production/APK packaging.
