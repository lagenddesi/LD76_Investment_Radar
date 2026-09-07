import json,re,urllib.request

BOOT="https://data.iana.org/rdap/dns.json"

def _get(url):
    req=urllib.request.Request(url,headers={
        "User-Agent":"LD76-Investment-Radar/1.0",
        "Accept":"application/rdap+json,application/json"})
    with urllib.request.urlopen(req,timeout=15) as r:
        return json.loads(r.read().decode("utf-8","ignore"))

def _server(domain):
    try:
        data=_get(BOOT)
        tld=domain.lower().rstrip(".").split(".")[-1]
        for item in data.get("services",[]):
            if tld in item[0]:
                return item[1][0].rstrip("/")
    except Exception:
        pass
    return None

def _date(events,kind):
    for e in events or []:
        if e.get("eventAction")==kind:
            return e.get("eventDate")
    return None

def _status(value):
    return ", ".join(value) if isinstance(value,list) else value or "Unavailable"

def _registrar(entities):
    for e in entities or []:
        if "registrar" not in e.get("roles",[]):continue
        v=e.get("vcardArray",[[],[]])
        for x in v[1] if len(v)>1 else []:
            if x[0]=="fn" and len(x)>3:return x[3]
    return "Unavailable"

def lookup_domain(domain):
    d=domain.lower().strip().rstrip(".")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?",d):
        return {"domain":d,"error":"Invalid domain"}

    base=_server(d)
    if not base:return {"domain":d,"error":"RDAP server not found"}

    try:
        data=_get(base+"/domain/"+d)
        return {
            "domain":d,
            "registration_date":_date(data.get("events"),"registration"),
            "expiry":_date(data.get("events"),"expiration"),
            "last_changed":_date(data.get("events"),"last changed"),
            "status":_status(data.get("status")),
            "registrar":_registrar(data.get("entities")),
            "nameservers":[
                x.get("ldhName") for x in data.get("nameservers",[])
                if x.get("ldhName")
            ],
            "rdap_server":base,
            "source":"IANA RDAP bootstrap"
        }
    except Exception as e:
        return {"domain":d,"error":str(e),"rdap_server":base}
