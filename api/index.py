from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from scanner import scan_domains
from rdap import lookup_domain


app = FastAPI(title="LD76 Investment Radar")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
def api_home():
    return {
        "status": "ok",
        "app": "LD76 Investment Radar",
        "api": "online",
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": "LD76 Investment Radar",
    }


@app.post("/api/scan")
def start_scan(payload: dict):
    period = payload.get("period", 1)
    tld = payload.get("tld", "all")

    try:
        period = int(period)
    except Exception:
        period = 1

    period = max(1, min(period, 7))

    tld = str(tld or "all").strip().lower()

    result = scan_domains(
        period=period,
        tld=tld,
    )

    return {
        "status": "completed",
        "scan_id": result["scan_id"],
        "total": result["total"],
        "checked": result["checked"],
        "found": result["found"],
        "results": result["results"],
        "message": result["message"],
    }


@app.get("/api/rdap")
def rdap(
    domain: str = Query(..., min_length=3)
):
    return lookup_domain(
        domain.strip().lower()
    )
