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
