import json
import re
import urllib.request
import urllib.error


BOOT = "https://data.iana.org/rdap/dns.json"

USER_AGENT = "LD76-Investment-Radar/2.0"

TIMEOUT = 15


def _get(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "application/rdap+json,"
                "application/json;q=0.9,"
                "*/*;q=0.1"
            ),
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=TIMEOUT,
    ) as response:

        body = response.read().decode(
            "utf-8",
            "ignore",
        )

        return json.loads(body)


def _normalise_base_url(url):
    return str(url or "").strip().rstrip("/")


def _server(domain):
    """
    Find the authoritative RDAP server using
    IANA's DNS bootstrap registry.

    IANA format:

        [
            ["com", "net"],
            ["https://example-rdap-server/"]
        ]
    """

    data = _get(BOOT)

    labels = (
        domain.lower()
        .rstrip(".")
        .split(".")
    )

    # RFC 9224 uses longest label-wise match.
    # For normal domains this means checking:
    #
    # example.co.uk
    # -> uk
    # -> co.uk
    #
    # We prefer the longest matching entry.
    best_match = None
    best_length = -1

    for item in data.get("services", []):

        if not isinstance(item, list):
            continue

        if len(item) < 2:
            continue

        entries = item[0]
        urls = item[1]

        if not isinstance(entries, list):
            continue

        if not isinstance(urls, list):
            continue

        for entry in entries:

            entry = str(entry).lower().strip().rstrip(".")

            if not entry:
                continue

            entry_labels = entry.split(".")

            if len(entry_labels) > len(labels):
                continue

            if labels[-len(entry_labels):] != entry_labels:
                continue

            if len(entry_labels) > best_length:
                best_length = len(entry_labels)
                best_match = urls

    if not best_match:
        return None

    # Try HTTPS URLs first.
    candidates = [
        _normalise_base_url(url)
        for url in best_match
        if str(url).lower().startswith("https://")
    ]

    # Then allow other valid URLs as fallback.
    candidates += [
        _normalise_base_url(url)
        for url in best_match
        if not str(url).lower().startswith("https://")
    ]

    for candidate in candidates:
        if candidate:
            return candidate

    return None


def _date(events, *kinds):
    """
    Extract an RDAP event date.

    Supports normal RDAP eventAction values and
    minor variations in capitalization.
    """

    wanted = {
        str(kind).strip().lower()
        for kind in kinds
    }

    for event in events or []:

        if not isinstance(event, dict):
            continue

        action = str(
            event.get("eventAction", "")
        ).strip().lower()

        if action in wanted:
            return event.get("eventDate")

    return None


def _status(value):
    if isinstance(value, list):

        values = [
            str(item).strip()
            for item in value
            if str(item).strip()
        ]

        return (
            ", ".join(values)
            if values
            else "Unavailable"
        )

    if value:
        return str(value)

    return "Unavailable"


def _vcard_value(vcard, field_name):
    """
    Extract a value from an RDAP vCard.
    """

    if not isinstance(vcard, list):
        return None

    if len(vcard) < 2:
        return None

    properties = vcard[1]

    if not isinstance(properties, list):
        return None

    for item in properties:

        if not isinstance(item, list):
            continue

        if len(item) < 4:
            continue

        name = str(
            item[0]
        ).lower()

        if name != field_name.lower():
            continue

        value = item[3]

        if isinstance(value, list):
            value = " ".join(
                str(x)
                for x in value
                if x
            )

        if value:
            return str(value).strip()

    return None


def _registrar(entities):
    """
    Extract registrar name from RDAP entities.

    Different registries may provide registrar
    information through fn, org or handle.
    """

    fallback = None

    for entity in entities or []:

        if not isinstance(entity, dict):
            continue

        roles = entity.get(
            "roles",
            [],
        )

        roles = [
            str(role).lower()
            for role in roles
            if role
        ]

        if "registrar" not in roles:
            continue

        vcard = entity.get(
            "vcardArray"
        )

        name = _vcard_value(
            vcard,
            "fn",
        )

        if name:
            return name

        name = _vcard_value(
            vcard,
            "org",
        )

        if name:
            return name

        handle = entity.get(
            "handle"
        )

        if handle:
            fallback = str(handle)

    return fallback or "Unavailable"


def _nameservers(data):
    nameservers = []

    for item in data.get(
        "nameservers",
        [],
    ):

        if not isinstance(item, dict):
            continue

        name = (
            item.get("ldhName")
            or item.get("unicodeName")
        )

        if name:
            nameservers.append(
                str(name).rstrip(".")
            )

    return list(
        dict.fromkeys(nameservers)
    )


def _build_domain_url(server, domain):
    base = _normalise_base_url(server)

    return (
        base
        + "/domain/"
        + domain
    )


def lookup_domain(domain):
    domain = (
        str(domain or "")
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

    try:
        server = _server(domain)

    except Exception as exc:
        return {
            "domain": domain,
            "error": (
                "Unable to load IANA RDAP "
                "bootstrap registry."
            ),
            "details": str(exc),
        }

    if not server:
        return {
            "domain": domain,
            "error": "RDAP server not found",
        }

    url = _build_domain_url(
        server,
        domain,
    )

    try:
        data = _get(url)

    except urllib.error.HTTPError as exc:
        return {
            "domain": domain,
            "error": (
                "RDAP request failed "
                "with HTTP "
                + str(exc.code)
            ),
            "rdap_server": server,
        }

    except Exception as exc:
        return {
            "domain": domain,
            "error": "RDAP request failed.",
            "details": str(exc),
            "rdap_server": server,
        }

    events = data.get(
        "events",
        [],
    )

    return {
        "domain": domain,

        "registration_date": _date(
            events,
            "registration",
        ),

        "expiry": _date(
            events,
            "expiration",
            "expiry",
        ),

        "last_changed": _date(
            events,
            "last changed",
            "last_changed",
            "last update of rdap database",
        ),

        "status": _status(
            data.get("status")
        ),

        "registrar": _registrar(
            data.get("entities")
        ),

        "nameservers": _nameservers(
            data
        ),

        "rdap_server": server,

        "rdap_url": url,

        "source": "IANA RDAP bootstrap",
    }
