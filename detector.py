import re
import urllib.request
from html import unescape


POS = {
    "investment": 6,
    "invest": 5,
    "investing": 5,
    "investment plan": 10,
    "investment package": 10,
    "minimum investment": 9,
    "investment amount": 8,
    "investment period": 7,
    "investment term": 7,
    "expected return": 8,
    "return on investment": 8,
    "roi": 7,
    "profit percentage": 9,
    "profit rate": 8,
    "daily profit": 10,
    "weekly profit": 9,
    "monthly profit": 9,
    "fixed return": 9,
    "guaranteed return": 10,
    "passive income": 8,
    "capital investment": 8,
    "investment opportunity": 8,
    "invest now": 9,
    "start investing": 9,
    "choose plan": 8,
    "make deposit": 8,
    "deposit funds": 8,
    "fund account": 7,
    "invest amount": 9,
    "subscribe plan": 8,
    "buy investment plan": 10,
    "payment method": 4,
    "wallet address": 5,
    "transaction id": 5,
    "transaction hash": 5,
    "referral commission": 7,
    "referral bonus": 6,
    "referral income": 7,
    "affiliate commission": 5,
    "team commission": 6,
    "referral earnings": 6,
    "investment dashboard": 9,
    "earning dashboard": 7,
    "my investments": 9,
    "active investment": 9,
    "investment history": 8,
    "minimum deposit": 7,
    "minimum withdrawal": 5,
    "withdraw profit": 8,
    "trading platform": 7,
    "trading account": 6,
    "forex": 6,
    "crypto investment": 9,
    "cloud mining": 9,
    "staking": 7,
    "liquidity pool": 7,
    "defi": 7,
}


PAY = [
    "usdt",
    "usdc",
    "btc",
    "bitcoin",
    "eth",
    "ethereum",
    "trx",
    "crypto",
    "cryptocurrency",
    "bank transfer",
    "wallet",
    "deposit",
    "withdraw",
    "withdrawal",
    "payment",
]


ACC = [
    "signup",
    "sign up",
    "register",
    "registration",
    "login",
    "referral",
    "referral code",
    "invite link",
    "create account",
    "open account",
]


MONEY = [
    "deposit",
    "minimum deposit",
    "minimum investment",
    "investment amount",
    "profit",
    "profit percentage",
    "profit rate",
    "daily profit",
    "weekly profit",
    "monthly profit",
    "return",
    "roi",
    "earnings",
    "earning",
    "withdraw",
    "withdrawal",
]


ACTION = [
    "invest now",
    "start investing",
    "make deposit",
    "deposit funds",
    "choose plan",
    "investment amount",
    "create account",
    "open account",
    "register",
    "sign up",
    "login",
    "deposit",
]


BAD = [
    "domain for sale",
    "buy this domain",
    "this domain is available",
    "premium domain",
    "domain auction",
    "domain marketplace",
    "domain broker",
    "parked domain",
    "coming soon",
    "under construction",
    "default hosting page",
    "no website",
]


def _fetch(domain):
    for scheme in ("https://", "http://"):
        try:
            request = urllib.request.Request(
                scheme + domain,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 "
                        "(Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 "
                        "Chrome/131 Safari/537.36 "
                        "LD76-Investment-Radar/2.0"
                    ),
                    "Accept": (
                        "text/html,"
                        "application/xhtml+xml,"
                        "application/xml;q=0.9,"
                        "*/*;q=0.8"
                    ),
                },
            )

            with urllib.request.urlopen(
                request,
                timeout=8,
            ) as response:
                content_type = (
                    response.headers.get(
                        "Content-Type",
                        ""
                    ).lower()
                )

                if (
                    content_type
                    and "text" not in content_type
                    and "html" not in content_type
                ):
                    return None, ""

                html = response.read(
                    800000
                ).decode(
                    "utf-8",
                    "ignore",
                )

                return response.geturl(), html

        except Exception:
            continue

    return None, ""


def _text(html):
    html = re.sub(
        r"<script[\s\S]*?</script>",
        " ",
        html,
        flags=re.I,
    )

    html = re.sub(
        r"<style[\s\S]*?</style>",
        " ",
        html,
        flags=re.I,
    )

    html = re.sub(
        r"<noscript[\s\S]*?</noscript>",
        " ",
        html,
        flags=re.I,
    )

    html = re.sub(
        r"<[^>]+>",
        " ",
        html,
    )

    html = unescape(html)

    return re.sub(
        r"\s+",
        " ",
        html,
    ).strip().lower()


def _score(text):
    if not text:
        return 0, []

    bad_hits = [
        phrase
        for phrase in BAD
        if phrase in text
    ]

    if bad_hits:
        return 0, []

    hits = []
    score = 0

    for phrase, weight in POS.items():
        if phrase in text:
            score += weight
            hits.append(phrase)

    pay_hits = [
        item
        for item in PAY
        if item in text
    ]

    acc_hits = [
        item
        for item in ACC
        if item in text
    ]

    money_hits = [
        item
        for item in MONEY
        if item in text
    ]

    action_hits = [
        item
        for item in ACTION
        if item in text
    ]

    score += min(len(pay_hits) * 3, 12)
    score += min(len(acc_hits) * 2, 8)

    strong = sum(
        1
        for item in hits
        if POS.get(item, 0) >= 8
    )

    investment_family = any(
        item in text
        for item in (
            "investment",
            "investing",
            "invest now",
            "investment plan",
            "investment package",
            "profit rate",
            "daily profit",
            "passive income",
            "capital investment",
            "crypto investment",
            "cloud mining",
        )
    )

    financial_family = bool(
        money_hits
        or pay_hits
    )

    action_family = bool(
        action_hits
        or acc_hits
    )

    if strong >= 1 and investment_family and financial_family:
        score += 8

    if investment_family and action_family and financial_family:
        score += 8

    if (
        "investment" in text
        and (
            "profit" in text
            or "return" in text
            or "earn" in text
        )
    ):
        score += 8

    if (
        "deposit" in text
        and (
            "profit" in text
            or "investment" in text
            or "return" in text
        )
    ):
        score += 8

    unique_hits = []

    for item in (
        hits
        + pay_hits
        + acc_hits
        + money_hits
        + action_hits
    ):
        if item not in unique_hits:
            unique_hits.append(item)

    return score, unique_hits


def detect_investment(domain):
    url, html = _fetch(domain)

    if not html:
        return None

    text = _text(html)

    if len(text) < 40:
        return None

    score, hits = _score(text)

    if score < 18:
        return None

    title = ""

    match = re.search(
        r"<title[^>]*>(.*?)</title>",
        html,
        re.I | re.S,
    )

    if match:
        title = re.sub(
            r"\s+",
            " ",
            unescape(
                match.group(1)
            ),
        ).strip()

    category = "General Investment"

    categories = {
        "Crypto Investment": [
            "usdt",
            "usdc",
            "bitcoin",
            "btc",
            "ethereum",
            "eth",
            "crypto",
            "cryptocurrency",
        ],
        "Forex Investment": [
            "forex",
            "currency trading",
            "fx trading",
        ],
        "Real Estate Investment": [
            "real estate",
            "property investment",
            "property investing",
        ],
        "Trading Investment": [
            "trading platform",
            "trading account",
            "trading investment",
        ],
        "Mining Investment": [
            "cloud mining",
            "mining investment",
            "mining plan",
        ],
        "DeFi Investment": [
            "defi",
            "liquidity pool",
            "staking",
        ],
        "Lending Investment": [
            "lending",
            "loan investment",
            "p2p lending",
        ],
    }

    for name, words in categories.items():
        if any(
            word in text
            for word in words
        ):
            category = name
            break

    return {
        "domain": domain,
        "site_name": title or domain,
        "url": url,
        "score": min(score, 100),
        "confidence": (
            "high"
            if score >= 45
            else "medium"
        ),
        "category": category,
        "evidence": hits[:20],
    }
