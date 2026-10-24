#!/usr/bin/env bash
# Xuất các url mediator đã nhận và đã gửi sang downloader, vào thư mục out/:
#   out/urls.csv      mọi url trong hàng đợi (giờ Việt Nam)
#   out/nhan_gui.log  log đã nhận / đã gửi / lỗi, lấy từ /state/mediator.log trên volume
# Chạy khi container mediator đang chạy:  ./export_urls.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out

docker compose exec -T mediator python - > out/urls.csv <<'EOF'
import csv, sqlite3, sys
from datetime import datetime, timedelta, timezone

VN = timezone(timedelta(hours=7))


def vn_time(seconds):
    return datetime.fromtimestamp(seconds, VN).strftime("%Y-%m-%d %H:%M:%S") if seconds else ""


db = sqlite3.connect("/state/controller.sqlite3")
out = csv.writer(sys.stdout)
out.writerow(["url", "host", "loai", "trang_thai", "gui_luc", "han_gui_tiep", "so_lan_loi"])
rows = db.execute(
    "SELECT url, host, kind, next_due_at, last_sent_at, attempts FROM urls"
    " ORDER BY last_sent_at IS NULL, last_sent_at"
)
for url, host, kind, due, sent, attempts in rows:
    status = "đã gửi" if sent else "chưa gửi"
    out.writerow([url, host, kind, status, vn_time(sent), vn_time(due), attempts])
EOF

docker compose exec -T mediator cat /state/mediator.log \
    | grep -vE "tổng:|mediator chạy" > out/nhan_gui.log || true

echo "out/urls.csv: $(($(wc -l < out/urls.csv) - 1)) url" \
    "($(grep -c ',đã gửi,' out/urls.csv || true) đã gửi)"
echo "out/nhan_gui.log: $(wc -l < out/nhan_gui.log) dòng"
