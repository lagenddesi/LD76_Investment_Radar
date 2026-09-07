import threading
import uuid
import urllib.request

from detector import detect_investment


FEEDS = {
    1: "https://smet.cz/nrd/data/today.txt",
    3: "https://smet.cz/nrd/data/7d.txt",
    7: "https://smet.cz/nrd/data/7d.txt",
}

SCANS = {}


def _fetch(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/1.0",
            "Accept": "text/plain",
        },
    )

    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode("utf-8", "ignore")


def _domains(period):
    period = int(period)

    if period not in FEEDS:
        period = 1

    data = _fetch(FEEDS[period])

    domains = []

    for line in data.splitlines():
        domain = line.strip().lower()

        if not domain:
            continue

        if domain.startswith("#"):
            continue

        if "." not in domain:
            continue

        domains.append(domain)

    return list(dict.fromkeys(domains))


def _run(scan_id, period, tld):
    scan = SCANS[scan_id]

    try:
        scan.update(
            status="downloading",
            progress=0,
            message="Downloading newly registered domains..."
        )

        domains = _domains(period)

        if tld != "all":
            suffix = "." + tld.lstrip(".")

            domains = [
                domain
                for domain in domains
                if domain.endswith(suffix)
            ]

        total = len(domains)

        scan.update(
            total=total,
            status="scanning",
            progress=0,
            checked=0,
            found=0,
            message="Scanning domains..."
        )

        if total == 0:
            scan.update(
                progress=100,
                status="completed",
                done=True,
                checked=0,
                found=0,
                results=[],
                message="No domains found for this selection."
            )
            return

        for index, domain in enumerate(domains, start=1):

            try:
                result = detect_investment(domain)

                if result:
                    scan["results"].append(result)
                    scan["found"] = len(scan["results"])

            except Exception:
                pass

            progress = int((index / total) * 100)

            scan.update(
                checked=index,
                progress=progress,
                status="scanning",
                message=f"Scanning {index}/{total}"
            )

        scan.update(
            progress=100,
            status="completed",
            done=True,
            checked=total,
            found=len(scan["results"]),
            message="Scan completed."
        )

    except Exception as exc:

        scan.update(
            status="error",
            done=True,
            progress=100,
            message="Scanner failed.",
            error=str(exc)
        )


def scan_domains(period=1, tld="all"):
    try:
        period = int(period)
    except Exception:
        period = 1

    if period not in FEEDS:
        period = 1

    tld = str(tld or "all").strip().lower()

    scan_id = uuid.uuid4().hex

    SCANS[scan_id] = {
        "scan_id": scan_id,
        "status": "starting",
        "message": "Starting scan...",
        "progress": 0,
        "total": 0,
        "checked": 0,
        "found": 0,
        "results": [],
        "done": False,
    }

    thread = threading.Thread(
        target=_run,
        args=(scan_id, period, tld),
        daemon=True,
    )

    thread.start()

    return scan_id


def get_scan(scan_id):
    scan = SCANS.get(scan_id)

    if scan is None:
        return {
            "scan_id": scan_id,
            "status": "not_found",
            "message": "Scan not found.",
            "progress": 0,
            "total": 0,
            "checked": 0,
            "found": 0,
            "results": [],
            "done": True,
        }

    return scan
