# Hướng dẫn build, sử dụng và tích hợp dịch vụ tải nội dung

Tài liệu cho nhóm phụ trách khối **Tải về** và các nhóm cần gọi sang khối này (Điều khiển, Đọc nội dung). Chi tiết vận hành production (TLS, backup, systemd) xem [DEPLOYMENT.md](DEPLOYMENT.md); mô tả kiến trúc code xem [README.md](README.md).

Mọi lệnh dưới đây đã chạy thử trên Windows 11 + Docker Desktop 29.1 với code commit `2fef195` (ngày 24/10/2026). Đã chạy: `npm test` (165/165 pass), build image, 2 bản Tải về + MinIO, bộ Postman ở mục 3 (83/83 assertion đạt, chạy 2 lần liên tiếp), mở `content_ref` từ một container khác, client mẫu cho Điều khiển.

Mục lục: [1. Build](#1-build-và-chạy-service) · [2. Sử dụng](#2-sử-dụng-api) · [3. Kiểm thử bằng Postman](#3-kiểm-thử-bằng-postman) · [4. Tích hợp](#4-tích-hợp-với-các-nhóm-khác) · [5. Sự cố thường gặp](#5-sự-cố-thường-gặp)

---

## 1. Build và chạy service

### 1.1 Chuẩn bị

| Cần có | Kiểm tra |
|---|---|
| Docker Desktop đang chạy (biểu tượng cá voi màu xanh) | `docker info` không báo lỗi `failed to connect` |
| Docker Compose v2 | `docker compose version` |
| ~2 GB RAM trống, ~2 GB ổ đĩa (image 1,45 GB) | |
| Node.js ≥ 22.12 (chỉ cần nếu chạy test hoặc chạy không qua Docker) | `node -v` |

Lấy code:

```powershell
git fetch origin
git checkout long-N5        # nhánh phát triển dịch vụ; thang có cùng code sau khi đã gộp và push
git pull
cd src/downloader
```

### 1.2 Tạo file cấu hình `.env`

```powershell
Copy-Item .env.example .env
```

Docker Compose tự đọc file `.env` trong thư mục `src/downloader`. Sửa các biến sau (các biến khác giữ mặc định):

| Biến | Giá trị nên đặt | Vì sao |
|---|---|---|
| `S3_PUBLIC_ENDPOINT` | `http://<IP-LAN-máy-mình>:9000` | Link `content_ref` được ký theo địa chỉ này. Để `localhost` thì **chỉ máy mình mở được**, nhóm khác sẽ không tải được nội dung (xem 4.4) |
| `ALLOWED_DOMAINS` | `hust.edu.vn` | Mặc định rỗng là tải mọi domain. Giá trị này cho phép mọi subdomain `*.hust.edu.vn` |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | đổi nếu chạy demo chung mạng | Mặc định `minioadmin/minioadmin` |
| `RESPECT_ROBOTS` | `true` khi chạy thu thập thật | Mặc định tắt |
| `PROBE_MODE` | giữ `auto` | `auto`: bỏ bước HEAD với URL có đuôi tài liệu (`.pdf`, `.docx`…) để đỡ 1 request. `always`: HEAD mọi URL (URL `.pdf` mà máy chủ trả HTML vẫn được render bằng Chrome). `never`: không HEAD |
| `AUTH_LOGIN_PATH_SEGMENTS` | giữ mặc định | Các đoạn đường dẫn coi là trang đăng nhập (`login`, `dang-nhap`, `sso`…). Thêm vào nếu gặp trang login có đường dẫn khác |

Lấy IP LAN: chạy `ipconfig`, chọn IPv4 của card Wi‑Fi/Ethernet đang dùng (bỏ qua card `vEthernet`, `VMware`, `VirtualBox`).

### 1.3 Chạy test (không cần Docker, Chrome hay mạng)

```powershell
npm ci
npm test            # kỳ vọng: # pass 165, # fail 0
```

### 1.4 Build image và khởi động

```powershell
docker compose build                                  # lần đầu 3–5 phút, tạo image hust-content-downloader:local
docker compose --profile two-instances up -d          # MinIO + 2 bản Tải về
docker compose --profile two-instances ps
```

Kết quả mong đợi:

```
SERVICE                      STATUS                   PORTS
content-downloader           Up (healthy)             0.0.0.0:8800->8800/tcp
content-downloader-replica   Up (healthy)             0.0.0.0:8801->8800/tcp
minio                        Up                       0.0.0.0:9000-9001->9000-9001/tcp
```

| Thành phần | Địa chỉ |
|---|---|
| Bản Tải về 1 | `http://<ip>:8800` |
| Bản Tải về 2 | `http://<ip>:8801` |
| MinIO S3 (nơi chứa nội dung tải về) | `http://<ip>:9000` |
| MinIO Console (xem file bằng trình duyệt) | `http://localhost:9001`, đăng nhập bằng `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` |

Chỉ cần 1 bản thì bỏ `--profile two-instances`.

### 1.5 Các lệnh hằng ngày

```powershell
docker compose logs -f content-downloader              # xem log (JSON, event có tiền tố downloader_)
docker compose --profile two-instances restart         # khởi động lại sau khi sửa .env
docker compose --profile two-instances up -d --build   # build lại sau khi sửa code
docker compose --profile two-instances down            # dừng; dữ liệu MinIO vẫn giữ trong volume
docker compose --profile two-instances down -v         # dừng và XOÁ toàn bộ dữ liệu đã tải
```

### 1.6 Chạy không qua Docker (khi sửa code)

Vẫn cần MinIO chạy bằng Docker. Trên Windows phải trỏ `CHROME_BIN` tới Chrome, vì code chỉ tự dò đường dẫn Chrome của Linux/macOS:

```powershell
docker compose up -d minio
# trong .env:  CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe
#              S3_ENDPOINT=http://localhost:9000
npm start
```

---

## 2. Sử dụng API

Base URL: `http://<ip>:8800` (hoặc `:8801`). Request và response đều là JSON.

### 2.1 Tóm tắt

| API | Dùng để |
|---|---|
| `POST /load` | Gửi 1 URL cần tải. Trả `job_id` ngay (202), tải chạy nền |
| `GET /jobs/:job_id` | Xem kết quả: trạng thái, định dạng, link nội dung `content_ref` |
| `GET /ping` | Xem bản này rảnh hay bận (Điều khiển dùng để chia việc) |
| `GET /stats` | Thống kê số job, số byte, lỗi, trạng thái Chrome |

### 2.2 `POST /load`

```json
{"url": "https://hust.edu.vn/", "force": false}
```

- Chỉ nhận đúng 2 trường `url` và `force`. Gửi thêm trường khác (ví dụ `"wait"`) bị trả `400 invalid_request`.
- `force: true`: tải lại kể cả khi nội dung chưa đổi so với lần trước.

| Mã | Ý nghĩa | Body |
|---|---|---|
| **202** | Đã nhận | `{"job_id":"f307…","status":"queued","status_url":"/jobs/f307…","deduplicated":false}` |
| 202 + `deduplicated: true` | URL này đang được tải ở bản này rồi, trả lại job cũ | như trên |
| 400 | Body sai / URL sai / host bị chặn | `{"error":{"code":"invalid_request" \| "blocked_host" \| …,"message":"…"}}` |
| **503** | Hàng đợi đầy (2 job đang chạy + 20 job chờ) | `{"error":{"code":"queue_full",…}}` |

`blocked_host`: URL trỏ vào `localhost`, IP nội bộ, hoặc nằm ngoài `ALLOWED_DOMAINS`.

### 2.3 `GET /jobs/:job_id`

`status` đi theo thứ tự `queued` → `downloading` → `storing` → `done` hoặc `failed`.

Khi `done` (ví dụ thật với file PDF):

```json
{
  "job_id": "…",
  "status": "done",
  "url": "https://bktextile.hust.edu.vn/documents/71926/0/Chuong+trinh+…pdf/fab59942-…",
  "final_url": "https://bktextile.hust.edu.vn/documents/71926/0/Chuong+trinh+…pdf/fab59942-…",
  "format": "other",
  "extension": "pdf",
  "content_type": "application/pdf",
  "encoding": "ref",
  "content_ref": "http://192.168.1.50:9000/hust-raw/raw/fc39b4…?X-Amz-Signature=…",
  "size": 456106,
  "sha256": "fc39b4…",
  "http_status": 200,
  "fetched_at": "2026-10-24T09:40:12.000Z",
  "not_modified": false,
  "auth_required": false,
  "manifest_invalid": false,
  "content_changed": false,
  "duplicate_content": false,
  "error": null
}
```

| Trường | Cách dùng |
|---|---|
| `format` | `html` hoặc `other`, khớp với 2 loại đầu vào của Đọc nội dung ở slide |
| `extension` | Định dạng cụ thể: `html`, `pdf`, `docx`, `xlsx`, `pptx`, `txt`, `zip`… |
| `content_ref` | **Link để lấy nội dung**, hết hạn sau 15 phút (`PRESIGN_TTL_SECONDS=900`). Hết hạn thì gọi lại `GET /jobs/:id` để lấy link mới (job được giữ 1 giờ, `JOB_TTL_MS`) |
| `final_url` | URL sau chuyển hướng. Dùng làm gốc khi chuyển link tương đối thành tuyệt đối |
| `sha256` | Mã băm nội dung. Hai URL có cùng `sha256` là trùng nội dung |
| `not_modified`, `redownloaded`, `duplicate_content` | Lần tải lại: nội dung chưa đổi so với lần trước / đã có trong kho |
| `content_changed` | Lần tải lại: nội dung đã đổi |
| `manifest_invalid` | Thông tin lần tải trước bị hỏng, service đã bỏ qua và tải lại từ đầu. Bên gọi không cần làm gì |

Khi `failed`, xem `error.code`:

| `error.code` | Nghĩa | Bên gọi nên |
|---|---|---|
| `download_error` | Nguồn trả lỗi (404, 403, 500…), xem `error.message` | Bỏ URL. Lỗi tạm thời đã được service tự thử lại 3 lần |
| `auth_required` | Trang cần đăng nhập (nguồn trả 401, hoặc chuyển hướng tới đường dẫn kiểu `/login`). Kèm `auth_required: true`, **không lưu nội dung, không có `content_ref`** | Bỏ URL. `final_url` là trang login nếu nguồn chuyển hướng, là URL gốc nếu nguồn trả thẳng 401 |
| `robots_disallowed` | robots.txt cấm (khi bật `RESPECT_ROBOTS`) | Bỏ URL |
| `timeout`, `render_error`, `too_large`, `storage_error` | Hết giờ, Chrome lỗi, file vượt giới hạn, lỗi ghi MinIO | Ghi log, có thể gửi lại sau |

Ví dụ thật với `https://lms.hust.edu.vn/my/`:
`{"status":"failed","auth_required":true,"final_url":"https://lms.hust.edu.vn/my/","error":{"code":"auth_required","message":"Nguồn yêu cầu đăng nhập để truy cập nội dung"}}`

> **Lưu ý:** job chỉ nằm trong bộ nhớ của bản đã nhận nó. Gửi `/load` vào `:8800` thì phải hỏi `/jobs/:id` ở `:8800`; hỏi sang `:8801` sẽ nhận `404 not_found`.

### 2.4 `GET /ping`

```json
{"status": "đang chờ"}
```

| `status` | Nghĩa |
|---|---|
| `đang chờ` | Không có job nào |
| `đang tải` | Đang chạy job, còn nhận thêm được |
| `đang bận` | Cả 2 luồng đang chạy và có job phải chờ |

`đang bận` **chưa có nghĩa là hết chỗ** (hàng đợi vẫn còn chỗ đến khi đủ 20 job chờ). Bên gọi vẫn phải xử lý `503 queue_full` khi gửi `/load`.

### 2.5 Thử bằng tay

PowerShell (dùng `curl.exe`, không dùng alias `curl`):

```powershell
curl.exe -s http://localhost:8800/ping
curl.exe -s -X POST http://localhost:8800/load -H "content-type: application/json" -d '{\"url\":\"https://hust.edu.vn/\"}'
curl.exe -s http://localhost:8800/jobs/<job_id>
curl.exe -s -o trang.html "<content_ref>"          # tải nội dung về file
```

Git Bash:

```bash
curl -s -X POST localhost:8800/load -H 'content-type: application/json' -d '{"url":"https://hust.edu.vn/"}'
```

Gọi thẳng `http://<ip>:9000/hust-raw/...` không có chữ ký sẽ bị `403`. Đây là thiết kế đúng: bucket private, chỉ link `content_ref` mới mở được.

---

## 3. Kiểm thử bằng Postman

Bộ test có sẵn: [postman/hust-content-downloader.postman_collection.json](postman/hust-content-downloader.postman_collection.json). Có 40 request chia 7 thư mục, request nào cũng có script tự kiểm tra kết quả (tab **Test Results**).

### 3.1 Chuẩn bị

1. Chạy service (mục 1.4): `docker compose --profile two-instances up -d`.
2. Muốn chạy thư mục 7 (mock) thì mở thêm một cửa sổ terminal: `cd src/downloader` rồi `npm run mock:api`.
3. Postman: **Import** → chọn file collection ở trên.
4. Nếu Postman chạy ở máy khác với service: bấm vào collection → tab **Variables**, đổi `localhost` trong `base`, `base2`, `minio` thành IP máy chạy service. `content_ref` vẫn phải mở được từ máy đó (xem 4.4).

### 3.2 Chạy cả bộ (khuyên dùng)

Chuột phải collection → **Run collection** → **Run HUST Content Downloader**. Mất khoảng 25 giây.

Các request tên **"Chờ …"** tự hỏi lại `/jobs/:id` mỗi 1,5 giây cho tới khi job xong (tối đa 40 lần), nên trong kết quả Runner sẽ thấy chúng lặp vài lần. Kết quả mong đợi: mọi assertion màu xanh (đã chạy thử: 83/83).

### 3.3 Chạy tay từng request

Gửi theo thứ tự trong thư mục: **"Gửi …"** trước (lưu `job_id` vào biến), rồi **"Chờ …"**. Nếu Test Results báo *"Job chưa xong"* thì đợi vài giây rồi bấm **Send** lại. Request đọc nội dung (`{{ref_html}}`, `{{ref_pdf}}`) dùng link mà bước "Chờ …" vừa lưu, link chỉ sống 15 phút.

### 3.4 Nội dung bộ test

| Thư mục | Kiểm tra gì | Kết quả mong đợi |
|---|---|---|
| 1. Sức khỏe | `GET /ping` bản 8800, 8801; `GET /stats` | `200`, `status` ∈ đang chờ/đang tải/đang bận |
| 2. Trang HTML | Gửi `https://hust.edu.vn/` → chờ → mở `content_ref` | `done`, `format: html`, nội dung có `<html` |
| 3. File PDF | Gửi PDF (URL không có đuôi `.pdf` ở cuối) → chờ → mở `content_ref`; mở file **không có chữ ký** | `format: other`, `extension: pdf`, nội dung bắt đầu `%PDF`; không chữ ký → `403` |
| 4. File DOCX | Gửi DOCX → chờ | `extension: docx` |
| 5. Tải lại, chống trùng | Gửi lại PDF; gửi lại với `force: true`; gửi 1 URL 2 lần liên tiếp | Cùng `sha256` và có cờ `not_modified`/`redownloaded`/`duplicate_content`; `forced: true`; lần 2 trả `deduplicated: true` và đúng `job_id` lần 1 |
| 6. Lỗi | Body có trường lạ, thiếu `url`, JSON hỏng, `ftp://`, `127.0.0.1`, job không tồn tại, hỏi job ở nhầm bản 8801, trang 404, trang cần đăng nhập (`lms.hust.edu.vn/my/`) | `400 invalid_request`, `400 invalid_request`, `400 bad_json`, `400 invalid_url`, `400 blocked_host`, `404 not_found`, `404`, `failed download_error`, `failed auth_required` |
| 7. Mock API | Ping, gửi HTML → chờ → đọc nội dung giả; URL `/mock-fail`; URL `/mock-auth-required` | `done`; `failed download_error`; `failed auth_required` |

### 3.5 Chạy bằng dòng lệnh (không cần mở Postman)

```powershell
npx -y newman@6.2.1 run postman/hust-content-downloader.postman_collection.json
```

Muốn bỏ qua thư mục mock: thêm `--folder "1. Sức khỏe" --folder "2. Trang HTML" ...` cho các thư mục cần chạy.

### 3.6 Mock API là gì, dùng khi nào

`npm run mock:api` chạy một server giả ở `http://localhost:8899` có **cùng API và cùng định dạng JSON** với service thật, nhưng không tải gì thật: job tự `done` sau khoảng 1,25 giây, `content_ref` trỏ tới nội dung giả `/mock-content/:id`. Không cần Docker, MinIO, Chrome hay mạng.

- URL kết thúc bằng `/mock-fail` → job `failed` với `download_error`.
- URL kết thúc bằng `/mock-auth-required` → job `failed` với `auth_required`.
- `job_id` dạng `mock-0001` (service thật dùng UUID), bên gọi không được dựa vào định dạng này.

Chi tiết: [API_MOCK.md](API_MOCK.md). Hạn chế: mock chỉ nghe ở `127.0.0.1`, **máy khác không gọi được**. Nhóm khác muốn dùng thì tự chạy mock trên máy họ (chỉ cần Node.js ≥ 22.12 và thư mục `src/downloader`, không cần `npm install`).

---

## 4. Tích hợp với các nhóm khác

### 4.1 Luồng dữ liệu

```
Điều khiển (BAT) ──POST /load {"url"}──► Tải về (:8800) ──tải, lưu MinIO
                                              │
                                              └──POST /parse {url, format, encoding, content}──► Đọc nội dung (N1 :6600)
```

Đúng như slide: *"Tải về gửi dữ liệu tải được sang Đọc nội dung"*. Bật bằng biến `READER_URL` trong `.env`:

```env
READER_URL=http://10.177.29.30:6600/parse
READER_TIMEOUT_MS=30000
READER_RETRY_COUNT=3
```

Để trống `READER_URL` thì tắt: dịch vụ chỉ lưu MinIO và trả `content_ref` như trước. Đổi xong chạy `docker compose up -d` để nạp lại. Log khởi động có `"isForwardingEnabled":true` là đã bật.

Đã chạy thử với N1 thật ngày 24/10/2026: 1 trang HTML (128 863 B) và 1 file DOCX (16 828 B), N1 đều trả HTTP 200.

### 4.2 Với nhóm Điều khiển (BAT)

- Địa chỉ: `http://<ip-Tải-về>:8800`
- **Chỉ cần gửi** `POST /load {"url": "..."}`. Tải về tự gửi nội dung sang N1, BAT không phải chuyển tiếp.
- `202`: đã nhận. `503 queue_full`: đợi vài giây rồi gửi lại. `400`: URL sai hoặc bị chặn, bỏ URL.
- Muốn kiểm tra (không bắt buộc): `GET /jobs/:job_id`
  - `done` + `forwarded: true`: N1 đã nhận.
  - `done` + `forwarded: false`: tải xong nhưng N1 không nhận, xem `forward_error`.
  - `failed`: tải lỗi (404, `auth_required`…), không gửi sang N1.
- Nên lọc URL ảnh/video trước khi gửi: tải được nhưng N1 không đọc được nội dung.

```python
import time, requests

DOWNLOADER = "http://10.177.29.215:8800"

def submit(url, retries=5):
    """Gửi URL. Trả job_id, hoặc None nếu hàng đợi vẫn đầy sau vài lần thử."""
    for _ in range(retries):
        r = requests.post(f"{DOWNLOADER}/load", json={"url": url}, timeout=10)
        if r.status_code == 202:
            return r.json()["job_id"]
        if r.status_code == 503:              # queue_full -> đợi rồi thử lại
            time.sleep(3)
            continue
        raise ValueError(r.json()["error"])   # 400: URL sai / bị chặn -> bỏ URL
    return None
```

### 4.3 Với nhóm Đọc nội dung (N1)

Tải về gọi `POST {READER_URL}` sau mỗi job `done`, đúng hợp đồng trong [Readme_reader.md](Readme_reader.md):

| Loại | Body |
|---|---|
| HTML | `{"url", "format": "html", "encoding": "text", "content": "<html>…"}` |
| File | `{"url", "format": "other", "content_type": "application/pdf", "encoding": "base64", "content": "JVBERi0…"}` |

- `url` là URL BAT gửi (chưa qua chuyển hướng), để Điều khiển và Tổng hợp khớp được URL.
- HTML là DOM sau khi Chrome chạy JavaScript, giải mã theo `charset` (mặc định UTF‑8).
- File tối đa 20 MB, base64 khoảng 27 MB: `/parse` cần nhận được body cỡ này.
- N1 trả 2xx là xong. 5xx/429 hoặc không kết nối được: thử lại `READER_RETRY_COUNT` lần. 4xx: không gửi lại.
- Gửi lại cả khi nội dung không đổi (`not_modified`), vì BAT gửi lại URL nghĩa là cần xử lý lại.
- N1 lỗi thì job vẫn `done`, nội dung vẫn lấy được qua `content_ref` trong 15 phút.

### 4.4 Mạng: cổng và địa chỉ

| Cổng | Ai cần truy cập | Mở firewall? |
|---|---|---|
| 8800 | BAT | Có |
| 9000 | Chỉ khi ai đó cần mở `content_ref` (N1 đã nhận nội dung qua `/parse`) | Tuỳ |
| 9001 | Chỉ nhóm Tải về (MinIO Console) | **Không** |

Mở firewall Windows (PowerShell chạy bằng quyền Administrator):

```powershell
New-NetFirewallRule -DisplayName "Downloader API" -Direction Inbound -Protocol TCP -LocalPort 8800,8801,9000 -Action Allow
```

**Trường hợp 1: mỗi nhóm một máy, cùng mạng LAN/Wi‑Fi** (khuyên dùng khi demo)

- `.env`: `S3_PUBLIC_ENDPOINT=http://<IP-LAN-máy-Tải-về>:9000`, sau đó `docker compose --profile two-instances up -d` để nạp lại.
- Kiểm tra từ máy nhóm khác: `curl http://<ip>:8800/ping` và mở thử một `content_ref` mới lấy.
- Chữ ký của link gắn với địa chỉ trong `S3_PUBLIC_ENDPOINT`. Đổi IP (đổi Wi‑Fi) thì phải sửa `.env`, chạy lại, và các link cũ hết hiệu lực.

**Trường hợp 2: tất cả chạy trên một máy, gọi nhau bằng tên container**

- Các nhóm join mạng Docker của dịch vụ này (`hust-downloader_default`). Trong compose của nhóm khác:
  ```yaml
  networks:
    default:
      name: hust-downloader_default
      external: true
  ```
- BAT gọi `http://content-downloader:8800` và `http://content-downloader-replica:8800`.
- `S3_PUBLIC_ENDPOINT=http://minio:9000` để container N1 mở được `content_ref`. Khi đó link **không mở được từ trình duyệt trên máy host**, chỉ container mở được.

### 4.5 Checklist ghép hệ thống

- [ ] `.env`: `READER_URL=http://<ip-N1>:6600/parse`; log khởi động có `"isForwardingEnabled":true`
- [ ] `.env`: `S3_PUBLIC_ENDPOINT` = IP LAN, `ALLOWED_DOMAINS=hust.edu.vn`
- [ ] Mở firewall 8800, 8801, 9000
- [ ] Gửi BAT: 2 địa chỉ Tải về + mục 4.2
- [ ] Gửi N1: định dạng gói tin + mục 4.3; N1 mở thử được 1 `content_ref` từ máy của họ
- [ ] Gửi BAT và N1: file [API_MOCK.md](API_MOCK.md) + lệnh chạy mock để họ code song song
- [ ] Chạy bộ Postman (mục 3) từ máy của BAT với `base` = IP máy Tải về: tất cả xanh
- [ ] Chạy thử BAT → Tải về → N1 với 100 URL trong `data/link_all.txt`; đối chiếu `/stats` của 2 bản (`jobsDone + jobsFailed`) với số URL BAT đã gửi

---

## 5. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `failed to connect to the docker API … dockerDesktopLinuxEngine` | Docker Desktop chưa bật | Mở Docker Desktop, chờ tới khi báo *Engine running* |
| `Bind for 127.0.0.1:9000 failed: port is already allocated` ngay sau khi bật Docker Desktop | Docker Desktop vừa khởi động, chưa nhả cổng | Đợi 10–20 giây rồi chạy lại `up -d`. Nếu vẫn lỗi: `netstat -ano \| findstr :9000` để tìm chương trình đang chiếm cổng |
| Container `unhealthy`, log lặp `bucket_not_ready … ENOTFOUND` | Bản Tải về không tìm thấy MinIO, thường do lần `up` trước bị lỗi giữa chừng nên MinIO không vào mạng Docker | `docker compose --profile two-instances down` rồi `up -d` lại (dữ liệu vẫn giữ). `restart` không đủ |
| Container `unhealthy` / thoát ngay vì lý do khác | Chrome lỗi, thiếu RAM | `docker compose logs content-downloader` |
| Nhóm khác mở `content_ref` bị lỗi kết nối | `S3_PUBLIC_ENDPOINT` vẫn là `localhost`, hoặc firewall chặn 9000 | Sửa `.env` theo 4.4, mở firewall |
| `content_ref` trả `403` | Link hết hạn (15 phút), hoặc host trong link khác host đang gọi | Gọi lại `GET /jobs/:id` để lấy link mới; dùng đúng địa chỉ trong link, không sửa tay |
| `GET /jobs/:id` trả `404 not_found` | Hỏi nhầm bản, hoặc job đã quá 1 giờ, hoặc container vừa khởi động lại | Hỏi đúng bản đã nhận `/load`; gửi lại URL |
| `503 queue_full` | Bản này đang có đủ 22 job | Gửi sang bản khác, hoặc tăng `QUEUE_SIZE`/`MAX_CONCURRENT` |
| `400 blocked_host` | URL ngoài `ALLOWED_DOMAINS`, hoặc trỏ vào IP nội bộ | Đúng thiết kế; bỏ URL đó |
| `400 invalid_request` / `bad_json` | Body có trường lạ / JSON sai cú pháp | Chỉ gửi `{"url": "..."}` |
| Job `failed`, `error.code = auth_required` | Trang cần đăng nhập | Đúng thiết kế, service không vượt qua đăng nhập; bỏ URL. Gặp trang login có đường dẫn lạ mà không bị nhận ra thì thêm đoạn đó vào `AUTH_LOGIN_PATH_SEGMENTS` |
| Job `done` nhưng nội dung là trang đăng nhập | Trang login trả `200` ở đường dẫn không có trong danh sách, hoặc chuyển hướng bằng JavaScript | Thêm đoạn đường dẫn vào `AUTH_LOGIN_PATH_SEGMENTS`. Service chỉ nhận ra qua mã 401 và đường dẫn |
| Tải lại không thấy nội dung mới (`not_modified: true`) | Máy chủ nguồn báo trang chưa đổi | Gửi `"force": true` |
| URL `.pdf` nhưng máy chủ trả HTML, nội dung thiếu phần do JavaScript sinh | `PROBE_MODE=auto` tải thẳng URL có đuôi tài liệu, không render | Đặt `PROBE_MODE=always` |
| Postman: request "Chờ …" chạy tay báo *Job chưa xong* | Job chưa xong | Đợi vài giây rồi Send lại, hoặc chạy cả collection bằng Runner |
| Postman: test "deduplicated = true" không đạt | Gửi lần 2 chậm, job lần 1 đã xong | Gửi "lần 2" ngay sau "lần 1" (trong khoảng 2 giây), hoặc chạy bằng Runner |
