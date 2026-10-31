# Dịch vụ tải nội dung (content-downloader)

Dịch vụ nhận URL, tải nội dung bất đồng bộ, lưu object vào MinIO và trả metadata kèm
presigned GET URL cho các bước xử lý phía sau.

Module chỉ làm phần **tải về**: không bóc tách nội dung, không quyết định URL kế tiếp và
không ghi MongoDB. Khi cấu hình `READER_URL`, nội dung của mỗi job `done` được chuyển sang
module đọc qua `POST /parse` (mục 3.1).

Hướng dẫn cài đặt và triển khai production: [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Phạm vi và giá trị

- Nhận URL qua `POST /load`, tạo job bất đồng bộ.
- HTML được render bằng Chromium headless (Puppeteer) để lấy DOM sau JavaScript.
- PDF, DOCX, XLSX, PPTX, TXT, CSV, ZIP, RAR, 7Z... được tải bằng HTTP stream.
- Nội dung lưu theo địa chỉ hash: `raw/{sha256}`; manifest theo URL: `index/url/{urlKey}.json`.
- Trả `content_ref` là presigned GET URL có thời hạn ngắn; bucket luôn private.
- Hỗ trợ tải lại có điều kiện, phát hiện nội dung trùng và nội dung thay đổi.

### Giá trị nghiệp vụ

Giá trị của module không nằm ở công nghệ bên trong, mà ở việc biến danh sách URL rời rạc
thành một kho tài liệu thống nhất, dùng được ngay cho các bước đọc và tìm kiếm.

- **Giảm công sức thu thập thủ công**: nhóm nghiên cứu chỉ cần gửi URL, không phải mở từng
  trang, tải file, đặt tên và kiểm tra thủ công. Việc thu thập corpus vẫn chạy khi không có
  người ngồi trước máy.
- **Chuẩn hóa đầu vào cho toàn bộ pipeline**: HTML, PDF, DOCX, XLSX, PPTX... đều được lưu và
  mô tả theo cùng một cách. Module đọc và tìm kiếm nhận được nguồn dữ liệu nhất quán thay vì
  mỗi nơi xử lý một kiểu.
- **Tiết kiệm chi phí lưu trữ và băng thông**: nội dung đã tải được nhận biết và dùng lại;
  không tải lại những tài liệu không thay đổi, không lưu trùng cùng một nội dung. Chi phí tăng
  chậm hơn nhiều so với việc thu thập thủ công hoặc tải lại toàn bộ.
- **Dữ liệu có thể kiểm chứng và tái sử dụng**: mỗi tài liệu có dấu vết về nguồn, thời điểm
  tải và nội dung. Khi cần đối chiếu, báo cáo hoặc chạy lại thí nghiệm, nhóm có thể biết tài
  liệu nào đã dùng và tài liệu nào đã thay đổi.
- **Giảm rủi ro tuân thủ và bảo mật**: chỉ lấy nguồn công khai, tôn trọng robots.txt khi được
  bật, không tìm cách vượt đăng nhập, không công khai kho dữ liệu. Điều này giảm rủi ro pháp lý
  và rủi ro lộ dữ liệu nội bộ.
- **Rút ngắn thời gian phối hợp giữa các nhóm**: bên gọi chỉ gửi URL và nhận trạng thái job
  cùng liên kết tải; không cần biết MinIO hay Chromium. Hợp đồng API và mock giúp nhóm đọc,
  orchestrator và frontend phát triển song song trước khi hệ thống thật sẵn sàng.
- **Vận hành ổn định, ít phụ thuộc con người**: job chạy nền, có trạng thái và tự thử lại khi
  lỗi tạm thời; dữ liệu đã tải vẫn còn khi service khởi động lại. Đội vận hành theo dõi được
  tiến độ và tỷ lệ lỗi thay vì kiểm tra thủ công từng file.
- **Sẵn sàng mở rộng theo nhu cầu dự án**: có thể nhận thêm nhiều URL và nhiều loại tài liệu
  mà không phải thay đổi cách làm việc của nhóm. Module giữ đúng vai trò thu thập dữ liệu, để
  các phần phân tích và tìm kiếm phát triển độc lập.

## 2. Kiến trúc

```
adapters/inbound/http/      Express controllers, routes, error mapping
application/use-cases/      SubmitDownloadJob, RunDownloadJob, GetJobStatus
domain/                     Entity, value object, policy, port, error thuần
adapters/outbound/          Puppeteer, HTTP fetch, MinIO, queue, logger, gửi sang module đọc
config/env.js               Đọc và validate biến môi trường bằng zod
mock/                       Mock API cho tích hợp hợp đồng vào/ra
index.js                    Composition root, khởi động server
```

Luồng một job:

```
POST /load
  -> chuẩn hoá URL, kiểm tra SSRF, dedup in-flight
  -> queue (mặc định 2 job chạy song song, tối đa 20 job chờ)
  -> HEAD probe theo PROBE_MODE (Content-Type, ETag, Last-Modified)
  -> nếu redirect tới trang login hoặc HTTP 401: job failed auth_required
  -> HTML: Puppeteer + networkidle2 | FILE: HTTP stream có giới hạn byte
  -> SHA-256, kiểm tra object đã tồn tại, ghi MinIO
  -> ghi manifest
  -> nếu có READER_URL: POST /parse sang module đọc (lỗi không làm job failed)
  -> trả metadata + presigned content_ref
```

## 3. API

Base URL local: `http://localhost:8800`. Mọi response là JSON.

Hợp đồng mock đầy đủ (input/output, lỗi, cURL): [API_MOCK.md](API_MOCK.md). Chạy mock
bằng `npm run mock:api`; mock không cần MinIO, Chromium hay mạng ngoài.

### `POST /load`

```json
{
  "url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/",
  "force": false
}
```

- `force: true` bỏ qua manifest/validator và tải lại.
- Response `202`:

```json
{
  "job_id": "uuid",
  "status": "queued",
  "status_url": "/jobs/uuid",
  "deduplicated": false
}
```

- Nếu cùng URL đang có job chạy, trả job đang chạy với `deduplicated: true`.
- Queue đầy trả `503` với `error.code = "queue_full"`.

### `GET /jobs/:jobId`

```json
{
  "job_id": "uuid",
  "status": "done",
  "url": "https://hust.edu.vn/...",
  "final_url": "https://hust.edu.vn/...",
  "url_key": "sha256-của-url-đã-chuẩn-hoá",
  "format": "html",
  "content_type": "text/html; charset=utf-8",
  "extension": "html",
  "encoding": "ref",
  "content_ref": "http://localhost:9000/hust-raw/raw/...?X-Amz-...",
  "object_key": "raw/...",
  "size": 101371,
  "sha256": "...",
  "http_status": 200,
  "fetched_at": "2026-10-24T08:46:33.715Z",
  "deduplicated": false,
  "not_modified": false,
  "auth_required": false,
  "manifest_invalid": false,
  "redownloaded": false,
  "content_changed": false,
  "duplicate_content": false,
  "forced": false,
  "previous_sha256": null,
  "previous_fetched_at": null,
  "forwarded": true,
  "forward_error": null,
  "error": null
}
```

`status`: `queued | downloading | storing | done | failed`.

Các cờ kết quả:

| Cờ | Ý nghĩa |
|---|---|
| `not_modified` | Nguồn xác nhận 304 hoặc validator khớp manifest; dùng lại object cũ |
| `auth_required` | Nguồn yêu cầu đăng nhập; job `failed`, `final_url` là trang login, không lưu nội dung |
| `manifest_invalid` | Manifest cũ hỏng/sai schema đã được bỏ qua; job tải lại như lần đầu |
| `redownloaded` | Tải lại nhưng nội dung giống hệt lần trước |
| `content_changed` | Cùng URL nhưng SHA-256 khác manifest trước |
| `duplicate_content` | Object cùng hash đã tồn tại, không ghi lại |
| `forced` | Job được tạo với `force: true` |
| `forwarded` | `true`: module đọc đã nhận nội dung; `false`: gửi thất bại, xem `forward_error`; `null`: chưa cấu hình `READER_URL` hoặc job không `done` |

### 3.1 Chuyển nội dung sang module đọc

Đặt `READER_URL` (ví dụ `http://10.177.29.30:6600/parse`) để mỗi job `done` tự gửi nội dung
sang module đọc, đúng hợp đồng trong [Readme_reader.md](Readme_reader.md):

```json
{"url": "https://hust.edu.vn/tin-tuc", "format": "html", "encoding": "text", "content": "<html>…</html>"}
```

```json
{"url": "https://hust.edu.vn/quy-che.pdf", "format": "other", "content_type": "application/pdf",
 "encoding": "base64", "content": "JVBERi0xLjQK…"}
```

- `url` là URL bên gọi gửi trong `POST /load` (chưa qua redirect), để khớp với URL mà
  Điều khiển và Tổng hợp đang theo dõi.
- HTML được giải mã theo `charset` trong Content-Type (mặc định UTF-8); file được mã hoá base64.
- Gửi cả khi `not_modified` (nội dung đọc lại từ MinIO), vì bên gọi gửi lại URL nghĩa là cần xử lý lại.
- Job `failed` (kể cả `auth_required`) không gửi.
- Module đọc trả 5xx/429 hoặc không kết nối được: thử lại `READER_RETRY_COUNT` lần (backoff
  theo `RETRY_BASE_MS`/`RETRY_MAX_MS`). Vẫn lỗi thì job vẫn `done`, `forwarded: false` và
  `forward_error` ghi lý do; nội dung vẫn còn trong MinIO. Trả 4xx thì không thử lại.
- `/stats` có thêm `forwardedContents`, `forwardFailures`, `forwardErrorCounts`.

Lỗi trả envelope thống nhất:

```json
{
  "error": {
    "code": "blocked_host",
    "message": "Host ... bị chặn"
  }
}
```

### `GET /ping`

Trả `200` với một trong các trạng thái `đang chờ`, `đang tải`, `đang bận`.
Dùng cho healthcheck Docker.

### `GET /stats`

Trả số job, số byte đã tải, counter lỗi và trạng thái browser pool.

## 4. Chạy local

Yêu cầu Node.js >= 22.12 và Chromium/Chrome.

```bash
cd src/downloader
cp .env.example .env
npm ci
docker compose up -d minio
npm start
```

Kiểm tra:

```bash
curl -s http://localhost:8800/ping
curl -s -X POST http://localhost:8800/load \
  -H 'content-type: application/json' \
  -d '{"url":"https://hust.edu.vn/vi/news/tin-tuc-su-kien/"}'
```

Presigned URL mặc định ký với `S3_PUBLIC_ENDPOINT=http://localhost:9000` để client trên
máy host đọc được. Nếu client là container cùng network, đổi thành `http://minio:9000`.

## 5. Docker Compose

```bash
cd src/downloader
docker compose up -d --build
docker compose ps
docker compose logs -f content-downloader
```

- `content-downloader`: API tại `http://localhost:8800`.
- `minio`: S3 tại `http://localhost:9000`, console tại `http://localhost:9001`.
- Chạy thêm instance thứ hai (dùng chung MinIO/manifest):

```bash
docker compose --profile two-instances up -d content-downloader-replica
# API thứ hai tại http://localhost:8801
```

MinIO dùng image Chainguard `cgr.dev/chainguard/minio:latest`; image `minio/minio` trên
Docker Hub đã bị rút. Bucket được ứng dụng tự tạo và đặt private khi khởi động, không cần
container `mc`/`minio-init`.

## 6. Kiểm thử

```bash
npm test                 # unit + integration API, không cần Docker/Chrome/mạng ngoài
npm run test:coverage    # coverage line, branch
docker compose up -d minio
npm run test:s3          # MinIO thật: bucket private, presigned, manifest
```

Kết quả hiện tại: 182 test unit/integration pass, 6 test S3 pass. `npm run test:coverage`
dòng `all files`: 92,39% line, 89,17% branch. Script coverage chạy tuần tự (`--test-concurrency=1`) để tránh timeout giả
do instrumentation làm chậm các test có HTTP server.

Các kịch bản E2E thủ công đã kiểm tra:

- HTML có JavaScript: trang tin tức HUST.
- PDF chuẩn: file `bm17` (262.890 byte).
- DOCX MIME chuẩn: SoICT.
- DOCX MIME sai `application/octet-stream`: vẫn nhận `extension: docx`.
- URL `.pdf` nhưng server trả `text/html`: nhận `format: html`, không lưu thành PDF.
- Tải lại PDF: `not_modified: true` sau restart nhờ manifest trong MinIO.
- Hai instance dùng chung manifest.

## 7. Bảo mật

- Chỉ cho phép `http`/`https`; chặn `localhost`, metadata IP, private/reserved IP và
  kiểm tra lại sau mỗi redirect.
- Giới hạn kích thước: file 20 MB, HTML sau render 5 MB; timeout HEAD 15 s, HTML 30 s,
  file 60 s.
- Presigned URL TTL mặc định 900 s; bucket private, policy public bị xoá khi khởi động.
- Không log body, byte nội dung, presigned URL, access key hay secret.
- `ALLOWED_DOMAINS` có thể giới hạn domain được tải.
- `RESPECT_ROBOTS=true` bật kiểm tra robots.txt (mặc định tắt cho môi trường demo).
- `BLOCK_RESOURCE_TYPES=image,media,font` giảm băng thông khi render HTML; đặt rỗng nếu
  cần tải đầy đủ tài nguyên.

### Trang yêu cầu đăng nhập

Dịch vụ **không bypass** đăng nhập. Job được đánh dấu thất bại khi phát hiện một trong hai
tín hiệu công khai:

- HTTP `401` từ HEAD probe hoặc downloader.
- Redirect (hoặc trang cuối) có path thuộc `AUTH_LOGIN_PATH_SEGMENTS`, ví dụ `/login`,
  `/signin`, `/dang-nhap`, `/sso`.

Khi đó response có `status: "failed"`, `error.code: "auth_required"`, `auth_required: true`
và `final_url` là URL trang login. Trang login **không** được lưu vào MinIO, không ghi
manifest và không trả `content_ref`. Bên gọi dùng `final_url` để phân biệt với lỗi tải
thông thường.

Nếu có quyền truy cập hợp lệ, hướng đúng là dùng phiên đăng nhập/credential do đơn vị cấp
và chỉ áp dụng cho domain được allowlist; không dùng kỹ thuật vượt qua kiểm soát truy cập.
Tính năng này chưa được bật vì API hiện không có lớp xác thực người gọi.

`PROBE_MODE=auto` (mặc định) bỏ HEAD cho URL có đuôi tài liệu để giảm một lượt request,
nhưng vẫn phát hiện auth qua `final_url` và status của downloader. Đặt `PROBE_MODE=always`
nếu muốn kiểm tra auth/Content-Type trước khi tải mọi URL.

## 8. Biến môi trường

Xem `.env.example`. Các nhóm chính:

| Nhóm | Biến |
|---|---|
| API | `PORT`, `NODE_ENV`, `LOG_LEVEL` |
| MinIO | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `PRESIGN_TTL_SECONDS` |
| Giới hạn | `MAX_FILE_BYTES`, `MAX_HTML_BYTES`, `MAX_CONCURRENT`, `QUEUE_SIZE` |
| Nguồn | `PROBE_MODE`, `AUTH_LOGIN_PATH_SEGMENTS` |
| Timeout | `PROBE_TIMEOUT_MS`, `HTML_TIMEOUT_MS`, `FILE_TIMEOUT_MS` |
| Retry | `RETRY_COUNT`, `RETRY_BASE_MS`, `RETRY_MAX_MS`, `RETRY_JITTER_MS` |
| Lịch sự nguồn | `HOST_DELAY_MS`, `ALLOWED_DOMAINS`, `RESPECT_ROBOTS` |
| Browser | `CHROME_BIN`, `BLOCK_RESOURCE_TYPES`, `USER_AGENT` |
| Job | `JOB_TTL_MS`, `MAX_JOBS` |
| Module đọc | `READER_URL` (rỗng = tắt), `READER_TIMEOUT_MS`, `READER_RETRY_COUNT` |

Không commit `.env`, secret, `node_modules/`, coverage hoặc dữ liệu đã tải.

## 9. Giới hạn đã biết

- **Revalidation HTML**: ETag/Last-Modified chỉ phản ánh document server trả về, không phản
  ánh DOM sau khi JavaScript chạy. Với trang SPA hoặc nội dung đổi theo thời gian nhưng
  shell không đổi, shortcut `not_modified` có thể bỏ qua một lần render mới. Với HUST,
  `Last-Modified` thường đổi theo thời điểm nên shortcut không kích hoạt; hệ thống render
  lại rồi so SHA-256.
- **Office không có MIME/đuôi**: DOCX/XLSX/PPTX trả `application/octet-stream` và URL không
  có đuôi chỉ được nhận diện là `zip` qua magic bytes. Muốn phân biệt cần đọc central
  directory của ZIP.
- **Probe và chiến lược tải**: `PROBE_MODE=auto` (mặc định) bỏ HEAD cho URL có đuôi tài
  liệu để tiết kiệm một lượt request. Trade-off: URL `.pdf` nhưng server trả HTML sẽ được
  tải bằng HTTP stream thay vì render Puppeteer; `format` vẫn được nhận đúng là `html` từ
  Content-Type sau khi tải. Dùng `PROBE_MODE=always` nếu cần render đầy đủ mọi URL, hoặc
  `never` để bỏ toàn bộ HEAD (chấp nhận không revalidate được HTML).
- **Phát hiện auth chỉ theo tín hiệu công khai**: HTTP 401 hoặc path login đã cấu hình.
  Trang login trả `200` với path lạ, form đăng nhập nhúng trong trang, hoặc nguồn dùng
  JavaScript redirect có thể không bị phát hiện.
- **Dedup in-flight theo instance**: hai replica có thể cùng tải một URL. Object content-
  addressed ngăn ghi trùng, nhưng vẫn tốn băng thông; manifest ghi sau cùng thắng.
- **Queue trong bộ nhớ**: restart làm mất job đang chờ; manifest và object đã ghi vẫn còn
  trong MinIO.
- **SSRF**: kiểm tra DNS trước request và sau redirect, nhưng vẫn có khe TOCTOU giữa lần
  resolve của policy và lần resolve của fetch/Chromium. Chống triệt để cần pin IP hoặc
  egress proxy.
- **Chromium idle**: browser được giữ sau khi hết job để tái sử dụng, không tự tắt theo
  thời gian rảnh.
- **File buffer**: file tối đa 20 MB được giữ trong bộ nhớ (chunk + buffer nối), khoảng
  2 lần kích thước mỗi job; mặc định 2 job song song nên trần thực tế khoảng 80 MB.

## 10. Mock API

```bash
npm run mock:api
# http://127.0.0.1:8899
```

Mock mô phỏng cùng hợp đồng `POST /load`, `GET /jobs/:id`, `GET /ping`, `GET /stats` và
thêm `GET /mock-content/:id` để trả nội dung giả lập. Dùng mock để test orchestrator hoặc
frontend mà không cần MinIO/Chromium. Chi tiết input/output và kịch bản lỗi:
[API_MOCK.md](API_MOCK.md).
