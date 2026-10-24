package vn.hust.extract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.ReplaceOptions;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bson.Document;

/**
 * HTTP server bóc tách một url.
 * <ul>
 *   <li>{@code GET /health}</li>
 *   <li>{@code POST /extract} body {@code {"url": "..."}}: tải, bóc chữ (HTML bằng {@link ContentBlock}, tệp khác
 *       bằng Tika), lưu Mongo ({@code pages} hoặc {@code documents}, {@code _id} = url), trả JSON kết quả.</li>
 * </ul>
 * Lỗi trả {@code {"detail": "..."}}.
 */
public final class Main {
    private static final String BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    private static final Pattern CHARSET = Pattern.compile("charset=\"?([^\";\\s]+)", Pattern.CASE_INSENSITIVE);
    private static final ObjectMapper JSON = new ObjectMapper();
    /** Khoảng cách tối thiểu giữa hai lần tải: hust.edu.vn trả 429 khi vượt ~20 request/phút. */
    private static final long FETCH_INTERVAL_MS = 3000;
    private static final int MAX_BODY = 64 * 1024;
    /** Cắt chữ để bản ghi không vượt giới hạn 16MB của Mongo. */
    private static final int MAX_CHARS = 500_000;
    private static final String TIKA_URL = System.getenv().getOrDefault("TIKA_URL", "http://localhost:9998");

    private static final HttpClient HTTP = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(30)).build();
    private static long lastFetch = 0;
    private static MongoDatabase db;

    /** Lỗi có mã HTTP, trả cho client dưới dạng {@code {"detail": ...}}. */
    static final class HttpError extends RuntimeException {
        final int status;

        HttpError(int status, String detail) {
            super(detail);
            this.status = status;
        }
    }

    record Fetched(String url, String contentType, byte[] body) {}

    public static void main(String[] args) throws IOException {
        Map<String, String> env = System.getenv();
        int port = Integer.parseInt(env.getOrDefault("PORT", "8080"));
        db = MongoClients.create(env.getOrDefault("MONGO_URL", "mongodb://localhost:27017"))
                .getDatabase(env.getOrDefault("MONGO_DB", "hust_extract"));

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", ex -> handle(ex, "GET", () -> Map.of("status", "ok")));
        server.createContext("/extract", ex -> handle(ex, "POST", () -> extract(readUrl(ex))));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.err.println("hust-extract nghe cổng " + port);
    }

    /** Chạy một handler, ghi kết quả hay lỗi ra JSON. */
    private static void handle(HttpExchange ex, String method, java.util.function.Supplier<Object> body) throws IOException {
        int status = 200;
        Object out;
        try {
            if (!ex.getRequestMethod().equals(method)) throw new HttpError(405, "chỉ nhận " + method);
            out = body.get();
        } catch (HttpError e) {
            status = e.status;
            out = Map.of("detail", e.getMessage());
        } catch (RuntimeException e) {
            e.printStackTrace();
            status = 500;
            out = Map.of("detail", String.valueOf(e));
        }
        byte[] b = JSON.writeValueAsBytes(out);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");  // cho trang demo mở từ file:// đọc được kết quả
        ex.sendResponseHeaders(status, b.length);
        try (var os = ex.getResponseBody()) {
            os.write(b);
        }
    }

    /** Lấy và kiểm tra {@code url} trong body JSON. */
    static String readUrl(HttpExchange ex) {
        JsonNode b;
        try (var in = ex.getRequestBody()) {
            b = JSON.readTree(in.readNBytes(MAX_BODY));
        } catch (IOException e) {
            throw new HttpError(400, "body phải là JSON {\"url\": \"...\"}");
        }
        String url = b == null ? "" : b.path("url").asText("").strip();
        URI u;
        try {
            u = httpUri(url);
        } catch (IllegalArgumentException e) {
            u = null;
        }
        if (u == null || u.getHost() == null || !"http".equalsIgnoreCase(u.getScheme()) && !"https".equalsIgnoreCase(u.getScheme()))
            throw new HttpError(422, "url phải là HTTP hoặc HTTPS đầy đủ");
        return url;
    }

    /** Tải url, bóc chữ, lưu Mongo, trả bản ghi. */
    static Map<String, Object> extract(String url) {
        Fetched f = fetch(url);
        String mime = f.contentType().split(";", -1)[0].strip().toLowerCase(Locale.ROOT);
        boolean html = mime.isEmpty() || mime.contains("html");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("url", f.url());
        out.put("content_type", f.contentType());
        out.put("fetched_at", Instant.now().toString());
        if (html) {
            ContentBlock.Page p = ContentBlock.extract(new String(f.body(), charsetOf(f.contentType())));
            out.put("title", p.title());
            out.put("text", head(p.text()));
            out.put("block", p.block());
        } else {
            out.put("text", head(tikaText(f.body())));
        }
        if (out.get("text").toString().isEmpty() && out.getOrDefault("title", "").toString().isEmpty())
            throw new HttpError(422, "không bóc được chữ");
        save(html ? "pages" : "documents", f.url(), out);
        return out;
    }

    /** Gửi tệp (pdf, docx, xlsx...) sang Tika server, nhận chữ thuần. Không OCR. */
    static String tikaText(byte[] data) {
        try {
            HttpResponse<String> r = HTTP.send(HttpRequest.newBuilder(URI.create(TIKA_URL + "/tika"))
                    .header("Accept", "text/plain").timeout(Duration.ofMinutes(5))
                    .PUT(HttpRequest.BodyPublishers.ofByteArray(data)).build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (r.statusCode() != 200) throw new HttpError(502, "Tika HTTP " + r.statusCode());
            return r.body().strip();
        } catch (IOException e) {
            throw new HttpError(502, "Tika: " + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new HttpError(502, "Tika: bị ngắt");
        }
    }

    private static String head(String s) {
        return s.length() <= MAX_CHARS ? s : s.substring(0, MAX_CHARS);
    }

    static Fetched fetch(String url) {
        synchronized (Main.class) {
            long wait = FETCH_INTERVAL_MS - (System.currentTimeMillis() - lastFetch);
            if (wait > 0) {
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            lastFetch = System.currentTimeMillis();
        }
        HttpResponse<byte[]> r;
        try {
            r = HTTP.send(HttpRequest.newBuilder(httpUri(url)).timeout(Duration.ofSeconds(60))
                    .header("User-Agent", BROWSER_UA).build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException | IllegalArgumentException e) {
            throw new HttpError(502, "không tải được: " + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new HttpError(502, "không tải được: bị ngắt");
        }
        if (r.statusCode() == 429) throw new HttpError(429, "site đang chặn nhịp, đợi rồi thử lại");
        if (r.statusCode() >= 400) throw new HttpError(502, "site trả HTTP " + r.statusCode());
        return new Fetched(r.uri().toString(), r.headers().firstValue("Content-Type").orElse(""), r.body());
    }

    /** Url -> URI cho HttpClient: mã hoá ký tự không hợp lệ (dấu cách, chữ có dấu) thành %XX, giữ các %XX đã có. */
    static URI httpUri(String url) {
        StringBuilder sb = new StringBuilder();
        byte[] b = url.strip().getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < b.length; i++) {
            int c = b[i] & 0xff;
            boolean pct = c == '%' && i + 2 < b.length && Character.digit(b[i + 1], 16) >= 0 && Character.digit(b[i + 2], 16) >= 0;
            if (pct || (c > 0x20 && c < 0x7f && " \"<>\\^`{|}%".indexOf(c) < 0)) sb.append((char) c);
            else sb.append(String.format("%%%02X", c));
        }
        return URI.create(sb.toString());
    }

    /** Bảng mã trong Content-Type; không có hoặc lạ thì UTF-8. */
    static Charset charsetOf(String contentType) {
        Matcher m = CHARSET.matcher(contentType);
        try {
            return m.find() ? Charset.forName(m.group(1)) : StandardCharsets.UTF_8;
        } catch (IllegalArgumentException e) {
            return StandardCharsets.UTF_8;
        }
    }

    /** Ghi đè bản ghi theo url: bóc lại cùng url không sinh bản trùng. */
    static void save(String collection, String url, Map<String, Object> record) {
        try {
            Document d = Document.parse(JSON.writeValueAsString(record)).append("_id", url);
            db.getCollection(collection).replaceOne(Filters.eq("_id", url), d, new ReplaceOptions().upsert(true));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
