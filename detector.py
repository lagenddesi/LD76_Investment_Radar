import re
import requests
from bs4 import BeautifulSoup


DEFAULT_TIMEOUT = 8
DEFAULT_MAX_BYTES = 800 * 1024
DEFAULT_MIN_SCORE = 30
DEFAULT_NEGATIVE_PENALTY = 12


# High-value phrases that strongly indicate an investment/financial site.
STRONG = {
    "investment": [
        "investment company",
        "investment firm",
        "investment platform",
        "investment management",
        "investment services",
        "investment advisor",
        "investment adviser",
        "investment portfolio",
        "investment plan",
        "investment plans",
        "invest now",
        "start investing",
        "managed investment",
        "investor relations",
    ],
    "trading": [
        "trading platform",
        "online trading",
        "online trader",
        "forex trading",
        "stock trading",
        "crypto trading",
        "securities trading",
        "trading account",
        "trading broker",
        "trading brokerage",
        "buy stocks",
        "sell stocks",
        "trade stocks",
        "trade forex",
    ],
    "wealth": [
        "wealth management",
        "wealth manager",
        "asset management",
        "asset manager",
        "portfolio management",
        "portfolio manager",
        "private wealth",
        "wealth advisory",
    ],
    "finance": [
        "financial services",
        "financial company",
        "financial institution",
        "financial advisor",
        "financial adviser",
        "capital markets",
        "financial markets",
        "securities",
        "securities firm",
        "financial brokerage",
    ],
    "brokerage": [
        "online broker",
        "stock broker",
        "stockbroker",
        "brokerage account",
        "brokerage platform",
        "brokerage services",
        "securities broker",
        "open brokerage account",
    ],
    "funds": [
        "investment fund",
        "mutual fund",
        "hedge fund",
        "index fund",
        "fund management",
        "fund manager",
        "private equity",
        "venture capital",
        "capital investment",
    ],
    "crypto": [
        "crypto exchange",
        "cryptocurrency exchange",
        "crypto trading platform",
        "digital asset trading",
        "digital assets investment",
        "digital asset exchange",
        "crypto investment",
        "cryptocurrency investment",
        "crypto portfolio",
    ],
}


# Contextual financial terms.
CONTEXT = [
    "investment account",
    "investing account",
    "investor account",
    "trading account",
    "broker account",
    "portfolio",
    "portfolio management",
    "market analysis",
    "stock market",
    "financial market",
    "forex market",
    "foreign exchange",
    "stock exchange",
    "securities market",
    "asset allocation",
    "fund your account",
    "fund account",
    "deposit funds",
    "withdraw investment",
    "investment return",
    "investment returns",
    "return on investment",
    "annual return",
    "managed portfolio",
    "investment portfolio",
    "financial portfolio",
    "capital management",
    "capital investment",
    "wealth planning",
]


# These words are deliberately weak.
# They cannot qualify a website by themselves.
GENERIC = [
    "profit",
    "profits",
    "money",
    "income",
    "earn",
    "earnings",
    "returns",
    "roi",
    "yield",
    "deposit",
    "withdraw",
    "account",
    "payment",
    "wallet",
    "premium",
    "membership",
    "join",
]


# Hard-negative gambling indicators.
GAMBLING = [
    "casino",
    "online casino",
    "live casino",
    "casino games",
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
    "casino bonus",
    "betting bonus",
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

        return max(
            low,
            min(value, high),
        )

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
                "User-Agent": (
                    "Mozilla/5.0 "
                    "(compatible; "
                    "LD76-Investment-Radar/6.0)"
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


def _find_phrases(text, phrases):
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
        hits = _find_phrases(
            text,
            phrases,
        )

        if hits:
            categories[category] = hits
            evidence.extend(hits)

    context_hits = _find_phrases(
        text,
        CONTEXT,
    )

    generic_hits = _find_phrases(
        text,
        GENERIC,
    )

    gambling_hits = _find_phrases(
        text,
        GAMBLING,
    )

    negative_hits = _find_phrases(
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
    gambling_hits,
):
    score = 0

    # Strong financial categories.
    score += len(categories) * 12

    # Strong contextual phrases.
    score += min(
        len(evidence) * 4,
        36,
    )

    # Extra value for the most important categories.
    if "investment" in categories:
        score += 20

    if "trading" in categories:
        score += 18

    if "wealth" in categories:
        score += 15

    if "brokerage" in categories:
        score += 15

    if "funds" in categories:
        score += 15

    if "finance" in categories:
        score += 12

    if "crypto" in categories:
        score += 8

    # Context makes a generic-looking site more credible.
    score += min(
        len(context_hits) * 3,
        18,
    )

    # Gambling is heavily penalized.
    score -= min(
        len(gambling_hits) * 20,
        80,
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
        gambling_hits,
    )

    strong_count = len(categories)
    context_count = len(context_hits)

    # A gambling website is rejected when gambling
    # terminology is substantial, even if it mentions
    # money, profit, trading, crypto, or investment.
    gambling_hard_reject = (
        len(gambling_hits) >= 2
        or (
            len(gambling_hits) >= 1
            and strong_count == 0
        )
    )

    # Generic financial words alone are never enough.
    financial_context = (
        strong_count >= 1
        and (
            context_count >= 1
            or len(evidence) >= 2
        )
    )

    qualified = (
        not gambling_hard_reject
        and score >= cfg["min_score"]
        and financial_context
        and len(negatives) < 2
    )

    if gambling_hard_reject:
        score = min(
            score,
            10,
        )

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
        "evidence": evidence[:20],
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
