"""Cấu hình đọc từ biến môi trường (xem .env.example)."""
import os


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


# Địa chỉ mà merger lắng nghe. 0.0.0.0 = mở cho các máy khác trong mạng truy cập.
HOST = _env("MERGER_HOST", "0.0.0.0")
PORT = _int("MERGER_PORT", 3000)

# Mô-đun Lưu trữ (N10): POST {STORAGE_URL}/add
STORAGE_URL = _env("STORAGE_URL", "http://localhost:2222").rstrip("/")
# Mô-đun Điều khiển (BAT): POST {CONTROLLER_URL}/add  body {"urls": [...]}
CONTROLLER_URL = _env("CONTROLLER_URL", "http://localhost:5200").rstrip("/")

# Miền được phép thu thập: chính miền này và mọi miền con của nó.
ALLOWED_DOMAIN = _env("ALLOWED_DOMAIN", "hust.edu.vn").lower()

# CSDL SQLite lưu tập url đã thấy + hàng đợi gửi đi (giữ qua các lần khởi động lại).
DB_PATH = _env("MERGER_DB", "data/merger.db")

# Tệp url mầm, mỗi dòng một url, nạp và gửi sang Điều khiển khi khởi động.
SEED_FILE = _env("SEED_FILE", "seeds.txt")

# Gửi đi: thời gian chờ mỗi request, số lần thử tối đa, số url mỗi gói gửi Điều khiển.
HTTP_TIMEOUT = float(_env("HTTP_TIMEOUT", "10"))
MAX_ATTEMPTS = _int("MAX_ATTEMPTS", 10)
CONTROLLER_BATCH = _int("CONTROLLER_BATCH", 100)

# Nếu một trang (url) đã được gửi sang lưu trữ rồi thì bỏ qua lần gửi sau (1) hay vẫn gửi lại (0).
SKIP_DUPLICATE_PAGES = _env("SKIP_DUPLICATE_PAGES", "1") == "1"

LOG_LEVEL = _env("LOG_LEVEL", "INFO")
