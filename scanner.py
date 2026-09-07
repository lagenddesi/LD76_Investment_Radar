import uuid
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from detector import detect_investment


FEEDS = {
    1: "https://smet.cz/nrd/data/today.txt",
    3: "https://smet.cz/nrd/data/7d.txt",
    7: "https://smet.cz/nrd/data/7d.txt",
}


MAX_DOMAINS = 5000
MAX_WORKERS = 40


def _fetch(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/3.0",
            "Accept": "text/plain,*/*",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=120,
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

        # Always preserve the original domain.
        # detector.py may keep domain at the
        # outer level while its detailed result
        # lives inside "result".
        if isinstance(result, dict):
            result.setdefault(
                "domain",
                domain,
            )

        return result

    except Exception as exc:
        return {
            "status": "error",
            "domain": domain,
            "result": None,
            "error": str(exc),
        }


def _normalise_match(item):
    """
    Convert detector output into the single
    flat result format expected by the frontend.

    Input:
        {
            "status": "matched",
            "domain": "example.com",
            "result": {
                "score": 51,
                "category": "Trading",
                ...
            }
        }

    Output:
        {
            "domain": "example.com",
            "score": 51,
            "category": "Trading",
            ...
        }
    """

    if not isinstance(item, dict):
        return None

    domain = (
        item.get("domain")
        or ""
    ).strip().lower()

    result = item.get(
        "result"
    )

    if not isinstance(result, dict):
        result = {}

    # Start with the detailed detector result.
    output = dict(result)

    # Domain MUST always come from the scanner's
    # original domain when available.
    output["domain"] = (
        domain
        or output.get("domain")
        or ""
    )

    # Preserve useful fields even if detector
    # puts them outside the nested result.
    for key in (
        "score",
        "category",
        "matched_categories",
        "evidence",
        "negative_signals",
        "url",
        "title",
    ):
        if (
            key not in output
            and key in item
        ):
            output[key] = item[key]

    # Make sure these fields always exist.
    output.setdefault(
        "score",
        0,
    )

    output.setdefault(
        "category",
        "Investment",
    )

    output.setdefault(
        "matched_categories",
        [],
    )

    output.setdefault(
        "evidence",
        [],
    )

    output.setdefault(
        "negative_signals",
        [],
    )

    # If detector didn't provide URL,
    # generate a usable HTTPS URL.
    if not output.get("url") and output["domain"]:
        output["url"] = (
            "https://"
            + output["domain"]
        )

    return output


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
                "fetched": 0,
                "fetch_failed": 0,
                "rejected": 0,
                "errors": 0,
                "found": 0,
                "results": [],
            }

        results = []

        checked = 0
        fetched = 0
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

                    if not isinstance(
                        item,
                        dict,
                    ):
                        errors += 1
                        continue

                    status = item.get(
                        "status"
                    )

                    if status == "matched":
                        fetched += 1

                        result = _normalise_match(
                            item
                        )

                        if result:
                            results.append(
                                result
                            )

                    elif status == "rejected":
                        fetched += 1
                        rejected += 1

                    elif status == "fetch_failed":
                        fetch_failed += 1

                    else:
                        errors += 1

                except Exception:
                    errors += 1

        results.sort(
            key=lambda item: float(
                item.get(
                    "score",
                    0,
                ) or 0
            ),
            reverse=True,
        )

        if results:
            message = (
                "Scan completed. "
                "Investment domains found."
            )

        elif fetch_failed == total:
            message = (
                "All domains failed "
                "website fetching."
            )

        elif fetched > 0:
            message = (
                "Websites were fetched, "
                "but no investment matches "
                "passed the detection threshold."
            )

        else:
            message = (
                "Scan completed."
            )

        return {
            "scan_id": scan_id,
            "status": "completed",
            "message": message,
            "total": total,
            "checked": checked,
            "fetched": fetched,
            "fetch_failed": fetch_failed,
            "rejected": rejected,
            "errors": errors,
            "found": len(results),
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
            "fetched": 0,
            "fetch_failed": 0,
            "rejected": 0,
            "errors": 1,
            "found": 0,
            "results": [],
        }
