import uuid
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from detector import detect_investment


FEEDS = {
    1: "https://smet.cz/nrd/data/today.txt",
    3: "https://smet.cz/nrd/data/7d.txt",
    7: "https://smet.cz/nrd/data/7d.txt",
}

DEFAULT_LIMIT = 500
DEFAULT_WORKERS = 40
DEFAULT_FEED_TIMEOUT = 120

MIN_LIMIT = 10
MAX_LIMIT = 5000

MIN_WORKERS = 1
MAX_WORKERS = 60

MIN_TIMEOUT = 10
MAX_TIMEOUT = 180


def _safe_int(value, default, minimum, maximum):
    try:
        value = int(value)
    except Exception:
        value = default

    return max(
        minimum,
        min(value, maximum),
    )


def _fetch(url, timeout):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/4.0",
            "Accept": "text/plain,*/*",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=timeout,
    ) as response:
        return response.read().decode(
            "utf-8",
            "ignore",
        )


def _domains(period, tld, limit, feed_timeout):
    period = _safe_int(
        period,
        1,
        1,
        7,
    )

    if period not in FEEDS:
        period = 1

    data = _fetch(
        FEEDS[period],
        feed_timeout,
    )

    domains = []

    suffix = None

    tld = str(
        tld or "all"
    ).strip().lower()

    if tld != "all":
        suffix = (
            "."
            + tld.lstrip(".")
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

        if len(domains) >= limit:
            break

    return list(
        dict.fromkeys(domains)
    )


def _scan_one(domain, settings):
    try:
        result = detect_investment(
            domain,
            settings=settings,
        )

        if isinstance(result, dict):
            result.setdefault(
                "domain",
                domain,
            )

        return result

    except TypeError:
        # Backward compatibility if detector
        # has not yet been upgraded.
        try:
            result = detect_investment(
                domain
            )

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

    except Exception as exc:
        return {
            "status": "error",
            "domain": domain,
            "result": None,
            "error": str(exc),
        }


def _normalise_match(item):
    if not isinstance(item, dict):
        return None

    domain = str(
        item.get("domain") or ""
    ).strip().lower()

    result = item.get("result")

    if not isinstance(result, dict):
        result = {}

    output = dict(result)

    output["domain"] = (
        domain
        or output.get("domain")
        or ""
    )

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

    if (
        not output.get("url")
        and output["domain"]
    ):
        output["url"] = (
            "https://"
            + output["domain"]
        )

    return output


def scan_domains(
    period=1,
    tld="all",
    limit=DEFAULT_LIMIT,
    workers=DEFAULT_WORKERS,
    feed_timeout=DEFAULT_FEED_TIMEOUT,
    settings=None,
):
    scan_id = uuid.uuid4().hex

    limit = _safe_int(
        limit,
        DEFAULT_LIMIT,
        MIN_LIMIT,
        MAX_LIMIT,
    )

    workers = _safe_int(
        workers,
        DEFAULT_WORKERS,
        MIN_WORKERS,
        MAX_WORKERS,
    )

    feed_timeout = _safe_int(
        feed_timeout,
        DEFAULT_FEED_TIMEOUT,
        MIN_TIMEOUT,
        MAX_TIMEOUT,
    )

    if not isinstance(
        settings,
        dict,
    ):
        settings = {}

    settings = dict(settings)

    settings["workers"] = workers
    settings["feed_timeout"] = feed_timeout

    try:
        domains = _domains(
            period,
            tld,
            limit,
            feed_timeout,
        )

        total = len(domains)

        if total == 0:
            return {
                "scan_id": scan_id,
                "status": "completed",
                "message": "No newly registered domains found.",
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

        active_workers = min(
            workers,
            total,
        )

        with ThreadPoolExecutor(
            max_workers=active_workers
        ) as executor:

            futures = {
                executor.submit(
                    _scan_one,
                    domain,
                    settings,
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
            message = "Scan completed."

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
            "settings": {
                "limit": limit,
                "workers": workers,
                "feed_timeout": feed_timeout,
                "period": period,
                "tld": tld,
            },
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
