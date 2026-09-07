# LD76 Investment Radar

Mobile-first investment-domain discovery system.

## Files

main.py          FastAPI API
scanner.py       New-domain feed scanner
detector.py      Investment-site detection/scoring
rdap.py          RDAP registration/domain data
requirements.txt Python dependencies
ui.html          Mobile-first UI
README.md        Project documentation

## Flow

ui.html
  -> POST /api/scan
  -> main.py
  -> scanner.py
  -> New Registered Domain Feed
  -> detector.py
  -> Website/content verification
  -> Investment score
  -> Results
  -> RDAP on demand

## Detection

The detector is designed to find websites that show actual investment
activity rather than simply containing generic finance words.

Signals include:

- investment plans
- investment amounts
- expected returns
- ROI/profit
- deposits
- withdrawals
- investment dashboards
- payment methods
- referral/affiliate systems
- account/login/signup flows

Domain-selling, parked and marketplace pages are explicitly rejected.

## Registration Date

Feed discovery date and domain registration date are different.

The feed identifies newly discovered domains.

RDAP is used separately to retrieve the actual domain registration event
when available.

The RDAP registration date must not be replaced by the feed date.

## Scan Periods

1 day
3 days
7 days

TLD filtering:

all
.com
.net
.org
.info
and other TLDs when supported by the source.

## API

GET /

GET /health

POST /api/scan

GET /api/scan/{scan_id}/results

GET /api/rdap?domain=example.com

## Scan Request

{
  "period": 1,
  "tld": "all"
}

## Scan Response

{
  "scan_id": "generated-id",
  "status": "started"
}

## Result

A matching domain can contain:

domain
site_name
url
score
confidence
category
registration_date
registrar
expiry
status
nameservers
evidence

## Deployment

The backend requires a Python environment with the packages in
requirements.txt.

Local:

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

The frontend uses relative API paths and is intended to communicate
with the backend from the same deployment/origin.

## Current Status

Frontend: ready
API structure: ready
Scanner: integrated structure
Investment detector: integrated structure
RDAP: integrated
Persistence: not implemented
Database: not implemented
Native Android APK: not implemented

The final production stage requires integration testing of the complete
scanner -> detector -> RDAP -> API -> UI pipeline.
