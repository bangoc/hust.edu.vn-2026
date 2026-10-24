# Reader

### Ví dụ

HTML:
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

File
```bash
curl -X POST 10.177.29.30:6600/parse \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://hust.edu.vn/uploads/sys/van-ban/quy-che-dao-tao.pdf",
    "format": "other",
    "content_type": "application/pdf",
    "encoding": "base64",
    "content": "JVBERi0xLjQKJcfsj6......" # b64
  }'
```
