import pytest

from mediator.domain.shared.url import canonicalize_url


def test_one_spelling_per_url() -> None:
    assert canonicalize_url("HTTPS://EXAMPLE.COM:443/a/../b?utm_source=x&z=2&a=1#top") == (
        "https://example.com/b?a=1&z=2",
        "example.com",
    )


def test_tracking_parameters_do_not_create_distinct_urls() -> None:
    first = canonicalize_url("https://a.test/news?id=7&utm_source=x&PHPSESSID=1")
    second = canonicalize_url("https://a.test/news?fbclid=y&id=7")
    assert first == second == ("https://a.test/news?id=7", "a.test")


def test_non_default_port_is_kept() -> None:
    assert canonicalize_url("http://127.0.0.1:5000/a") == ("http://127.0.0.1:5000/a", "127.0.0.1")
    assert canonicalize_url("http://[::1]:8000/") == ("http://[::1]:8000/", "::1")


@pytest.mark.parametrize(
    "url",
    [
        "mailto:x@hust.edu.vn",
        "ftp://hust.edu.vn/a",
        "https://user:secret@example.com/",
        "https://example.com:99999/",
        "https:///no-host",
        "not a url",
        "https://a.test/?" + "&".join(f"k{i}=1" for i in range(51)),
    ],
)
def test_not_a_web_address(url: str) -> None:
    assert canonicalize_url(url) is None


@pytest.mark.parametrize(
    "url",
    ["https://a.test/x?abc", "https://a.test/index.php?/news/1", "https://a.test/x?a=1&flag"],
)
def test_canonicalize_keeps_valueless_keys_and_slashes(url: str) -> None:
    assert canonicalize_url(url) == (url, "a.test")
