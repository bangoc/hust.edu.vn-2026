"""One spelling per URL, so the queue holds each page once however a group writes its link."""

from __future__ import annotations

from posixpath import normpath
from urllib.parse import quote_plus, unquote_plus, urlsplit, urlunsplit

_MAX_QUERY_PAIRS = 50
_DEFAULT_PORTS = frozenset({("http", 80), ("https", 443)})
# Tracking and session parameters: the same page under another name.
_DROPPED_KEYS = frozenset({"fbclid", "gclid", "sessionid", "jsessionid", "phpsessid"})

# A query item; a value of None is a bare key such as "?print".
_QueryItem = tuple[str, str | None]


def canonicalize_url(url: str) -> tuple[str, str] | None:
    """``(canonical_url, host)``, or ``None`` when ``url`` is not a web address.

    Lowercases the scheme and host, drops the default port, ``..`` segments, the fragment and
    tracking parameters, and sorts the query: ``HTTPS://A.vn:443/x/../y?b=2&a=1#top`` becomes
    ``https://a.vn/y?a=1&b=2``. Any port is accepted, since a group may serve a site on its own.
    """
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"} or parts.hostname is None:
        return None
    if parts.username or parts.password:
        return None
    host = parts.hostname.lower().rstrip(".")
    if not host:
        return None
    netloc = f"[{host}]" if ":" in host else host
    if port is not None and (scheme, port) not in _DEFAULT_PORTS:
        netloc = f"{netloc}:{port}"
    items = _query_items(parts.query)
    if len(items) > _MAX_QUERY_PAIRS:
        return None
    kept = [(key, value) for key, value in items if not _dropped(key)]
    return urlunsplit((scheme, netloc, _normalized_path(parts.path), _encode_query(kept), "")), host


def _dropped(key: str) -> bool:
    lowered = key.lower()
    return lowered in _DROPPED_KEYS or lowered.startswith("utm_")


def _normalized_path(raw_path: str) -> str:
    path = normpath("/" + raw_path.lstrip("/"))
    if raw_path.endswith("/") and not path.endswith("/"):
        path += "/"
    return "/" if path == "/." else path


def _query_items(query: str) -> list[_QueryItem]:
    items: list[_QueryItem] = []
    for raw in query.split("&"):
        if not raw:
            continue
        key, separator, value = raw.partition("=")
        items.append((unquote_plus(key), unquote_plus(value) if separator else None))
    return items


def _encode_query(items: list[_QueryItem]) -> str:
    """Encode sorted items, keeping bare keys bare and "/" readable."""
    ordered = sorted(items, key=lambda item: (item[0], item[1] is not None, item[1] or ""))
    return "&".join(
        quote_plus(key, safe="/")
        if value is None
        else f"{quote_plus(key, safe='/')}={quote_plus(value, safe='/')}"
        for key, value in ordered
    )
