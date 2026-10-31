# Hướng dẫn cài đặt và triển khai

Tài liệu này hướng dẫn chạy dịch vụ tải nội dung (`content-downloader`) trên máy phát
triển và triển khai production bằng Docker Compose. API, manifest và object đều nằm trong
phạm vi module này; dịch vụ không gọi module đọc nội dung, không ghi MongoDB và không quyết
định URL kế tiếp.

## 1. Kiến trúc triển khai

```text
Client / orchestrator
        |
        | HTTP :8800
        v
content-downloader  --->  MinIO :9000 (S3 API, bucket private)
        |                        |
        |                        +-- raw/{sha256}          nội dung gốc
        |                        +-- index/url/{urlKey}.json manifest
        |
        +-- Chromium headless (render HTML)
        +-- HTTP stream (PDF, DOCX, XLSX, PPTX, ...)
```

Thành phần tối thiểu:

- `content-downloader`: API Express, queue trong bộ nhớ, Puppeteer và HTTP downloader.
- `minio`: object storage và manifest.
- Reverse proxy có TLS nếu dịch vụ được gọi từ ngoài mạng nội bộ.

## 2. Yêu cầu hệ thống

- Docker Engine 24+ và Docker Compose v2.
- Linux x86_64 hoặc arm64; 2 vCPU, tối thiểu 2 GB RAM, 10 GB dung lượng trống.
- Cổng mặc định: `8800` (API), `9000` (MinIO S3), `9001` (MinIO console).
- Tên miền và chứng chỉ TLS nếu public API.
- Node.js >= 22.12 nếu chạy trực tiếp không qua Docker.

Kiểm tra môi trường:

```bash
docker --version
docker compose version
```

## 3. Lấy mã nguồn

```bash
git clone https://github.com/cuongngungok17/information_seeking_20262.git
cd information_seeking_20262
git checkout long-N5
cd src/downloader
```

## 4. Cấu hình

Tạo file `.env` từ mẫu:

```bash
cp .env.example .env
chmod 600 .env
```

Sinh secret mạnh:

```bash
openssl rand -base64 32
```

Các biến quan trọng cho production:

| Biến | Ý nghĩa | Gợi ý production |
|---|---|---|
| `MINIO_ROOT_USER` | Tài khoản MinIO, đồng thời là S3 access key trong compose hiện tại | Chuỗi riêng, không dùng `minioadmin` |
| `MINIO_ROOT_PASSWORD` | Mật khẩu MinIO / S3 secret key | Tối thiểu 16 ký tự ngẫu nhiên |
| `S3_BUCKET` | Bucket chứa object và manifest | `hust-raw` hoặc tên riêng |
| `S3_ENDPOINT` | Endpoint nội bộ container dùng để ghi/đọc | `http://minio:9000` |
| `S3_PUBLIC_ENDPOINT` | Endpoint dùng để ký presigned URL | URL client thực sự truy cập, ví dụ `https://s3.example.com` |
| `PRESIGN_TTL_SECONDS` | Thời hạn presigned URL | `300`–`900` |
| `ALLOWED_DOMAINS` | Danh sách domain được phép tải, phân tách bằng dấu phẩy | `hust.edu.vn,soict.hust.edu.vn` |
| `RESPECT_ROBOTS` | Kiểm tra robots.txt | `true` nếu được phép và đã kiểm tra nguồn |
| `MAX_FILE_BYTES` | Giới hạn file | `20971520` (20 MB) |
| `MAX_HTML_BYTES` | Giới hạn HTML sau render | `5242880` (5 MB) |
| `MAX_CONCURRENT` | Số job tải song song | `2` cho 2 vCPU |
| `QUEUE_SIZE` | Số job chờ tối đa | `20` |
| `PROBE_MODE` | Có HEAD trước khi tải hay không | `auto`; dùng `always` nếu cần render cả URL `.pdf` trả HTML |
| `AUTH_LOGIN_PATH_SEGMENTS` | Các segment path coi là trang login | Danh sách mặc định, bổ sung path SSO nội bộ nếu có |
| `LOG_LEVEL` | Mức log | `info` |

Lưu ý về credential trong `docker-compose.yml` hiện tại:

```yaml
S3_ACCESS_KEY: ${MINIO_ROOT_USER:-minioadmin}
S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-minioadmin}
```

Vì vậy `S3_ACCESS_KEY` và `S3_SECRET_KEY` đang lấy từ tài khoản root của MinIO. Nếu dùng
MinIO bên ngoài hoặc muốn tách credential, sửa phần `environment` trong compose (hoặc dùng
file override) để trỏ tới user S3 riêng đã được cấp quyền trên bucket.

`S3_PUBLIC_ENDPOINT` là giá trị được đưa vào chữ ký presigned URL. Nó phải trùng chính xác
scheme, host và port mà client dùng để gọi MinIO. Nếu đổi endpoint sau khi đã phát URL, các
URL cũ sẽ không còn hợp lệ.

## 5. Cài đặt và chạy bằng Docker Compose

### 5.1. Build và khởi động

```bash
cd src/downloader
docker compose build
docker compose up -d
docker compose ps
```

Kỳ vọng:

- `content-downloader` ở trạng thái `Up (healthy)`.
- `minio` ở trạng thái `Up`.
- API lắng nghe tại `http://localhost:8800`.

### 5.2. Kiểm tra sức khỏe

```bash
curl -fsS http://localhost:8800/ping
curl -fsS http://localhost:8800/stats
```

`/ping` trả một trong các trạng thái `đang chờ`, `đang tải`, `đang bận`. `/stats` trả
counter job và trạng thái browser pool.

### 5.3. Gửi thử một URL

```bash
BASE=http://localhost:8800

curl -fsS -X POST "$BASE/load" \
  -H 'content-type: application/json' \
  -d '{"url":"https://hust.edu.vn/vi/news/tin-tuc-su-kien/"}'
```

Lấy `job_id` từ response rồi kiểm tra:

```bash
curl -fsS "$BASE/jobs/<job_id>"
```

Khi job `done`, response có `content_ref`. Kiểm tra presigned URL:

```bash
curl -fsS -r 0-0 -o /dev/null -w '%{http_code}\n' "<content_ref>"
```

Kỳ vọng `200` hoặc `206`. Bucket là private: gọi URL trần không có chữ ký phải trả `403`.

### 5.4. Xem log

```bash
docker compose logs -f --tail=200 content-downloader
docker compose logs -f --tail=200 minio
```

Không log body, byte nội dung, presigned URL hay secret.

## 6. Reverse proxy, TLS và bảo vệ API

API hiện **không có lớp xác thực người gọi**. Không mở `8800` trực tiếp ra Internet nếu
chưa đặt sau proxy có xác thực và rate limit; nếu không, bất kỳ ai cũng có thể dùng dịch vụ
làm fetcher.

Ví dụ Nginx cho API:

```nginx
limit_req_zone $binary_remote_addr zone=downloader_api:10m rate=10r/s;

server {
    listen 443 ssl http2;
    server_name downloader.example.com;

    ssl_certificate     /etc/letsencrypt/live/downloader.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/downloader.example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        limit_req zone=downloader_api burst=20 nodelay;
        proxy_pass http://127.0.0.1:8800;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Ví dụ Nginx cho MinIO S3 endpoint dùng bởi presigned URL:

```nginx
server {
    listen 443 ssl http2;
    server_name s3.example.com;

    ssl_certificate     /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

Sau đó đặt:

```env
S3_PUBLIC_ENDPOINT=https://s3.example.com
```

Yêu cầu quan trọng:

- Giữ nguyên header `Host` khi proxy tới MinIO; chữ ký presigned tính cả host.
- Không public MinIO console (`9001`). Chỉ mở qua SSH tunnel khi cần:
  `ssh -L 9001:127.0.0.1:9001 user@server`.
- Chỉ mở `80/443` ra ngoài; chặn `8800`, `9000`, `9001` bằng firewall.
- Nếu reverse proxy chạy trên cùng máy, đổi port mapping trong compose thành
  `127.0.0.1:8800:8800`, `127.0.0.1:9000:9000`, `127.0.0.1:9001:9001` để các cổng này
  không lắng nghe trên mọi interface.
- Nếu trình duyệt gọi trực tiếp presigned URL, cấu hình CORS cho bucket. Gọi server-to-server
  thì không cần CORS.

## 7. Chạy hai instance

```bash
docker compose --profile two-instances up -d
```

Kết quả:

- Instance chính: `http://localhost:8800`.
- Instance phụ: `http://localhost:8801`.
- Cả hai dùng chung MinIO, manifest và object.

Giới hạn cần biết:

- Queue và trạng thái job nằm trong bộ nhớ từng instance. `GET /jobs/:id` phải gọi đúng
  instance đã nhận job; gọi sang instance còn lại sẽ trả `404`. Nếu đặt load balancer, cần
  sticky session theo `job_id` hoặc chỉ dùng một instance cho luồng submit/poll.
- Dedup in-flight chỉ trong một instance. Hai instance có thể cùng tải một URL; object
  content-addressed ngăn ghi trùng nhưng vẫn tốn băng thông.
- Manifest ghi sau cùng thắng nếu hai instance cùng cập nhật một `urlKey`.

## 8. Giới hạn tài nguyên và log rotation

Nên dùng file override riêng thay vì sửa compose gốc:

```yaml
# compose.prod.yml
services:
  content-downloader:
    mem_limit: 1536m
    cpus: 2.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  content-downloader-replica:
    mem_limit: 1536m
    cpus: 2.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Chạy:

```bash
docker compose -f docker-compose.yml -f compose.prod.yml up -d
```

`shm_size: 512mb` đã được đặt trong compose gốc cho Chromium. Không hạ thấp giá trị này nếu
render nhiều trang nặng.

## 9. Nâng cấp và rollback

### 9.1. Nâng cấp

```bash
cd src/downloader
git fetch origin
git checkout long-N5
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost:8800/ping
```

### 9.2. Gắn tag phiên bản

Image mặc định là `hust-content-downloader:local`. Khi phát hành, nên tag theo phiên bản và
đẩy lên registry:

```bash
docker tag hust-content-downloader:local \
  registry.example.com/hust-content-downloader:1.0.0
docker push registry.example.com/hust-content-downloader:1.0.0
```

Trên server, trỏ compose tới tag đã phát hành rồi:

```bash
docker compose pull
docker compose up -d
```

Rollback bằng cách đổi về tag trước đó và chạy lại `docker compose up -d`. Giữ ít nhất một
tag gần nhất trên registry hoặc trên máy deploy.

### 9.3. Triển khai offline

Trên máy build:

```bash
docker compose build
docker save hust-content-downloader:local | gzip > content-downloader-image.tar.gz
```

Copy `content-downloader-image.tar.gz`, `docker-compose.yml` và `.env` lên server, sau đó:

```bash
gunzip -c content-downloader-image.tar.gz | docker load
docker compose up -d --no-build
```

## 10. Backup và restore

Dữ liệu quan trọng nằm trong volume `hust-downloader_minio-data` (tên volume có thể khác
nếu đổi `name:` trong compose). Kiểm tra:

```bash
docker volume ls | grep hust-downloader
```

Backup khi đã dừng ghi:

```bash
docker compose stop content-downloader minio
mkdir -p backups

docker run --rm \
  -v hust-downloader_minio-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine sh -c 'tar czf /backup/minio-$(date +%F-%H%M).tgz -C /data .'

docker compose start minio
docker compose start content-downloader
```

Restore là thao tác ghi đè, chỉ làm khi đã xác nhận đúng file backup:

```bash
docker compose down

docker run --rm \
  -v hust-downloader_minio-data:/data \
  -v "$PWD/backups":/backup \
  alpine sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/<file>.tgz -C /data'

docker compose up -d
```

Manifest và object được backup cùng nhau để giữ `objectKey` và `sha256` khớp nhau. Nếu chỉ
restore một phần, URL có manifest trỏ tới object không tồn tại sẽ trả lỗi khi tải.

## 11. Chạy trực tiếp bằng Node

Phù hợp cho máy phát triển hoặc máy chủ nhỏ đã có sẵn Chromium.

```bash
cd src/downloader
npm ci --omit=dev
cp .env.example .env
# Sửa .env: S3_ENDPOINT trỏ tới MinIO đang chạy, CHROME_BIN trỏ tới Chromium
npm start
```

Ví dụ systemd unit tối giản:

```ini
[Unit]
Description=HUST content downloader
After=network-online.target

[Service]
Type=simple
User=downloader
WorkingDirectory=/opt/content-downloader
EnvironmentFile=/etc/content-downloader.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/content-downloader
MemoryMax=1536M

[Install]
WantedBy=multi-user.target
```

Kiểm tra `CHROME_BIN` và quyền ghi của user `downloader` trước khi bật service. Với cách
chạy này, cần tự quản lý MinIO, TLS, backup và log rotation.

## 12. Kiểm thử trước khi phát hành

```bash
cd src/downloader

npm test                 # unit + integration, không cần Docker/Chrome/mạng ngoài
docker compose up -d minio
npm run test:s3          # MinIO thật
npm run test:coverage    # coverage; chạy tuần tự để tránh timeout giả
```

Smoke test thủ công tối thiểu:

```bash
BASE=http://localhost:8800
curl -fsS "$BASE/ping"
curl -fsS "$BASE/stats"

JOB_ID=$(curl -fsS -X POST "$BASE/load" \
  -H 'content-type: application/json' \
  -d '{"url":"https://hust.edu.vn/vi/news/tin-tuc-su-kien/"}' \
  | sed -n 's/.*"job_id":"\([^"]*\)".*/\1/p')

curl -fsS "$BASE/jobs/$JOB_ID"
```

Kiểm tra thêm bằng một file PDF và một file DOCX thật. Với file đã tải một lần, gửi lại
cùng URL và kỳ vọng `not_modified: true` nếu nguồn trả validator ổn định.

## 13. Troubleshooting

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Container `unhealthy` | API chưa lên, Chrome thiếu, sai `PORT` | `docker compose logs content-downloader`; kiểm tra `/ping` |
| `render_error` | `CHROME_BIN` sai, Chromium không chạy, hết RAM/shm | Kiểm tra `/stats` trường `connected`; tăng `shm_size`/RAM |
| `blocked_host` | DNS ra IP nội bộ hoặc host không nằm trong `ALLOWED_DOMAINS` | Kiểm tra DNS và allowlist |
| `queue_full` (503) | Số job chờ vượt `QUEUE_SIZE` | Giảm tải, tăng `QUEUE_SIZE`/`MAX_CONCURRENT` hoặc scale |
| Presigned URL trả 403 | Hết TTL, lệch đồng hồ, `S3_PUBLIC_ENDPOINT` không khớp host thật | Đổi đúng endpoint, đồng bộ NTP, xin URL mới |
| Gọi URL trần vào bucket trả 403 | Bucket private (đúng thiết kế) | Dùng `content_ref` được ký |
| `GET /jobs/:id` trả 404 ở instance khác | Job nằm trong bộ nhớ instance nhận request | Gọi đúng instance hoặc dùng sticky session |
| Tải lại vẫn báo `not_modified` dù nội dung đổi | Nguồn giữ nguyên ETag/Last-Modified | Dùng `"force": true` hoặc kiểm tra validator của nguồn |
| Job `failed` với `auth_required: true` | Nguồn trả HTTP 401 hoặc redirect tới path login; `final_url` là trang login | Không bypass; dùng nguồn công khai/API được cấp quyền hoặc bổ sung `AUTH_LOGIN_PATH_SEGMENTS` nếu path login của đơn vị khác |
| Job `done` nhưng `manifest_invalid: true` | Manifest cũ hỏng/sai schema trong MinIO; job đã tải lại | Kiểm tra log `download_manifest_invalid`; không cần xử lý thủ công |
| Log tăng nhanh | Chưa cấu hình rotation | Dùng `logging` trong `compose.prod.yml` |

## 14. Checklist trước khi mở dịch vụ

- [ ] Đã đổi `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`; `.env` có quyền `600`.
- [ ] `.env`, secret, `node_modules`, coverage không nằm trong git.
- [ ] Bucket private; app tự tạo bucket và xoá policy public khi khởi động.
- [ ] `9000`/`9001` không public; chỉ mở qua VPN/SSH tunnel.
- [ ] API đặt sau TLS và lớp xác thực/rate limit.
- [ ] `ALLOWED_DOMAINS` được giới hạn theo nguồn thực tế.
- [ ] Đã chọn `PROBE_MODE` phù hợp (`auto` mặc định, `always` nếu cần render mọi URL).
- [ ] Đã bổ sung `AUTH_LOGIN_PATH_SEGMENTS` nếu nguồn dùng path login riêng.
- [ ] Cân nhắc bật `RESPECT_ROBOTS=true`.
- [ ] `S3_PUBLIC_ENDPOINT` khớp URL client dùng; đã kiểm tra presigned URL.
- [ ] Có backup volume MinIO và đã thử restore trên môi trường staging.
- [ ] Có log rotation, giám sát dung lượng đĩa và `/stats`.
- [ ] Nếu chạy nhiều instance, đã xử lý sticky session cho `GET /jobs/:id`.
