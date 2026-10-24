# merger — Tổng hợp dữ liệu

Địa chỉ: `http://10.177.29.121:3000`

| Module | Địa chỉ |
|---|---|
| Đọc nội dung - N1 (reader) | 10.177.29.30:6600 |
| Tải về - N5 (downloader) | 10.177.29.215:8800 |
| Điều khiển - BAT (mediator) | 10.177.29.102:5200 |
| **Tổng hợp - N8 (merger)** | **10.177.29.121:3000** |
| Lưu trữ - N10 (storage) | 10.177.29.73:2222 |

Luồng: reader → `POST merger/add` → merger gửi bản ghi sang storage (`POST /add`) và url mới sang mediator (`POST /add {"urls": [...]}`).

## Gửi dữ liệu vào merger

`POST http://10.177.29.121:3000/add`

```json
{
  "url": "https://hust.edu.vn/tin-tuc1",
  "format": "html",
  "title": "Tin tức 1",
  "content": "Nội dung đã bóc tách",
  "out-links": [
    {"url": "https://hust.edu.vn/tin-tuc2", "text": "Tin 2"}
  ]
}
```

Ví dụ:

```bash
curl -X POST http://10.177.29.121:3000/add -H "Content-Type: application/json" -d '{"url":"https://hust.edu.vn/tin-tuc1","format":"html","title":"Tin tức 1","content":"Nội dung","out-links":[{"url":"https://hust.edu.vn/tin-tuc2","text":"Tin 2"}]}'
```

Kiểm tra merger đang chạy: `GET http://10.177.29.121:3000/ping`

## Chạy

```bash
pip install -r requirements.txt
python -m app.main
```
