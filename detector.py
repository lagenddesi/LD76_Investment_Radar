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
        "investing",
        "investor",
        "investors",
        "investment company",
        "investment firm",
        "investment platform",
        "investment service",
        "investment services",
        "investment plan",
        "investment plans",
        "invest now",
        "start investing",
        "invest with us",
        "investment opportunity",
        "grow your investment",
        "investment portfolio",
    ],
    "trading": [
        "trading",
        "trader",
        "traders",
        "forex trading",
        "forex trader",
        "stock trading",
        "stock trader",
        "online trading",
        "online trader",
        "trading platform",
        "trading account",
        "trading system",
        "trading signals",
        "trading software",
        "trade forex",
        "trade stocks",
        "trade crypto",
        "crypto trading",
        "online broker",
    ],
    "finance": [
        "finance",
        "financial",
        "financial services",
        "financial company",
        "financial platform",
        "financial market",
        "financial markets",
        "capital markets",
        "financial solutions",
        "financial institution",
    ],
    "brokerage": [
        "broker",
        "brokerage",
        "brokerage account",
        "brokerage platform",
        "stock broker",
        "stockbroker",
        "forex broker",
        "crypto broker",
        "securities broker",
        "broker account",
    ],
    "wealth": [
        "wealth management",
        "wealth manager",
        "wealth advisory",
        "asset management",
        "asset manager",
        "portfolio management",
        "portfolio manager",
        "private wealth",
        "manage your portfolio",
    ],
    "funds": [
        "investment fund",
        "mutual fund",
        "fund management",
        "fund manager",
        "hedge fund",
        "index fund",
        "private equity",
        "venture capital",
    ],
    "crypto": [
        "cryptocurrency",
        "crypto",
        "bitcoin",
        "ethereum",
        "digital assets",
        "crypto exchange",
        "cryptocurrency exchange",
        "crypto investment",
        "digital asset trading",
    ],
}


CONTEXT = [
    "investment account",
    "investor account",
    "trading account",
    "broker account",
    "open account",
    "open an account",
    "create account",
    "manage portfolio",
    "portfolio management",
    "market analysis",
    "market data",
    "stock market",
    "financial market",
    "forex market",
    "foreign exchange",
    "stock exchange",
    "securities",
    "buy stocks",
    "sell stocks",
    "buy and sell",
    "trade stocks",
    "trade forex",
    "trade crypto",
    "trading assets",
    "digital assets",
    "asset allocation",
    "managed portfolio",
    "investment portfolio",
    "financial portfolio",
    "capital management",
    "fund management",
    "fund your account",
    "deposit funds",
    "withdraw funds",
    "investment return",
    "investment returns",
    "return on investment",
    "annual return",
    "passive income",
    "investment opportunity",
    "financial opportunity",
    "profit from trading",
    "profit from investment",
    "trading profit",
    "investment profit",
    "earn from trading",
    "earn from investment",
    "account balance",
    "market price",
    "buy crypto",
    "sell crypto",
]


GENERIC = [
    "profit",
    "profits",
    "money",
    "income",
    "earn",
    "earnings",
    "return",
    "returns",
    "yield",
    "deposit",
    "withdraw",
    "account",
    "payment",
    "wallet",
    "premium",
    "membership",
    "join",
    "bonus",
]


GAMBLING = [
    "casino",
    "online casino",
    "live casino",
    "casino games",
    "casino bonus",
    "sports betting",
    "sport betting",
    "betting",
    "bet now",
    "place a bet",
    "wager",
    "wagering",
    "sportsbook",
    "bookmaker",
    "gambling",
    "gambling site",
    "gambling games",
    "slot machine",
    "slot machines",
    "slots",
    "roulette",
    "blackjack",
    "baccarat",
    "poker",
    "jackpot",
    "lottery",
    "scratch card",
    "crash game",
    "aviator",
    "betting odds",
    "free spins",
    "spin to win",
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
            settings.get("redirects", True)
        ),
        "https_fallback": bool(
            settings.get("https_fallback", True)
        ),
    }


def _fetch(url, cfg):
    try:
        response = requests.get(
            url,
            timeout=cfg["timeout"],
            headers={
                "User-Agent": (
                    "Mozilla/5.0 "
                    "(compatible; "
                    "LD76-Investment-Radar/8.0)"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,"
                    "application/xml;q=0.9,*/*;q=0.8"
                ),
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
    text, url = _fetch(
        "https://" + domain,
        cfg,
    )

    if text:
        return text, url

    if cfg["https_fallback"]:
        return _fetch(
            "http://" + domain,
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

    for tag in soup.find_all("meta"):
        name = (
            tag.get("name")
            or tag.get("property")
            or ""
        ).lower()

        content = tag.get("content") or ""

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


def _find(text, phrases):
    found = []

    for phrase in phrases:
        pattern = (
            r"(?<![a-z0-9])"
            + re.escape(phrase)
            + r"(?![a-z0-9])"
        )

        if re.search(pattern, text):
            found.append(phrase)

    return found


def _matches(text):
    categories = {}
    evidence = []

    for category, phrases in STRONG.items():
        hits = _find(
            text,
            phrases,
        )

        if hits:
            categories[category] = hits
            evidence.extend(hits)

    context_hits = _find(
        text,
        CONTEXT,
    )

    generic_hits = _find(
        text,
        GENERIC,
    )

    gambling_hits = _find(
        text,
        GAMBLING,
    )

    negative_hits = _find(
        text,
        NEGATIVE,
    )

    evidence.extend(context_hits)

    return (
        categories,
        list(dict.fromkeys(evidence)),
        context_hits,
        generic_hits,
        gambling_hits,
        negative_hits,
    )


def _score(
    categories,
    evidence,
    context_hits,
    generic_hits,
    gambling_hits,
):
    score = 0

    # Category identity.
    score += len(categories) * 12

    # Strong evidence.
    score += min(
        len(evidence) * 3,
        36,
    )

    # Important category bonuses.
    bonuses = {
        "investment": 20,
        "trading": 20,
        "finance": 12,
        "brokerage": 16,
        "wealth": 16,
        "funds": 16,
        "crypto": 8,
    }

    for category, bonus in bonuses.items():
        if category in categories:
            score += bonus

    # Contextual activity.
    score += min(
        len(context_hits) * 4,
        24,
    )

    # Generic words only provide tiny support.
    score += min(
        len(generic_hits),
        4,
    )

    # Gambling penalty.
    score -= min(
        len(gambling_hits) * 30,
        100,
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

    cfg = _settings(settings)

    html, url = _page(
        domain,
        cfg,
    )

    if not html:
        return {
            "status": "fetch_failed",
            "domain": domain,
        }

    text, title = _extract(html)

    (
        categories,
        evidence,
        context_hits,
        generic_hits,
        gambling_hits,
        negatives,
    ) = _matches(text)

    score = _score(
        categories,
        evidence,
        context_hits,
        generic_hits,
        gambling_hits,
    )

    strong_count = len(categories)

    # Real financial identity.
    financial_match = (
        (
            strong_count >= 1
            and (
                len(context_hits) >= 1
                or len(evidence) >= 3
            )
        )
        or strong_count >= 2
    )

    # Gambling exclusion.
    gambling_reject = (
        len(gambling_hits) >= 2
        or (
            len(gambling_hits) >= 1
            and strong_count == 0
        )
    )

    # Parked/default pages.
    parked_reject = len(negatives) >= 2

    qualified = (
        financial_match
        and not gambling_reject
        and not parked_reject
        and score >= cfg["min_score"]
    )

    if gambling_reject:
        score = min(score, 10)

    if parked_reject:
        score = min(score, 10)

    if categories:
        category = max(
            categories,
            key=lambda key: len(
                categories[key]
            ),
        )
    else:
        category = "Investment"

    result = {
        "domain": domain,
        "score": score,
        "category": category,
        "matched_categories": list(
            categories.keys()
        ),
        "evidence": evidence[:25],
        "negative_signals": (
            negatives[:20]
            + gambling_hits[:20]
        ),
        "gambling_signals": gambling_hits[:20],
        "generic_signals": generic_hits[:20],
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
