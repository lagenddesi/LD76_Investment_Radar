# LD76 Investment Radar

LD76 Investment Radar is a FastAPI-based domain discovery and investment-site detection system.

It scans domain feeds, checks websites for investment-related signals, scores matching domains, categorizes investment websites, and provides RDAP domain information.

## Features

- Domain scanning from the configured SMET/Nordic domain feed
- TLD filtering
- Investment-site detection
- Investment keyword and payment-method analysis
- Investment confidence scoring
- Automatic investment category detection
- RDAP domain information lookup
- Registration date from RDAP
- Domain expiry information
- Registrar information
- Domain status
- Nameserver information
- REST API endpoints
- Background scanning using Python threads

## Project Structure

LD76_Investment_Radar/
├── main.py
├── scanner.py
├── detector.py
├── rdap.py
├── requirements.txt
└── README.md

## Requirements

- Python 3.10+
- Internet connection

Install dependencies:

    pip install -r requirements.txt

## Run the API

Start the FastAPI server with:

    uvicorn main:app --host 0.0.0.0 --port 8000

The API will be available at:

    http://127.0.0.1:8000

## API Endpoints

### Home

GET /

Returns the application status.

Example response:

    {
      "app": "LD76 Investment Radar",
      "status": "online"
    }

### Health Check

GET /health

Returns:

    {
      "status": "ok"
    }

### Start Domain Scan

POST /api/scan

Request body:

    {
      "period": 1,
      "tld": "all"
    }

Supported periods:

- 1 — today
- 3 — 7-day feed
- 7 — 7-day feed

Example response:

    {
      "scan_id": "scan-id",
      "status": "started"
    }

### Get Scan Results

GET /api/scan/{scan_id}/results

Returns the current scan status and discovered investment domains.

### RDAP Lookup

GET /api/rdap?domain=example.com

Returns domain information obtained through RDAP.

The response can contain:

- domain
- registration_date
- expiry
- last_changed
- status
- registrar
- nameservers
- rdap_server
- source

## Investment Detection

The detector analyzes website content for investment-related signals such as:

- Investment plans
- Minimum investment
- Expected return
- ROI
- Profit percentage
- Daily, weekly, or monthly profit
- Guaranteed return
- Passive income
- Investment dashboard
- Deposits and withdrawals
- Referral commissions
- Crypto payment methods
- Investment account actions

Domains are scored based on detected signals.

The detector also rejects obvious non-investment pages such as:

- Domain for sale pages
- Domain marketplaces
- Parked domains
- Coming soon pages
- Default hosting pages
- Pages indicating that no website exists

## Investment Categories

The detector can classify matching websites into:

- General Investment
- Crypto Investment
- Forex Investment
- Real Estate Investment
- Trading Investment
- Mining Investment
- DeFi Investment
- Lending Investment

## RDAP

RDAP information is obtained separately from the domain discovery feed.

The registration date shown by the application is the actual RDAP registration event when provided by the RDAP server.

The SMET/Nordic feed date is not used as the domain registration date.

The RDAP module uses the IANA RDAP bootstrap service to identify the appropriate RDAP server for a domain's TLD.

## Scan Flow

Domain Feed
    ↓
scanner.py
    ↓
Domain List
    ↓
detector.py
    ↓
Website Fetch
    ↓
Investment Signal Detection
    ↓
Score Calculation
    ↓
Category Detection
    ↓
Investment Domains
    ↓
Scan Results API

## RDAP Flow

Domain
    ↓
IANA RDAP Bootstrap
    ↓
TLD RDAP Server
    ↓
Domain RDAP Record
    ↓
Registration / Expiry / Status /
Registrar / Nameservers

## Important Notes

The scanner currently keeps scan state in application memory.

This means scan data is lost when the server restarts.

The current implementation uses a background Python thread for each scan.

The project currently does not use a database or persistent job queue.

## Development Status

Current core modules:

- main.py — API layer
- scanner.py — domain feed and scan management
- detector.py — investment website detection
- rdap.py — RDAP domain information
- requirements.txt — Python dependencies
- README.md — project documentation

Further integration and testing should be performed before production deployment.
