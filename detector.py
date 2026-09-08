import re
import requests
from bs4 import BeautifulSoup


DEFAULT_TIMEOUT = 8
DEFAULT_MAX_BYTES = 800 * 1024
DEFAULT_MIN_SCORE = 30
DEFAULT_NEGATIVE_PENALTY = 12

STRONG = {
    "investment": [
        "investment",
        "investments",
        "investor",
        "investors",
        "portfolio",
        "asset management",
        "wealth management",
        "fund management",
    ],
    "trading": [
        "trading",
        "trade",
        "forex",
        "stock market",
        "stocks",
        "crypto trading",
        "trading platform",
    ],
    "crypto": [
        "cryptocurrency",
        "crypto",
        "bitcoin",
        "ethereum",
        "blockchain",
        "defi",
        "wallet",
    ],
    "finance": [
        "financial",
        "finance",
        "broker",
        "brokerage",
        "capital",
        "financial services",
    ],
    "profit": [
        "profit",
        "profits",
        "earnings",
        "returns",
        "passive income",
        "roi",
        "yield",
    ],
}

MEDIUM = [
    "money",
    "fund",
    "funds",
    "market",
    "assets",
    "wealth",
    "income",
    "deposit",
    "withdraw",
    "exchange",
    "payment",
    "account",
    "premium",
    "membership",
    "join",
    "start investing",
]

NEGATIVE = [
    "domain for sale",
    "this domain is for sale",
    "buy this domain",
    "parked domain",
    "domain parking",
    "coming soon",
    "under construction",
    "default web site",
    "apache2 ubuntu default page",
    "nginx welcome",
]


def _settings(settings):
    if not isinstance(settings, dict):
        settings = {}

    def integer(key, default, low, high):
        try:
            value = int(settings.get(key, default))
        except Exception:
            value = default
        return max(low, min(value, high))

    return {
        "timeout": integer(
            "timeout",
            DEFAULT_TIMEOUT,
            3,
            30,
        ),
        "max_bytes": integer(
            "max_bytes",
            DEFAULT_MAX_BYTES,
            100 * 1024,
            5 * 1024 * 1024,
        ),
        "min_score": integer(
            "min_score",
            DEFAULT_MIN_SCORE,
            1,
            100,
        ),
        "negative_penalty": integer(
            "negative_penalty",
            DEFAULT_NEGATIVE_PENALTY,
            0,
            50,
        ),
        "redirects": bool(
            settings.get(
                "redirects",
                True,
            )
        ),
        "https_fallback": bool(
            settings.get(
                "https_fallback",
                True,
            )
        ),
    }


def _fetch(url, cfg):
    try:
        response = requests.get(
            url,
            timeout=cfg["timeout"],
            headers={
                "User-Agent":
                    "Mozilla/5.0 "
                    "(compatible; "
                    "LD76-Investment-Radar/5.0)",
                "Accept":
                    "text/html,application/xhtml+xml,"
                    "application/xml;q=0.9,*/*;q=0.8",
            },
            allow_redirects=cfg["redirects"],
            stream=True,
        )

        if response.status_code >= 400:
            response.close()
            return None, None

        data = b""

        for chunk in response.iter_content(
            chunk_size=16384
        ):
            if not chunk:
                continue

            data += chunk

            if len(data) >= cfg["max_bytes"]:
                break

        final_url = response.url
        response.close()

        return (
            data[:cfg["max_bytes"]].decode(
                "utf-8",
                "ignore",
            ),
            final_url,
        )

    except Exception:
        return None, None


def _page(domain, cfg):
    https = "https://" + domain
    text, url = _fetch(
        https,
        cfg,
    )

    if text:
        return text, url

    if cfg["https_fallback"]:
        http = "http://" + domain
        return _fetch(
            http,
            cfg,
        )

    return None, None


def _clean(text):
    return re.sub(
        r"\s+",
        " ",
        text or "",
    ).strip().lower()


def _extract(html):
    soup = BeautifulSoup(
        html,
        "html.parser",
    )

    title = ""

    if soup.title:
        title = soup.title.get_text(
            " ",
            strip=True,
        )

    parts = [title]

    for tag in soup.find_all(
        "meta"
    ):
        name = (
            tag.get("name")
            or tag.get("property")
            or ""
        ).lower()

        content = (
            tag.get("content")
            or ""
        )

        if name in (
            "description",
            "keywords",
            "og:title",
            "og:description",
            "twitter:title",
            "twitter:description",
        ):
            parts.append(content)

    for tag in soup(
        ["script", "style", "noscript"]
    ):
        tag.decompose()

    parts.append(
        soup.get_text(
            " ",
            strip=True,
        )
    )

    return (
        _clean(" ".join(parts)),
        title.strip(),
    )


def _matches(text):
    categories = {}
    evidence = []

    for category, words in STRONG.items():
        hits = []

        for word in words:
            if word in text:
                hits.append(word)

        if hits:
            categories[category] = hits
            evidence.extend(hits)

    medium_hits = []

    for word in MEDIUM:
        if word in text:
            medium_hits.append(word)

    evidence.extend(medium_hits)

    negatives = []

    for word in NEGATIVE:
        if word in text:
            negatives.append(word)

    return (
        categories,
        list(dict.fromkeys(evidence)),
        negatives,
    )


def _score(categories, evidence, negatives, cfg):
    score = 0

    score += len(categories) * 15
    score += min(
        len(evidence) * 3,
        30,
    )

    if "investment" in categories:
        score += 15

    if "trading" in categories:
        score += 12

    if "crypto" in categories:
        score += 10

    if "finance" in categories:
        score += 10

    if "profit" in categories:
        score += 10

    score -= (
        len(negatives)
        * cfg["negative_penalty"]
    )

    return max(
        0,
        min(score, 100),
    )


def detect_investment(
    domain,
    settings=None,
):
    domain = str(
        domain or ""
    ).strip().lower()

    cfg = _settings(
        settings
    )

    html, url = _page(
        domain,
        cfg,
    )

    if not html:
        return {
            "status": "fetch_failed",
            "domain": domain,
        }

    text, title = _extract(
        html
    )

    categories, evidence, negatives = (
        _matches(text)
    )

    score = _score(
        categories,
        evidence,
        negatives,
        cfg,
    )

    strong_categories = len(
        categories
    )

    qualified = (
        score >= cfg["min_score"]
        and (
            strong_categories >= 1
            or len(evidence) >= 4
        )
        and len(negatives) < 2
    )

    result = {
        "domain": domain,
        "score": score,
        "category": (
            next(
                iter(categories),
                "Investment",
            )
        ),
        "matched_categories": list(
            categories.keys()
        ),
        "evidence": evidence[:20],
        "negative_signals": negatives,
        "url": url,
        "title": title,
    }

    if qualified:
        return {
            "status": "matched",
            "domain": domain,
            "result": result,
        }

    return {
        "status": "rejected",
        "domain": domain,
        "score": score,
        "result": result,
    }
