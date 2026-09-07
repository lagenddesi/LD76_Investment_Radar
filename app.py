from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from scanner import scan_domains
from rdap import lookup_domain


app = FastAPI(
    title="LD76 Investment Radar"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return FileResponse(
        "index.html",
        media_type="text/html"
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": "LD76 Investment Radar"
    }


@app.get("/api/health")
def api_health():
    return {
        "status": "ok",
        "app": "LD76 Investment Radar"
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

    tld = str(
        tld or "all"
    ).strip().lower()

    return scan_domains(
        period=period,
        tld=tld
    )


@app.get("/api/rdap")
def rdap(
    domain: str = Query(
        ...,
        min_length=3
    )
):
    return lookup_domain(
        domain.strip().lower()
    )
