import json,threading,uuid,urllib.request
from datetime import datetime,timezone
from detector import detect_investment

FEED="https://smet.cz/nrd/data/{}/{}.txt"
SCANS={}

def _fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":"LD76-Investment-Radar/1.0"})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read().decode("utf-8","ignore")

def _domains(period):
    days={1:"today",3:"7d",7:"7d"}[period]
    data=_fetch(FEED.format("nrd/data" if False else "nrd","today.txt" if days=="today" else "7d.txt"))
    return [x.strip().lower() for x in data.splitlines() if "." in x and not x.startswith("#")]

def _run(scan_id,period,tld):
    s=SCANS[scan_id]
    try:
        domains=_domains(period)
        if tld!="all":domains=[d for d in domains if d.endswith("."+tld)]
        s.update(total=len(domains),status="scanning")
        for i,domain in enumerate(domains):
            try:
                result=detect_investment(domain)
                if result:s["results"].append(result)
            except Exception:pass
            s["checked"]=i+1
        s.update(progress=100,status="completed",done=True,found=len(s["results"]))
    except Exception as e:
        s.update(status="error",error=str(e),done=True)

def scan_domains(period=1,tld="all"):
    scan_id=uuid.uuid4().hex
    SCANS[scan_id]={"scan_id":scan_id,"status":"starting","progress":0,
                    "total":0,"checked":0,"found":0,"results":[],"done":False}
    threading.Thread(target=_run,args=(scan_id,period,tld),daemon=True).start()
    return scan_id

def get_scan(scan_id):
    return SCANS.get(scan_id,{"status":"not_found","done":True,"results":[]})
