"""Mô-đun Tổng hợp dữ liệu (merger).

Luồng xử lý:
  Đọc nội dung --POST /add--> merger
      ├─ bản ghi (url, format, title, content, out-links) --> Lưu trữ  POST /add
      └─ url mới (lọc miền hust.edu.vn, bỏ url đã có)      --> Điều khiển POST /add {"urls": [...]}
Khi khởi động, merger nạp tập url mầm (seeds.txt) và gửi sang Điều khiển.
"""
import logging
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import unquote, urlsplit

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import config
from .forwarder import Forwarder
from .store import Store
from .urls import dedup_key, in_domain, normalize, worth_crawling

logging.basicConfig(
    level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("merger")


# ------------------------------------------------------------------ models
class OutLink(BaseModel):
    url: str
    text: str = ""


class AddRequest(BaseModel):
    """Dữ liệu từ mô-đun Đọc nội dung. Trường lạ được giữ lại nhưng không gửi đi."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    url: str
    format: str = "html"
    title: str | None = None
    content: str | None = None
    out_links: list[OutLink] = Field(default_factory=list, alias="out-links")

    @field_validator("out_links", mode="before")
    @classmethod
    def _flexible_links(cls, v: Any) -> list[dict]:
        """Chấp nhận nhiều dạng out-links mà các nhóm hay gửi:
        [{"url","text"}] | [["url","text"]] | ["url", ...] | null
        """
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("out-links phải là một mảng")
        out = []
        for item in v:
            if isinstance(item, dict):
                out.append({"url": item.get("url") or item.get("href") or "",
                            "text": item.get("text") or item.get("anchor") or ""})
            elif isinstance(item, (list, tuple)) and item:
                out.append({"url": str(item[0]), "text": str(item[1]) if len(item) > 1 else ""})
            elif isinstance(item, str):
                out.append({"url": item, "text": ""})
        return out


class UrlsRequest(BaseModel):
    urls: list[str]


# ------------------------------------------------------------------ app
store: Store
forwarder: Forwarder


@asynccontextmanager
async def lifespan(_: FastAPI):
    global store, forwarder
    store = Store(config.DB_PATH)
    forwarder = Forwarder(store)
    forwarder.start()
    seeds = _load_seed_file(config.SEED_FILE)
    if seeds:
        r = submit_urls(seeds, source="seed")
        log.info("nạp %d url mầm từ %s, %d url mới gửi Điều khiển", len(seeds), config.SEED_FILE, r["new"])
    log.info("merger chạy tại %s:%s | storage=%s | controller=%s",
             config.HOST, config.PORT, config.STORAGE_URL, config.CONTROLLER_URL)
    yield
    forwarder.stop()


app = FastAPI(title="HUST crawler - Tổng hợp dữ liệu (merger)", version="1.0.0", lifespan=lifespan)


def _load_seed_file(path: str) -> list[str]:
    if not path or not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.lstrip().startswith("#")]


def filter_new(raw_urls: list[str], base: str | None, source: str | None) -> tuple[list[str], dict]:
    """Chuẩn hoá -> lọc miền -> bỏ trùng trong lô -> bỏ url đã có. Trả về (url mới, thống kê)."""
    counts = {"received": len(raw_urls), "invalid": 0, "out_of_domain": 0, "skipped_type": 0}
    batch: dict[str, str] = {}
    for raw in raw_urls:
        url = normalize(raw, base)
        if not url:
            counts["invalid"] += 1
        elif not in_domain(url, config.ALLOWED_DOMAIN):
            counts["out_of_domain"] += 1
        elif not worth_crawling(url):
            counts["skipped_type"] += 1
        else:
            batch.setdefault(dedup_key(url), url)
    new = store.add_new_urls(list(batch.items()), source)
    counts["already_seen"] = len(batch) - len(new)
    counts["new"] = len(new)
    return new, counts


def submit_urls(raw_urls: list[str], base: str | None = None, source: str | None = None) -> dict:
    new, counts = filter_new(raw_urls, base, source)
    step = max(1, config.CONTROLLER_BATCH)
    for i in range(0, len(new), step):
        store.enqueue("controller", {"urls": new[i:i + step]})
    if new:
        forwarder.kick()
    return counts


def _fallback_title(url: str) -> str:
    name = unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])
    return name or url


# ------------------------------------------------------------------ endpoints
@app.post("/add")
def add(req: AddRequest) -> dict:
    """Nhận kết quả bóc tách từ mô-đun Đọc nội dung."""
    url = normalize(req.url)
    if not url:
        raise HTTPException(400, "url phải là địa chỉ http/https tuyệt đối")
    fmt = (req.format or "html").strip().lower()

    # 1) bản ghi -> Lưu trữ
    first_time = store.mark_page(dedup_key(url), url, fmt)
    links = []
    for link in req.out_links:
        link_url = normalize(link.url, url)
        if link_url:
            links.append({"url": link_url, "text": (link.text or "").strip()})

    storage_status = "queued"
    content = (req.content or "").strip()
    if not first_time and config.SKIP_DUPLICATE_PAGES:
        storage_status = "duplicate_skipped"
    elif not content:
        storage_status = "empty_content_skipped"  # Lưu trữ yêu cầu content không rỗng
    else:
        store.enqueue("storage", {
            "url": url,
            "format": fmt,
            "title": (req.title or "").strip() or _fallback_title(url),
            "content": content,
            "out-links": links,
        })
        forwarder.kick()

    # 2) url mới -> Điều khiển
    url_counts = submit_urls([lk["url"] for lk in links], source=url)
    return {"status": "ok", "url": url, "storage": storage_status, "links": url_counts}


@app.post("/urls")
def add_urls(req: UrlsRequest) -> dict:
    """Thêm url mầm / url bất kỳ: lọc, bỏ trùng rồi gửi sang Điều khiển."""
    return {"status": "ok", **submit_urls(req.urls, source="manual")}


@app.post("/seed")
def reload_seed() -> dict:
    """Nạp lại tệp url mầm (SEED_FILE)."""
    seeds = _load_seed_file(config.SEED_FILE)
    return {"status": "ok", "file": config.SEED_FILE, **submit_urls(seeds, source="seed")}


@app.get("/ping")
def ping() -> dict:
    return {"status": "đang chạy", "module": "merger"}


@app.get("/stats")
def stats() -> dict:
    return {**store.stats(), "storage": config.STORAGE_URL, "controller": config.CONTROLLER_URL,
            "domain": config.ALLOWED_DOMAIN}


@app.get("/failed")
def failed(limit: int = 50) -> dict:
    """Các lần gửi đã bỏ cuộc (bên nhận từ chối hoặc hết số lần thử)."""
    return {"items": store.failed(limit)}


@app.post("/retry-failed")
def retry_failed() -> dict:
    n = store.requeue_dead()
    forwarder.kick()
    return {"status": "ok", "requeued": n}


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    run()
