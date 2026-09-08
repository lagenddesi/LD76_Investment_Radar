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

    return max(minimum, min(value, maximum))


def _fetch(url, timeout):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/5.0",
            "Accept": "text/plain,*/*",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def _domains(period, tld, limit, feed_timeout):
    period = _safe_int(period, 1, 1, 7)

    if period not in FEEDS:
        period = 1

    data = _fetch(FEEDS[period], feed_timeout)

    domains = []

    tld = str(tld or "all").strip().lower()

    suffix = None
    if tld != "all":
        suffix = "." + tld.lstrip(".")

    for line in data.splitlines():
        domain = line.strip().lower()

        if not domain or domain.startswith("#"):
            continue

        if "." not in domain:
            continue

        if suffix and not domain.endswith(suffix):
            continue

        domains.append(domain)

        if len(domains) >= limit:
            break

    return list(dict.fromkeys(domains))


def _scan_one(domain, settings):
    try:
        result = detect_investment(
            domain,
            settings=settings,
        )

        if isinstance(result, dict):
            result.setdefault("domain", domain)

        return result

    except TypeError:
        try:
            result = detect_investment(domain)

            if isinstance(result, dict):
                result.setdefault("domain", domain)

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
        "gambling_signals",
        "generic_signals",
        "url",
        "title",
    ):
        if key not in output and key in item:
            output[key] = item[key]

    output.setdefault("score", 0)
    output.setdefault("category", "Investment")
    output.setdefault("matched_categories", [])
    output.setdefault("evidence", [])
    output.setdefault("negative_signals", [])
    output.setdefault("gambling_signals", [])
    output.setdefault("generic_signals", [])

    if not output.get("url") and output["domain"]:
        output["url"] = "https://" + output["domain"]

    return output


def _as_list(value):
    if isinstance(value, list):
        return value

    if isinstance(value, tuple):
        return list(value)

    if isinstance(value, str) and value.strip():
        return [value.strip()]

    return []


def _diagnose(item):
    if not isinstance(item, dict):
        return {
            "financial": 0,
            "investment": 0,
            "trading": 0,
            "finance": 0,
            "brokerage": 0,
            "wealth": 0,
            "funds": 0,
            "crypto": 0,
            "gambling": 0,
            "score": 0,
            "evidence": [],
        }

    result = item.get("result")

    if not isinstance(result, dict):
        result = item

    categories = [
        str(x).lower()
        for x in _as_list(
            result.get("matched_categories")
        )
    ]

    evidence = _as_list(result.get("evidence"))
    gambling = _as_list(
        result.get("gambling_signals")
    )

    score = result.get("score", 0)

    try:
        score = float(score or 0)
    except Exception:
        score = 0

    return {
        "financial": int(bool(
            categories
            or evidence
            or result.get("category")
        )),
        "investment": int("investment" in categories),
        "trading": int("trading" in categories),
        "finance": int("finance" in categories),
        "brokerage": int("brokerage" in categories),
        "wealth": int("wealth" in categories),
        "funds": int("funds" in categories),
        "crypto": int("crypto" in categories),
        "gambling": len(gambling),
        "score": score,
        "evidence": evidence[:5],
    }


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

    if not isinstance(settings, dict):
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
                "diagnostics": {},
                "top_rejected": [],
            }

        results = []
        rejected_items = []

        checked = 0
        fetched = 0
        fetch_failed = 0
        rejected = 0
        errors = 0

        diag = {
            "financial_signal_domains": 0,
            "investment_domains": 0,
            "trading_domains": 0,
            "finance_domains": 0,
            "brokerage_domains": 0,
            "wealth_domains": 0,
            "fund_domains": 0,
            "crypto_domains": 0,
            "gambling_domains": 0,
        }

        active_workers = min(workers, total)

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

            for future in as_completed(futures):
                checked += 1

                domain = futures[future]

                try:
                    item = future.result()

                    if not isinstance(item, dict):
                        errors += 1
                        continue

                    status = item.get("status")

                    if status in ("matched", "rejected"):
                        fetched += 1

                        d = _diagnose(item)

                        if d["financial"]:
                            diag["financial_signal_domains"] += 1

                        if d["investment"]:
                            diag["investment_domains"] += 1

                        if d["trading"]:
                            diag["trading_domains"] += 1

                        if d["finance"]:
                            diag["finance_domains"] += 1

                        if d["brokerage"]:
                            diag["brokerage_domains"] += 1

                        if d["wealth"]:
                            diag["wealth_domains"] += 1

                        if d["funds"]:
                            diag["fund_domains"] += 1

                        if d["crypto"]:
                            diag["crypto_domains"] += 1

                        if d["gambling"]:
                            diag["gambling_domains"] += 1

                        if status == "matched":
                            result = _normalise_match(item)

                            if result:
                                results.append(result)

                        else:
                            rejected += 1

                            rejected_items.append({
                                "domain": domain,
                                "score": d["score"],
                                "evidence": d["evidence"],
                                "gambling_signals": d["gambling"],
                            })

                    elif status == "fetch_failed":
                        fetch_failed += 1

                    else:
                        errors += 1

                except Exception as exc:
                    errors += 1
                    rejected_items.append({
                        "domain": domain,
                        "score": 0,
                        "evidence": [],
                        "error": str(exc),
                    })

        results.sort(
            key=lambda item: float(
                item.get("score", 0) or 0
            ),
            reverse=True,
        )

        rejected_items.sort(
            key=lambda item: float(
                item.get("score", 0) or 0
            ),
            reverse=True,
        )

        top_rejected = rejected_items[:10]

        if results:
            message = (
                "Scan completed. "
                "Investment domains found."
            )

        elif fetch_failed == total:
            message = (
                "All domains failed website fetching."
            )

        elif fetched > 0:
            message = (
                "No matches. "
                f"Financial signals: "
                f"{diag['financial_signal_domains']}; "
                f"Investment: "
                f"{diag['investment_domains']}; "
                f"Trading: "
                f"{diag['trading_domains']}; "
                f"Finance: "
                f"{diag['finance_domains']}; "
                f"Gambling: "
                f"{diag['gambling_domains']}; "
                f"Top score: "
                f"{top_rejected[0]['score'] if top_rejected else 0}."
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
            "diagnostics": diag,
            "top_rejected": top_rejected,
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
            "diagnostics": {},
            "top_rejected": [],
        }
