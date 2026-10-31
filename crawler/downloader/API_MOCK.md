# Mock API — hợp đồng vào/ra

Mock API dùng để bên gọi (orchestrator, frontend, module đọc nội dung) tích hợp và kiểm thử
hợp đồng JSON mà không cần MinIO, Chromium hay mạng ngoài. Response có cùng đường dẫn,
trạng thái và tên field với dịch vụ thật; phần nội dung chỉ là dữ liệu giả lập.

Mock API **không thay thế** test tích hợp với MinIO/Chromium. Dùng mock để kiểm tra parse
response, polling job, xử lý lỗi và luồng dedup; dùng dịch vụ thật để kiểm tra tải file.

## 1. Chạy mock

```bash
cd src/downloader
npm run mock:api
```

Mặc định mock lắng nghe tại `http://127.0.0.1:8899`. Có thể đổi bằng biến môi trường:

```bash
MOCK_PORT=8899 \
MOCK_QUEUED_MS=250 \
MOCK_DOWNLOADING_MS=750 \
MOCK_STORING_MS=250 \
npm run mock:api
```

Ba biến `MOCK_*_MS` điều khiển thời gian giả lập từng trạng thái. Mock chỉ dùng thư viện
chuẩn của Node.js >= 22.12, không cần cài thêm dependency.

## 2. Vòng đời job

```text
POST /load
  -> queued
  -> downloading
  -> storing
  -> done | failed
```

- Mặc định job `done` sau khoảng 1,25 giây.
- Hai request cùng URL trong lúc job còn `queued`, `downloading` hoặc `storing` trả cùng
  `job_id` với `deduplicated: true`.
- `force: true` không tạo job mới nếu URL đang có job chạy; hành vi này giống dịch vụ thật.
- URL có path kết thúc bằng `/mock-fail` sẽ tạo job `failed` với mã `download_error`.
- URL có path kết thúc bằng `/mock-auth-required` sẽ tạo job `failed` với mã
  `auth_required`, `auth_required: true` và `final_url` trỏ tới `/login` cùng origin.

## 3. Endpoint

| Method | Path | Mục đích |
|---|---|---|
| `POST` | `/load` | Nhận URL, tạo job bất đồng bộ |
| `GET` | `/jobs/:jobId` | Lấy trạng thái và metadata của job |
| `GET` | `/ping` | Kiểm tra trạng thái queue |
| `GET` | `/stats` | Counter job, queue và browser |
| `GET` | `/mock-content/:jobId` | Nội dung giả lập cho job đã `done` |

Mọi response JSON dùng `content-type: application/json; charset=utf-8`. Mock bật CORS
`*` để tiện gọi từ trình duyệt; dịch vụ thật không bật CORS.

## 4. Input/output

### 4.1. `POST /load`

Request:

```http
POST /load HTTP/1.1
Host: 127.0.0.1:8899
Content-Type: application/json

{
  "url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/",
  "force": false
}
```

Input:

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `url` | string | Có | Chỉ chấp nhận `http`/`https`, không chứa username/password |
| `force` | boolean | Không | Mặc định `false` |

Response `202`:

```json
{
  "job_id": "mock-0001",
  "status": "queued",
  "status_url": "/jobs/mock-0001",
  "deduplicated": false
}
```

Response khi URL đang được tải bởi một job khác:

```json
{
  "job_id": "mock-0001",
  "status": "downloading",
  "status_url": "/jobs/mock-0001",
  "deduplicated": true
}
```

`job_id` của mock có dạng `mock-0001`; bên gọi phải coi đây là opaque ID, không parse số
thứ tự. Dịch vụ thật dùng UUID.

### 4.2. `GET /jobs/:jobId`

Job đang chờ:

```json
{
  "job_id": "mock-0001",
  "status": "queued",
  "url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/",
  "final_url": null,
  "url_key": "4f1c...",
  "format": null,
  "content_type": null,
  "extension": null,
  "encoding": null,
  "content_ref": null,
  "object_key": null,
  "size": null,
  "sha256": null,
  "http_status": null,
  "fetched_at": null,
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
  "error": null
}
```

Job HTML đã xong:

```json
{
  "job_id": "mock-0001",
  "status": "done",
  "url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/",
  "final_url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/",
  "url_key": "4f1c9f...",
  "format": "html",
  "content_type": "text/html; charset=utf-8",
  "extension": "html",
  "encoding": "ref",
  "content_ref": "http://127.0.0.1:8899/mock-content/mock-0001",
  "object_key": "raw/8a3d...",
  "size": 1024,
  "sha256": "8a3d...",
  "http_status": 200,
  "fetched_at": "2026-10-24T09:00:01.000Z",
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
  "error": null
}
```

Job PDF trả `format: "other"`, `content_type: "application/pdf"`, `extension: "pdf"`.
Job DOCX trả `extension: "docx"` và MIME tương ứng.

Job thất bại:

```json
{
  "job_id": "mock-0002",
  "status": "failed",
  "url": "https://example.com/mock-fail",
  "final_url": null,
  "url_key": "...",
  "format": null,
  "content_type": null,
  "extension": null,
  "encoding": null,
  "content_ref": null,
  "object_key": null,
  "size": null,
  "sha256": null,
  "http_status": null,
  "fetched_at": null,
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
  "error": {
    "code": "download_error",
    "message": "Mock failure theo kịch bản /mock-fail"
  }
}
```

Job yêu cầu đăng nhập:

```json
{
  "job_id": "mock-0003",
  "status": "failed",
  "url": "https://example.com/mock-auth-required",
  "final_url": "https://example.com/login",
  "url_key": "...",
  "format": null,
  "content_type": null,
  "extension": null,
  "encoding": null,
  "content_ref": null,
  "object_key": null,
  "size": null,
  "sha256": null,
  "http_status": null,
  "fetched_at": null,
  "deduplicated": false,
  "not_modified": false,
  "auth_required": true,
  "manifest_invalid": false,
  "redownloaded": false,
  "content_changed": false,
  "duplicate_content": false,
  "forced": false,
  "previous_sha256": null,
  "previous_fetched_at": null,
  "error": {
    "code": "auth_required",
    "message": "Mock yêu cầu đăng nhập theo kịch bản /mock-auth-required"
  }
}
```

`status` chỉ có một trong: `queued`, `downloading`, `storing`, `done`, `failed`.
`auth_required` chỉ `true` khi job thất bại vì nguồn yêu cầu đăng nhập; `manifest_invalid`
chỉ `true` khi manifest cũ hỏng/sai schema và đã được bỏ qua (mock luôn trả `false`).

### 4.3. `GET /ping`

```json
{ "status": "đang chờ" }
```

Giá trị có thể là `đang chờ`, `đang tải` hoặc `đang bận`. Mock dùng cùng quy tắc với dịch vụ
thật: `đang bận` khi đã đủ 2 job đang chạy và vẫn còn job chờ.

### 4.4. `GET /stats`

```json
{
  "queue": {
    "queued": 0,
    "active": 0,
    "concurrency": 2,
    "queueSize": 20,
    "capacity": 22,
    "totalJobs": 1,
    "doneJobs": 1,
    "failedJobs": 0
  },
  "jobs": {
    "jobsCreated": 1,
    "jobsDone": 1,
    "jobsFailed": 0,
    "deduplicatedRequests": 0,
    "htmlDownloads": 1,
    "documentDownloads": 0,
    "downloadedBytes": 1024,
    "notModifiedDownloads": 0,
    "redownloadedSameContent": 0,
    "changedContent": 0,
    "duplicateContent": 0,
    "errorCounts": {},
    "startedAt": "2026-10-24T09:00:00.000Z",
    "uptimeSeconds": 12
  },
  "browser": {
    "activePages": 0,
    "pagesServed": 1,
    "maxPages": 2,
    "connected": true
  }
}
```

### 4.5. `GET /mock-content/:jobId`

Trả nội dung giả lập cho job đã `done`:

- HTML: `text/html; charset=utf-8`.
- PDF: `application/pdf` với nội dung `%PDF-1.4 ...` tối giản, **không phải PDF hợp lệ để
  render**.
- Định dạng khác: `application/octet-stream`.

Chỉ dùng để kiểm tra luồng tải byte; không dùng nội dung này cho parser thật.

## 5. Lỗi

Envelope lỗi thống nhất:

```json
{
  "error": {
    "code": "invalid_url",
    "message": "Chỉ hỗ trợ URL http hoặc https"
  }
}
```

| HTTP | `error.code` | Trường hợp |
|---|---|---|
| `400` | `bad_json` | Body không phải JSON hợp lệ |
| `400` | `invalid_request` | Thiếu `url`, sai kiểu, có field lạ |
| `400` | `invalid_url` | URL sai định dạng, sai scheme, có credential |
| `400` | `blocked_host` | Host nội bộ hoặc metadata |
| `404` | `not_found` | Không có job/route |
| `413` | `payload_too_large` | JSON body vượt 32 KB |
| `500` | `internal_error` | Lỗi ngoài dự kiến của mock |

## 6. Ví dụ cURL

```bash
BASE=http://127.0.0.1:8899

# 1. Tạo job
curl -fsS -X POST "$BASE/load" \
  -H 'content-type: application/json' \
  -d '{"url":"https://hust.edu.vn/vi/news/tin-tuc-su-kien/"}'

# 2. Poll trạng thái (dùng jq nếu có)
JOB_ID=mock-0001
curl -fsS "$BASE/jobs/$JOB_ID" | jq '{status, content_ref, error}'

# 3. Lấy nội dung khi done
curl -fsS "$BASE/jobs/$JOB_ID" | jq -r '.content_ref' | xargs curl -fsS -o /dev/null -w '%{http_code}\n'

# 4. Xem counter
curl -fsS "$BASE/stats" | jq '.jobs'

# 5. Kịch bản nguồn yêu cầu đăng nhập
curl -fsS -X POST "$BASE/load" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/mock-auth-required"}'
```

Chạy lại mock sẽ xoá toàn bộ job và counter vì state nằm trong bộ nhớ.

## 7. Khác biệt so với dịch vụ thật

| Điểm | Mock | Dịch vụ thật |
|---|---|---|
| Lưu trữ | Bộ nhớ | MinIO, bucket private |
| `content_ref` | URL nội bộ `/mock-content/...` | Presigned GET URL có TTL |
| Tải nội dung | Giả lập, không ra mạng | Puppeteer/HTTP stream |
| Kiểm tra SSRF | Chỉ chặn hostname nội bộ cơ bản | DNS, private IP, redirect, allowlist |
| Robots.txt | Không kiểm tra | Tùy `RESPECT_ROBOTS` |
| CORS | Bật `*` | Không bật |
| ID | `mock-0001` | UUID |
| `not_modified` | Luôn `false` | Có thể `true` khi nguồn xác nhận |
| Kịch bản lỗi | `/mock-fail`, `/mock-auth-required` | Lỗi thật từ nguồn/lưu trữ |

Mock chỉ nên chạy trên máy dev hoặc trong test. Không public mock API ra Internet và không
dùng nội dung giả lập cho pipeline production.
