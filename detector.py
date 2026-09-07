
import re
import urllib.request
from html import unescape


POS = {
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
}


PAY = [
    "usdt",
    "btc",
    "eth",
    "trx",
    "bank transfer",
    "wallet",
    "deposit",
    "withdraw",
]


ACC = [
    "signup",
    "sign up",
    "register",
    "login",
    "referral",
    "referral code",
    "invite link",
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
    for scheme in (
        "https://",
        "http://",
    ):
        try:
            request = urllib.request.Request(
                scheme + domain,
                headers={
                    "User-Agent": "Mozilla/5.0 LD76-Investment-Radar",
                    "Accept": "text/html,application/xhtml+xml",
                },
            )

            with urllib.request.urlopen(
                request,
                timeout=5,
            ) as response:

                html = response.read(
                    800000
                ).decode(
                    "utf-8",
                    "ignore",
                )

                return (
                    response.geturl(),
                    html,
                )

        except Exception:
            pass

    return None, ""


def _text(html):
    html = re.sub(
        r"<script[\s\S]*?</script>|<style[\s\S]*?</style>",
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
    if any(
        phrase in text
        for phrase in BAD
    ):
        return -100, []

    hits = []
    score = 0

    for phrase, weight in POS.items():
        if phrase in text:
            score += weight
            hits.append(phrase)

    score += sum(
        2
        for item in ACC
        if item in text
    )

    score += sum(
        2
        for item in PAY
        if item in text
    )

    strong = sum(
        1
        for item in hits
        if POS[item] >= 8
    )

    action = any(
        item in text
        for item in (
            "invest now",
            "start investing",
            "make deposit",
            "deposit funds",
            "choose plan",
            "investment amount",
        )
    )

    money = any(
        item in text
        for item in (
            "deposit",
            "minimum investment",
            "investment amount",
            "profit percentage",
            "daily profit",
            "monthly profit",
        )
    )

    if strong < 2 or not (
        action and money
    ):
        return 0, hits

    return score, hits


def detect_investment(domain):
    url, html = _fetch(domain)

    if not html:
        return None

    text = _text(html)

    score, hits = _score(text)

    if score < 20:
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
            "btc",
            "ethereum",
            "crypto",
        ],
        "Forex Investment": [
            "forex",
            "currency trading",
            "fx trading",
        ],
        "Real Estate Investment": [
            "real estate",
            "property investment",
        ],
        "Trading Investment": [
            "trading platform",
            "trading account",
        ],
        "Mining Investment": [
            "cloud mining",
            "mining investment",
        ],
        "DeFi Investment": [
            "defi",
            "liquidity pool",
            "staking",
        ],
        "Lending Investment": [
            "lending",
            "loan investment",
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
