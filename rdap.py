import json
import re
import urllib.request


BOOT = "https://data.iana.org/rdap/dns.json"


def _get(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LD76-Investment-Radar/1.0",
            "Accept": "application/rdap+json,application/json",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=15,
    ) as response:
        return json.loads(
            response.read().decode(
                "utf-8",
                "ignore",
            )
        )


def _server(domain):
    try:
        data = _get(BOOT)

        tld = (
            domain.lower()
            .rstrip(".")
            .split(".")[-1]
        )

        for item in data.get(
            "services",
            [],
        ):
            if tld in item[0]:
                return item[1][0].rstrip("/")

    except Exception:
        pass

    return None


def _date(events, kind):
    for event in events or []:
        if event.get(
            "eventAction"
        ) == kind:
            return event.get(
                "eventDate"
            )

    return None


def _status(value):
    if isinstance(value, list):
        return ", ".join(value)

    return value or "Unavailable"


def _registrar(entities):
    for entity in entities or []:

        if "registrar" not in entity.get(
            "roles",
            [],
        ):
            continue

        vcard = entity.get(
            "vcardArray",
            [[], []],
        )

        values = (
            vcard[1]
            if len(vcard) > 1
            else []
        )

        for item in values:
            if (
                item[0] == "fn"
                and len(item) > 3
            ):
                return item[3]

    return "Unavailable"


def lookup_domain(domain):
    domain = (
        domain
        .lower()
        .strip()
        .rstrip(".")
    )

    if not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?",
        domain,
    ):
        return {
            "domain": domain,
            "error": "Invalid domain",
        }

    server = _server(domain)

    if not server:
        return {
            "domain": domain,
            "error": "RDAP server not found",
        }

    try:
        data = _get(
            server
            + "/domain/"
            + domain
        )

        return {
            "domain": domain,
            "registration_date": _date(
                data.get("events"),
                "registration",
            ),
            "expiry": _date(
                data.get("events"),
                "expiration",
            ),
            "last_changed": _date(
                data.get("events"),
                "last changed",
            ),
            "status": _status(
                data.get("status")
            ),
            "registrar": _registrar(
                data.get("entities")
            ),
            "nameservers": [
                item.get("ldhName")
                for item in data.get(
                    "nameservers",
                    [],
                )
                if item.get("ldhName")
            ],
            "rdap_server": server,
            "source": "IANA RDAP bootstrap",
        }

    except Exception as exc:
        return {
            "domain": domain,
            "error": str(exc),
            "rdap_server": server,
        }
