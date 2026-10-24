# Kết nối MongoDB dùng chung

Máy cần cùng mạng LAN với server. URI kết nối:

```text
mongodb://192.168.0.176:27017
```

Không dùng username/password. Trong Compass chọn **Authentication: None** và
**tắt TLS/SSL**.

## Cấu hình `.env`

```dotenv
MONGODB_URI=mongodb://192.168.0.176:27017
MONGODB_DATABASE=HUST_2026_IT4863_TEST
MONGODB_COLLECTION=other
MONGODB_TIMEOUT_MS=5000
```

- Database dữ liệu chung: `HUST_2026_IT4863_TEST`.
- Cả hai có 4 collection: `html`, `picture`, `other`, `graph`.
- Ứng dụng cần đọc `.env` và truyền các giá trị vào MongoDB driver.
