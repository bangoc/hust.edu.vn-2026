# extract-service

Dịch vụ "Đọc nội dung" (N1): nhận tài liệu đã tải (HTML, pdf/docx/xlsx..., ảnh), bóc tiêu đề, chữ, liên kết ra, rồi
đẩy bản ghi sang dịch vụ Tổng hợp (N8). Java 21, một tiến trình, không cần cơ sở dữ liệu.

## Chạy

```bash
docker compose up -d --build        # cổng 6600
mvn -B test                         # JUnit
```

| Biến môi trường  | Mặc định | Ý nghĩa                                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `PORT`           | `6600`   | Cổng HTTP                                                                                         |
| `AGGREGATOR_URL` | rỗng     | Địa chỉ `/add` của N8. Rỗng thì không chuyển tiếp, `/parse` trả bản ghi trong `record` (chạy thử) |
| `DEMO_FETCH`     | tắt      | `1` bật `POST /fetch` cho `demo.html`                                                             |

Các endpoint khác:

- `GET /ping` trả `{"status":"đang chờ"}`, hoặc `{"status":"đang xử lý","dang_xu_ly":n}` khi có n request `/parse` đang chạy.
- `POST /fetch {"url"}` (chỉ khi `DEMO_FETCH=1`) tải url rồi trả đúng body mà `/parse` nhận, dùng thay Tải về (N5) cho trang demo.

## `POST /parse`

### Request

Body là JSON object, tối đa 50 MB.

```json
{
  "url": "https://hust.edu.vn/vi/news/tin-tuc/bai-viet-123.html",
  "final_url": "https://hust.edu.vn/vi/news/tin-tuc/bai-viet-123.html",
  "format": "html",
  "content_type": "text/html; charset=utf-8",
  "encoding": "text",
  "content": "<html>...</html>"
}
```

| Khoá           | Bắt buộc | Ý nghĩa                                                                                                                                                |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`          | có       | Url gốc của tài liệu, phải là http(s) đầy đủ có host. Ghi nguyên vào bản ghi.                                                                          |
| `final_url`    | không    | Url sau khi chuyển hướng. Có thì dùng nó (thay `url`) để giải link tương đối và lấy đuôi tệp.                                                          |
| `format`       | có       | `html`: trang web. `other`: tệp (pdf, docx, xlsx, pptx, doc, xls, ppt, rtf..., ảnh).                                                                   |
| `content_type` | không    | Header `Content-Type` của phản hồi. `html` + `base64` lấy bảng mã từ `charset=` (không có thì UTF-8). `other` dùng nó đoán đuôi khi url không có đuôi. |
| `encoding`     | có       | `text`: `content` là chuỗi. `base64`: `content` là byte của tài liệu mã hoá base64.                                                                    |
| `content`      | có       | Nội dung tài liệu.                                                                                                                                     |

### Xử lý

**`format: "html"`**: bóc bằng `ContentBlock`.

- `title`: `og:title`, không có thì `<h1>` đầu tiên, rồi `<title>`.
- `intro`: `og:description`, không có thì `meta[name=description]`.
- `content`: chữ của khối nội dung chính (khối có nhiều chữ trực tiếp nhất), gộp một dòng.
- `out-links`: `<a href>` và `<img src>` trong khối nội dung, url tuyệt đối http(s), bỏ `#fragment`, bỏ link về
  chính trang, khử trùng giữ lần đầu. Văn bản của link là câu chứa nó; của ảnh là `alt`, rồi `title`. Tối đa 300 ký tự.

**`format: "other"`**: bóc chữ bằng Tika (không OCR).

- `ext`: đuôi trong đoạn cuối đường dẫn, không có thì đổi từ `content_type`; không biết thì rỗng.
- `content`: chữ Tika bóc được, giữ xuống dòng.

**Ảnh** (`format: "other"`, Tika nhận ra kiểu `image/*`): không đọc nội dung ảnh.

- `title`: tiêu đề trong EXIF/XMP, không có thì tên tệp trong url (giải `%XX`, bỏ đuôi); đường dẫn rỗng thì lấy host.
- `intro`: mô tả trong EXIF/XMP, không có thì rỗng.
- `content`: luôn rỗng.
- `ext`: như trên; url không có đuôi thì lấy từ kiểu Tika nhận ra (`image/png` → `png`).
- `metadata`: `mime`, `width`, `height` (điểm ảnh), và `created`, `creator`, `camera` nếu ảnh có. Khoá không có giá trị thì bỏ.

`content` bị cắt ở 1.000.000 ký tự.

### Kết quả parse

HTML:

```json
{
  "url": "https://hust.edu.vn/a",
  "format": "html",
  "title": "Tiêu đề",
  "content": "Đây là đoạn văn ... có liên kết ở giữa.",
  "intro": "Sapo",
  "out-links": [
    ["https://hust.edu.vn/b", "Đây là đoạn văn ... có liên kết ở giữa."]
  ]
}
```

Tệp:

```json
{
  "url": "https://hust.edu.vn/files/qd-123.pdf",
  "format": "other",
  "ext": "pdf",
  "content": "…"
}
```

Ảnh:

```json
{
  "url": "https://hust.edu.vn/uploads/so-do.png",
  "format": "other",
  "ext": "png",
  "title": "so-do",
  "content": "",
  "intro": "",
  "metadata": { "mime": "image/png", "width": 1200, "height": 800 }
}
```

### Response

`200`:

```json
{
  "status": "ok",
  "url": "https://hust.edu.vn/a",
  "format": "html",
  "n_out_links": 1,
  "chars": 64
}
```

| Khoá          | Ý nghĩa                                                           |
| ------------- | ----------------------------------------------------------------- |
| `n_out_links` | Số phần tử `out-links` (luôn `0` với `other`)                     |
| `chars`       | Độ dài `content` trong bản ghi                                    |
| `record`      | Chỉ có khi không đặt `AGGREGATOR_URL`: chính bản ghi lẽ ra gửi N8 |

### Lỗi

Body lỗi là `{"detail": "<chuỗi>"}`; lỗi 422 do không có chữ kèm thêm `"url"`.

| Mã  | Khi nào                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 | Body không phải JSON object; thiếu `url`, `format`, `encoding` hay `content`; `format`/`encoding` sai giá trị; `url`/`final_url` không phải http(s) đầy đủ; base64 hỏng |
| 405 | Không phải `POST`                                                                                                                                                       |
| 413 | Body vượt 50 MB                                                                                                                                                         |
| 415 | `other` mà Tika không nhận ra kiểu tệp (`"không đọc được tệp .xyz"`)                                                                                                    |
| 422 | `html` không có cả tiêu đề lẫn chữ; tệp không phải ảnh mà không có chữ; Tika lỗi khi đọc tệp hỏng                                                                       |
| 502 | N8 không nhận sau hai lần thử (`"Tổng hợp không nhận: HTTP 500"`)                                                                                                       |
| 500 | Lỗi không lường trước                                                                                                                                                   |

### Ví dụ

```bash
curl -X POST 10.177.29.30:6600/parse \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://hust.edu.vn/vi/news/tin-tuc-su-kien/tong-bi-thu-chu-tich-nuoc-to-lam-trao-huan-chuong-lao-dong-hang-nhat-giao-6-nhiem-vu-trong-tam-cho-dai-hoc-bach-khoa-ha-noi-656084.html",
    "format": "html",
    "encoding": "text",
    "content": "<h1>Tổng Bí thư, Chủ tịch nước Tô Lâm trao Huân chương Lao động hạng Nhất</h1><p>Sáng 15/10, Tổng Bí thư, Chủ tịch nước Tô Lâm dự Lễ kỷ niệm 70 năm thành lập Đại học Bách khoa Hà Nội. Xem <a href=bai-khac-656090.html>bài liên quan</a> để biết thêm.</p><p><img src=/uploads/sys/news/anh.jpg alt=\"Lễ kỷ niệm 70 năm\"></p>"
  }'
```

```bash
curl -X POST localhost:6600/parse -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://hust.edu.vn/files/qd.pdf\",\"format\":\"other\",\"encoding\":\"base64\",\"content\":\"$(base64 < qd.pdf | tr -d '\n')\"}"
```
