from fastapi import FastAPI,Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from scanner import scan_domains,get_scan
from rdap import lookup_domain

app=FastAPI(title="LD76 Investment Radar")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])

class ScanRequest(BaseModel):
    period:int=1
    tld:str="all"

@app.get("/")
def home():
    return FileResponse("index.html",media_type="text/html")

@app.get("/health")
def health():
    return {"status":"ok","app":"LD76 Investment Radar"}

@app.post("/api/scan")
def start_scan(req:ScanRequest):
    period=max(1,min(req.period,7))
    tld=req.tld.lower().strip() or "all"
    return {"scan_id":scan_domains(period,tld),"status":"started"}

@app.get("/api/scan/{scan_id}/results")
def scan_results(scan_id:str):
    return get_scan(scan_id)

@app.get("/api/rdap")
def rdap(domain:str=Query(...,min_length=3)):
    return lookup_domain(domain.strip().lower())
