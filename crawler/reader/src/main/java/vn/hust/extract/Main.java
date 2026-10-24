package vn.hust.extract;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Dịch vụ "Đọc nội dung" (N1): nhận tài liệu đã tải, bóc rồi gửi thẳng sang Lưu trữ và Điều khiển. Cổng {@code PORT}
 * (mặc định 6600), {@code STORAGE_URL} là địa chỉ {@code /add} của Lưu trữ, {@code MEDIATOR_URL} là địa chỉ
 * {@code /add} của Điều khiển.
 * <ul>
 *   <li>{@code GET /ping}: {@code {"status":"đang chờ"}}, hoặc {@code {"status":"đang xử lý","dang_xu_ly":n}} khi có n
 *       request {@code /parse} đang chạy.</li>
 *   <li>{@code POST /parse} body {@code {url, final_url?, format: html|other, content_type?, encoding: text|base64,
 *       content}}: html bóc bằng {@link ContentBlock} (tiêu đề, chữ, intro, liên kết ra), tệp khác bằng Tika; ảnh
 *       không OCR, chỉ có tiêu đề (dc:title hoặc tên tệp), intro (mô tả EXIF/XMP), {@code content} rỗng và
 *       {@code metadata} (mime, width, height, created, creator, camera). Bản ghi
 *       POST sang Lưu trữ, rồi {@code {"urls": [...]}} (liên kết ra thuộc hust.edu.vn) POST sang Điều khiển (mỗi nơi
 *       10 s, thử lại một lần), trả {@code {"status":"ok","url","format","n_out_links","n_hust_links","chars"}}.
 *       Chưa đặt {@code STORAGE_URL} thì không gửi Lưu trữ mà trả thêm {@code "record"} (chạy thử); chưa đặt
 *       {@code MEDIATOR_URL} thì không gọi Điều khiển.</li>
 *   <li>{@code POST /fetch} body {@code {url}} (chỉ khi {@code DEMO_FETCH=1}): tải url, trả body cho {@code /parse}. Tạm
 *       thay Tải về (N5) cho trang demo.</li>
 * </ul>
 * Lỗi trả {@code {"detail": "..."}}: 400 request sai, 413 quá 50 MB, 415 tệp không nhận dạng được, 422 không có chữ,
 * 502 Lưu trữ hoặc Điều khiển không nhận. Xử lý request nằm ở {@link Api}.
 */
public final class Main {
    public static void main(String[] args) throws IOException {
        Map<String, String> env = System.getenv();
        start(Integer.parseInt(env.getOrDefault("PORT", "6600")), env.getOrDefault("STORAGE_URL", ""),
                env.getOrDefault("MEDIATOR_URL", ""), "1".equals(env.get("DEMO_FETCH")));
    }

    /** Dựng và chạy server; {@code port} 0 là cổng tự chọn (test), {@code demoFetch} bật {@code /fetch} cho trang demo. */
    static HttpServer start(int port, String storageUrl, String mediatorUrl, boolean demoFetch) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/ping", ex -> Api.handle(ex, "GET", Api::ping));
        server.createContext("/parse", ex -> Api.handle(ex, "POST", () -> Api.parse(ex, storageUrl, mediatorUrl)));
        if (demoFetch) server.createContext("/fetch", ex -> Api.handle(ex, "POST", () -> Api.fetch(ex)));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.err.println("reader-service listening on: " + server.getAddress().getPort());
        return server;
    }
}
