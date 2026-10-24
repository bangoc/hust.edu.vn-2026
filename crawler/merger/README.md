# merger — Tổng hợp dữ liệu

Địa chỉ: `http://10.177.29.121:3000`

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
