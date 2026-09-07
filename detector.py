import re
import requests
from bs4 import BeautifulSoup


TIMEOUT = 8
MAX_BYTES = 800_000


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0 Safari/537.36"
    )
}


# Strong signals: direct evidence that the website is related
# to investing, earning, trading, finance or money services.
STRONG_SIGNALS = {
    "investment": [
        "investment plan",
        "investment plans",
        "investment program",
        "investment programs",
        "investment opportunity",
        "investment opportunities",
        "invest now",
        "start investing",
        "online investment",
        "investment platform",
        "investment account",
        "investing platform",
        "investing opportunity",
        "minimum investment",
        "investment package",
        "investment packages",
        "investment return",
        "investment returns",
    ],
    "profit": [
        "guaranteed return",
        "guaranteed returns",
        "high return",
        "high returns",
        "daily profit",
        "weekly profit",
        "monthly profit",
        "daily earnings",
        "weekly earnings",
        "monthly earnings",
        "passive income",
        "profit sharing",
        "profit percentage",
        "profit rate",
        "return on investment",
        "roi",
        "high yield",
        "fixed return",
        "fixed returns",
    ],
    "trading": [
        "forex trading",
        "forex broker",
        "forex platform",
        "trading platform",
        "trading account",
        "copy trading",
        "crypto trading",
        "stock trading",
        "trading signals",
        "trading bot",
        "automated trading",
        "binary trading",
    ],
    "crypto": [
        "bitcoin",
        "ethereum",
        "cryptocurrency",
        "cryptocurrencies",
        "crypto investment",
        "crypto investing",
        "crypto exchange",
        "crypto trading",
        "usdt",
        "usdc",
        "binance",
        "staking",
        "defi",
        "liquidity pool",
        "crypto mining",
        "bitcoin mining",
    ],
    "finance": [
        "wealth management",
        "asset management",
        "portfolio management",
        "financial services",
        "financial investment",
        "investment fund",
        "mutual fund",
        "hedge fund",
        "capital management",
        "fund management",
        "wealth investment",
        "financial platform",
    ],
    "money": [
        "deposit",
        "withdrawal",
        "withdraw",
        "deposit funds",
        "fund your account",
        "wallet",
        "payment",
        "payout",
        "earn money",
        "make money",
        "earn online",
        "income",
    ],
}


# Medium signals. These are useful when combined with stronger signals.
MEDIUM_SIGNALS = {
    "investment": [
        "invest",
        "investing",
        "investor",
        "investors",
        "investment",
        "investments",
        "portfolio",
        "assets",
        "capital",
        "returns",
        "yield",
    ],
    "profit": [
        "profit",
        "profits",
        "earning",
        "earnings",
        "revenue",
        "income",
        "roi",
        "interest",
        "yield",
    ],
    "trading": [
        "trade",
        "trader",
        "trading",
        "forex",
        "stocks",
        "shares",
        "market",
        "signals",
        "broker",
    ],
    "crypto": [
        "crypto",
        "bitcoin",
        "ethereum",
        "blockchain",
        "token",
        "tokens",
        "coin",
        "coins",
        "staking",
        "mining",
        "defi",
    ],
    "finance": [
        "finance",
        "financial",
        "fund",
        "funds",
        "banking",
        "wealth",
        "asset",
        "assets",
        "loan",
        "lending",
        "credit",
        "money",
    ],
    "action": [
        "register",
        "signup",
        "sign up",
        "login",
        "account",
        "dashboard",
        "join",
        "get started",
        "start now",
        "referral",
        "affiliate",
        "commission",
    ],
}


# Negative signals are now PENALTIES instead of hard rejection.
# This prevents a legitimate page from automatically becoming score 0.
NEGATIVE_SIGNALS = [
    ("domain for sale", 35),
    ("buy this domain", 35),
    ("this domain is available", 35),
    ("premium domain", 30),
    ("domain auction", 30),
    ("domain marketplace", 30),
    ("domain broker", 30),
    ("parked domain", 30),
    ("parking page", 30),
    ("under construction", 18),
    ("coming soon", 15),
    ("default hosting page", 30),
    ("no website", 25),
]


CATEGORY_NAMES = {
    "investment": "Investment",
    "profit": "Profit / ROI",
    "trading": "Trading",
    "crypto": "Crypto",
    "finance": "Finance",
    "money": "Money / Payments",
    "action": "Platform / Account",
}


def _fetch(domain):
    """
    Fetch a domain using HTTPS first and HTTP as fallback.
    """
    domain = domain.strip().lower()

    if not domain:
        return {
            "status": "fetch_failed",
            "domain": domain,
            "error": "empty domain",
        }

    urls = [
        f"https://{domain}",
        f"http://{domain}",
    ]

    last_error = "unknown error"

    for url in urls:
        try:
            response = requests.get(
                url,
                headers=HEADERS,
                timeout=TIMEOUT,
                allow_redirects=True,
                verify=True,
            )

            content = response.content[:MAX_BYTES]

            if not content:
                last_error = "empty response"
                continue

            return {
                "status": "fetched",
                "domain": domain,
                "url": response.url,
                "status_code": response.status_code,
                "content_type": response.headers.get(
                    "content-type",
                    ""
                ),
                "content": content,
            }

        except Exception as exc:
            last_error = str(exc)

    return {
        "status": "fetch_failed",
        "domain": domain,
        "error": last_error,
    }


def _extract_page(content):
    """
    Extract title, meta information and visible page text.
    Investment websites often put their important keywords
    in <title> or <meta> even when the visible page is JS-heavy.
    """
    if not content:
        return {
            "title": "",
            "meta": "",
            "text": "",
        }

    try:
        html = content.decode(
            "utf-8",
            errors="ignore"
        )
    except Exception:
        html = str(content)

    try:
        soup = BeautifulSoup(
            html,
            "html.parser"
        )

        title = ""

        if soup.title:
            title = soup.title.get_text(
                " ",
                strip=True
            )

        meta_parts = []

        for tag in soup.find_all("meta"):
            name = (
                tag.get("name")
                or tag.get("property")
                or ""
            ).lower()

            if name in {
                "description",
                "keywords",
                "og:title",
                "og:description",
                "twitter:title",
                "twitter:description",
            }:
                value = tag.get(
                    "content",
                    ""
                )

                if value:
                    meta_parts.append(value)

        for tag in soup([
            "script",
            "style",
            "noscript",
            "svg",
            "template",
        ]):
            tag.decompose()

        text = soup.get_text(
            " ",
            strip=True
        )

        return {
            "title": title,
            "meta": " ".join(meta_parts),
            "text": text,
        }

    except Exception:
        # Fallback parser for malformed HTML.
        text = re.sub(
            r"<[^>]+>",
            " ",
            html
        )

        text = re.sub(
            r"\s+",
            " ",
            text
        ).strip()

        return {
            "title": "",
            "meta": "",
            "text": text,
        }


def _normalise(text):
    text = text.lower()

    text = text.replace(
        "\u00a0",
        " "
    )

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    return text.strip()


def _contains_signal(text, phrase):
    """
    Phrase matching with a little protection against
    accidental substring matches for short words.
    """
    phrase = phrase.lower().strip()

    if not phrase:
        return False

    # Short/generic words should be matched as complete words.
    if len(phrase.split()) == 1 and len(phrase) <= 7:
        return re.search(
            rf"\b{re.escape(phrase)}\b",
            text
        ) is not None

    return phrase in text


def _score(page):
    title = _normalise(
        page.get("title", "")
    )

    meta = _normalise(
        page.get("meta", "")
    )

    text = _normalise(
        page.get("text", "")
    )

    # Give title/meta more importance because many modern
    # websites expose little useful visible text.
    combined = " ".join([
        title,
        meta,
        text,
    ])

    scores = {}
    evidence = []
    matched_categories = set()

    # ---------------------------------------------------------
    # Strong signals
    # ---------------------------------------------------------

    for category, phrases in STRONG_SIGNALS.items():
        category_score = 0

        for phrase in phrases:
            if _contains_signal(
                combined,
                phrase
            ):
                weight = 8

                # Title/meta signals are stronger.
                if _contains_signal(title, phrase):
                    weight += 5

                elif _contains_signal(meta, phrase):
                    weight += 3

                category_score += weight

                evidence.append({
                    "signal": phrase,
                    "category": CATEGORY_NAMES.get(
                        category,
                        category
                    ),
                    "strength": "strong",
                })

                matched_categories.add(
                    category
                )

        if category_score:
            # Avoid one category producing an enormous score.
            scores[category] = min(
                category_score,
                30
            )

    # ---------------------------------------------------------
    # Medium signals
    # ---------------------------------------------------------

    for category, phrases in MEDIUM_SIGNALS.items():
        category_score = scores.get(
            category,
            0
        )

        found_here = 0

        for phrase in phrases:
            if _contains_signal(
                combined,
                phrase
            ):
                found_here += 1

                weight = 3

                if _contains_signal(title, phrase):
                    weight += 3

                elif _contains_signal(meta, phrase):
                    weight += 2

                category_score += weight

                # Don't flood the result with hundreds
                # of repeated generic terms.
                if len(evidence) < 25:
                    evidence.append({
                        "signal": phrase,
                        "category": CATEGORY_NAMES.get(
                            category,
                            category
                        ),
                        "strength": "medium",
                    })

                matched_categories.add(
                    category
                )

        if found_here:
            scores[category] = min(
                category_score,
                30
            )

    # ---------------------------------------------------------
    # Negative signals
    # ---------------------------------------------------------

    penalty = 0
    negative_matches = []

    for phrase, points in NEGATIVE_SIGNALS:
        if _contains_signal(
            combined,
            phrase
        ):
            penalty += points
            negative_matches.append(
                phrase
            )

    # ---------------------------------------------------------
    # Context bonuses
    # ---------------------------------------------------------

    total = sum(
        scores.values()
    )

    # Multiple different financial categories are much
    # stronger evidence than a single generic keyword.
    category_count = len(
        matched_categories
    )

    if category_count >= 2:
        total += 8

    if category_count >= 3:
        total += 8

    if category_count >= 4:
        total += 10

    # Action + financial language is a strong website signal.
    if (
        "action" in matched_categories
        and (
            "investment" in matched_categories
            or "trading" in matched_categories
            or "crypto" in matched_categories
            or "finance" in matched_categories
            or "profit" in matched_categories
        )
    ):
        total += 8

    # Direct money movement signals become stronger when
    # combined with an actual financial category.
    if (
        "money" in matched_categories
        and (
            "investment" in matched_categories
            or "trading" in matched_categories
            or "crypto" in matched_categories
            or "finance" in matched_categories
            or "profit" in matched_categories
        )
    ):
        total += 8

    # Title/meta bonus.
    title_meta = " ".join([
        title,
        meta,
    ])

    title_meta_hits = 0

    for phrase_list in STRONG_SIGNALS.values():
        for phrase in phrase_list:
            if _contains_signal(
                title_meta,
                phrase
            ):
                title_meta_hits += 1

    if title_meta_hits:
        total += min(
            title_meta_hits * 4,
            16
        )

    total -= penalty

    total = max(
        0,
        total
    )

    # ---------------------------------------------------------
    # Detection rule
    # ---------------------------------------------------------
    #
    # We deliberately don't require a very high score.
    # A website can be a real investment/trading platform
    # while having a short or JS-heavy homepage.
    #
    # Requirements:
    #
    # 1. At least one strong financial signal plus another
    #    supporting category, OR
    #
    # 2. At least three independent categories, OR
    #
    # 3. Very strong direct investment/profit evidence.
    # ---------------------------------------------------------

    financial_categories = {
        "investment",
        "profit",
        "trading",
        "crypto",
        "finance",
    }

    financial_count = len(
        matched_categories.intersection(
            financial_categories
        )
    )

    strong_evidence_count = sum(
        1
        for item in evidence
        if item["strength"] == "strong"
    )

    qualifies = False

    if (
        financial_count >= 2
        and total >= 14
    ):
        qualifies = True

    elif (
        strong_evidence_count >= 2
        and financial_count >= 1
        and total >= 12
    ):
        qualifies = True

    elif (
        financial_count >= 1
        and "money" in matched_categories
        and total >= 16
    ):
        qualifies = True

    # A parked/for-sale page with no real financial evidence
    # must never be classified as an investment website.
    if (
        negative_matches
        and financial_count == 0
    ):
        qualifies = False

    # ---------------------------------------------------------
    # Category selection
    # ---------------------------------------------------------

    category = "Other"

    priority = [
        "investment",
        "crypto",
        "trading",
        "profit",
        "finance",
        "money",
    ]

    for item in priority:
        if item in matched_categories:
            category = CATEGORY_NAMES.get(
                item,
                item
            )
            break

    return {
        "score": total,
        "category": category,
        "matched_categories": [
            CATEGORY_NAMES.get(
                item,
                item
            )
            for item in sorted(
                matched_categories
            )
        ],
        "evidence": evidence[:20],
        "negative_signals": negative_matches,
        "qualifies": qualifies,
    }


def detect_investment(domain):
    """
    Public detector function used by scanner.py.
    The return structure intentionally remains compatible
    with the existing scanner.
    """
    domain = (
        domain
        or ""
    ).strip().lower()

    fetched = _fetch(
        domain
    )

    if fetched["status"] != "fetched":
        return {
            "status": "fetch_failed",
            "domain": domain,
            "error": fetched.get(
                "error",
                "fetch failed"
            ),
        }

    page = _extract_page(
        fetched.get(
            "content",
            b""
        )
    )

    result = _score(
        page
    )

    if not result["qualifies"]:
        return {
            "status": "rejected",
            "domain": domain,
            "score": result["score"],
            "category": result["category"],
            "matched_categories": result[
                "matched_categories"
            ],
            "evidence": result[
                "evidence"
            ],
            "negative_signals": result[
                "negative_signals"
            ],
            "url": fetched.get(
                "url",
                ""
            ),
        }

    return {
        "status": "matched",
        "domain": domain,
        "result": {
            "score": result["score"],
            "category": result["category"],
            "matched_categories": result[
                "matched_categories"
            ],
            "evidence": result[
                "evidence"
            ],
            "negative_signals": result[
                "negative_signals"
            ],
            "url": fetched.get(
                "url",
                ""
            ),
            "title": page.get(
                "title",
                ""
            ),
        },
                }
