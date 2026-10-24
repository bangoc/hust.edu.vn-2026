"""Chuẩn hoá và lọc url."""
from urllib.parse import urljoin, urlsplit, urlunsplit

_DEFAULT_PORTS = {"http": 80, "https": 443}
# Đuôi tệp không cần thu thập (ảnh/video/âm thanh... tuỳ nhóm, có thể bỏ bớt).
_SKIP_SUFFIXES = (".css", ".js", ".ico", ".woff", ".woff2", ".ttf", ".mp4", ".mp3", ".avi")


def normalize(raw: str, base: str | None = None) -> str | None:
    """Trả về url tuyệt đối đã chuẩn hoá, hoặc None nếu không phải http/https hợp lệ.

    - ghép url tương đối với trang nguồn (base)
    - hạ chữ thường scheme + host, bỏ cổng mặc định, bỏ phần #fragment
    - đường dẫn rỗng -> "/"
    """
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not raw or raw.startswith(("#", "mailto:", "javascript:", "tel:", "data:")):
        return None
    if base:
        raw = urljoin(base, raw)
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname or parts.username or parts.password:
        return None
    host = parts.hostname.lower().rstrip(".")
    netloc = host if port in (None, _DEFAULT_PORTS[scheme]) else f"{host}:{port}"
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, parts.query, ""))


def dedup_key(url: str) -> str:
    """Khoá so trùng: coi http/https, 'www.' và dấu '/' cuối là như nhau."""
    parts = urlsplit(url)
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path.rstrip("/") or "/"
    return f"{host}{path}" + (f"?{parts.query}" if parts.query else "")


def in_domain(url: str, domain: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host == domain or host.endswith("." + domain)


def worth_crawling(url: str) -> bool:
    return not urlsplit(url).path.lower().endswith(_SKIP_SUFFIXES)
