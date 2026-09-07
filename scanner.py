import uuid
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from detector import detect_investment


FEEDS = {
    1: "https://smet.cz/nrd/data/today.txt",
    3: "https://smet.cz/nrd/data/7d.txt",
    7: "https://smet.cz/nrd/data/7d.txt",
}


MAX_DOMAINS = 500
MAX_WORKERS = 40


def _fetch(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/2.0",
            "Accept": "text/plain,*/*",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=60,
    ) as response:
        return response.read().decode(
            "utf-8",
            "ignore",
        )


def _domains(period, tld):
    period = int(period)

    if period not in FEEDS:
        period = 1

    data = _fetch(
        FEEDS[period]
    )

    domains = []

    suffix = None

    if tld and tld != "all":
        suffix = (
            "."
            + str(tld)
            .lstrip(".")
            .lower()
        )

    for line in data.splitlines():
        domain = line.strip().lower()

        if not domain:
            continue

        if domain.startswith("#"):
            continue

        if "." not in domain:
            continue

        if suffix and not domain.endswith(
            suffix
        ):
            continue

        domains.append(domain)

        if len(domains) >= MAX_DOMAINS:
            break

    return list(
        dict.fromkeys(domains)
    )


def _scan_one(domain):
    try:
        result = detect_investment(
            domain
        )

        if result:
            return {
                "domain": domain,
                "status": "matched",
                "result": result,
            }

        return {
            "domain": domain,
            "status": "rejected",
            "result": None,
        }

    except Exception as exc:
        return {
            "domain": domain,
            "status": "error",
            "result": None,
            "error": str(exc),
        }


def scan_domains(
    period=1,
    tld="all",
):
    scan_id = uuid.uuid4().hex

    try:
        domains = _domains(
            period,
            tld,
        )

        total = len(domains)

        if total == 0:
            return {
                "scan_id": scan_id,
                "status": "completed",
                "message": (
                    "No newly registered "
                    "domains found."
                ),
                "total": 0,
                "checked": 0,
                "found": 0,
                "fetch_failed": 0,
                "rejected": 0,
                "errors": 0,
                "results": [],
            }

        results = []
        checked = 0
        fetch_failed = 0
        rejected = 0
        errors = 0

        workers = min(
            MAX_WORKERS,
            max(1, total),
        )

        with ThreadPoolExecutor(
            max_workers=workers
        ) as executor:

            futures = {
                executor.submit(
                    _scan_one,
                    domain,
                ): domain
                for domain in domains
            }

            for future in as_completed(
                futures
            ):
                checked += 1

                try:
                    item = future.result()

                    status = item.get(
                        "status"
                    )

                    if status == "matched":
                        result = item.get(
                            "result"
                        )

                        if result:
                            results.append(
                                result
                            )

                    elif status == "rejected":
                        rejected += 1

                    else:
                        errors += 1

                except Exception:
                    errors += 1

        results.sort(
            key=lambda item: item.get(
                "score",
                0,
            ),
            reverse=True,
        )

        return {
            "scan_id": scan_id,
            "status": "completed",
            "message": "Scan completed.",
            "total": total,
            "checked": checked,
            "found": len(results),
            "fetch_failed": fetch_failed,
            "rejected": rejected,
            "errors": errors,
            "results": results,
        }

    except Exception as exc:
        return {
            "scan_id": scan_id,
            "status": "error",
            "message": "Scanner failed.",
            "error": str(exc),
            "total": 0,
            "checked": 0,
            "found": 0,
            "fetch_failed": 0,
            "rejected": 0,
            "errors": 1,
            "results": [],
        }
