from __future__ import annotations

from mediator.domain.controller.kinds import url_kind


def test_url_kind() -> None:
    assert url_kind("https://hust.edu.vn/") == "hub"
    assert url_kind("https://hust.edu.vn") == "hub"
    assert url_kind("https://hust.edu.vn/files/QD.PDF") == "document"
    assert url_kind("https://hust.edu.vn/files/data.csv?v=2") == "document"
    assert url_kind("https://hust.edu.vn/tin-tuc/a") == "page"
