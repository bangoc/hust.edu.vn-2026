# mediator (Điều khiển, nhóm BAT, cổng 5200)

| Nhóm | Cần làm |
|---|---|
| **N8 · merger** | Gửi url vào mediator bằng `POST /add`. Xem [mục 1](#1-n8--merger-gửi-url-vào-mediator). |
| **N5 · downloader** | Làm hai endpoint `GET /ping` và `POST /load` để mediator gọi. Xem [mục 2](#2-n5--downloader-làm-hai-endpoint-cho-mediator-gọi). |

Địa chỉ của mediator: `http://<ip-máy-BAT>:5200`. 

## 1. N8 · merger: gửi url vào mediator

Chỉ có **một** endpoint:

```
POST http://<ip-máy-BAT>:5200/add
```

Gửi lên một danh sách url:

```json
{"urls": ["https://hust.edu.vn/", "https://hust.edu.vn/tin-tuc1", "https://soict.hust.edu.vn/"]}
```

mediator trả lời **ngay**, không chờ tải xong:

```json
{"accepted": 2, "duplicates": 1, "rejected": 0}
```

- `accepted`: số url mới, đã vào hàng đợi.
- `duplicates`: số url đã gửi trước đó. mediator bỏ qua, không tải thêm lần nữa.
- `rejected`: số chuỗi không phải địa chỉ web (`mailto:`, `ftp:`, sai cú pháp). mediator bỏ qua.

Gửi sai dạng (không phải JSON, hoặc không có `urls`) thì nhận mã `400` kèm `{"error": "<lý do>"}`.

**Thử bằng curl:**

```bash
curl -X POST http://<ip-máy-BAT>:5200/add -d '{"urls": ["https://hust.edu.vn/"]}'
# {"accepted": 1, "duplicates": 0, "rejected": 0}
```

**Ví dụ Python:**

```python
import requests

r = requests.post(
    "http://<ip-máy-BAT>:5200/add", json={"urls": ["https://hust.edu.vn/"]}, timeout=10
)
print(r.json())  # {'accepted': 1, 'duplicates': 0, 'rejected': 0}
```

**Khi nào gửi:**

1. Lúc khởi động: gửi tập url mầm.
2. Mỗi khi nhận kết quả từ reader: lọc link (chỉ giữ miền hust), rồi gửi các url **mới**. Nên gom vài trăm url
   thành một lần gửi thay vì gửi từng url.

**Lưu ý:**

- Gửi trùng không sao, mediator tự bỏ url đã có.
- Không cần gửi lại url cũ để cập nhật nội dung. mediator tự đưa lại url sau 1 ngày (trang chủ), 7 ngày (trang
  thường) hoặc 30 ngày (tài liệu).
- Gửi lỗi (mất kết nối, mã `5xx`) thì thử lại. Url đã gửi thành công được lưu trên đĩa, không mất khi mediator
  khởi động lại.

## 2. N5 · downloader: làm hai endpoint cho mediator gọi

mediator gọi downloader theo hai bước: hỏi **rảnh chưa**, rảnh thì **gửi một url**.

| Endpoint | mediator gửi | downloader phải trả lời |
|---|---|---|
| `GET /ping` | (không có body) | Rảnh: `{"status": "đang chờ"}`<br/>Đang tải: `{"status": "đang bận"}` |
| `POST /load` | `{"url": "https://hust.edu.vn/"}` | Nhận url: mã `202`, `{"status": "đã nhận"}`<br/>Đang bận: mã `409` |

**Bốn quy tắc cần làm đúng:**

1. **Chuỗi trạng thái phải viết đúng, có dấu:** `"đang chờ"`, `"đang bận"`. Viết `"idle"` hay `"dang cho"` thì
   mediator không hiểu và sẽ không gửi url.
2. **`/load` phải trả lời ngay, rồi mới tải.** Nhận url thì trả `202` liền, việc tải chạy ở nền. Nếu tải xong mới
   trả lời, trang nào tải lâu hơn 10 giây sẽ bị mediator tính là lỗi.
3. **Mỗi lúc chỉ tải một url.** Đang tải thì `/ping` trả `"đang bận"` và `/load` trả `409`. Tải xong thì `/ping`
   trả lại `"đang chờ"` để nhận url tiếp theo.
4. **Tải xong thì gửi thẳng sang reader** (`POST http://<ip-N1>:6600/parse`). Không gửi gì về mediator.

Nếu downloader không trả lời `/ping` trong 2 giây, mediator chờ 30 giây rồi mới hỏi lại. Url vẫn nằm trong hàng
đợi, không mất.

**Tự kiểm tra trước khi ghép:**

```bash
curl http://localhost:8800/ping
# {"status": "đang chờ"}
curl -i -X POST http://localhost:8800/load -d '{"url": "https://hust.edu.vn/"}'
# HTTP/1.1 202 Accepted ...      (phải trả về ngay)
curl http://localhost:8800/ping
# {"status": "đang bận"}         (trong lúc đang tải)
```
## 3. BAT · xuất các url đã nhận và đã gửi

Chạy trên máy BAT, lúc container mediator đang chạy:

```bash
cd crawler/mediator
./export_urls.sh
# out/urls.csv: 20 url (20 đã gửi)
# out/nhan_gui.log: 20 dòng
```