package vn.hust.extract;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.metadata.TIFF;
import org.apache.tika.metadata.TikaCoreProperties;

/** Xử lý request: {@code /ping}, {@code /parse}, gửi sang Lưu trữ và Điều khiển, ghi lỗi ra JSON. */
public final class Api {
    private Api() {}

    private static final Pattern CHARSET = Pattern.compile("charset=\"?([^\";\\s]+)", Pattern.CASE_INSENSITIVE);
    /** {@code format} Lưu trữ chấp nhận. */
    private static final Pattern FORMAT = Pattern.compile("[a-z0-9][a-z0-9.+_-]{0,31}");
    private static final int MAX_BODY = 50 * 1024 * 1024;
    /** Jackson mặc định chặn chuỗi quá 20 triệu ký tự, tức body base64 ~20 MB; nới bằng MAX_BODY. */
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxStringLength(MAX_BODY).build()).build());
    /** Cắt chữ để bản ghi không quá lớn. */
    static final int MAX_CHARS = 1_000_000;
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private static final HttpClient DOWNLOAD = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(30)).build();
    private static final String BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    private static final AtomicInteger BUSY = new AtomicInteger();
    private static final Map<String, String> MIME_TO_EXT = Map.of(
            "application/pdf", "pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx",
            "application/msword", "doc",
            "application/vnd.ms-excel", "xls",
            "application/vnd.ms-powerpoint", "ppt");

    /** Lỗi có mã HTTP, trả cho client dưới dạng {@code {"detail": ...}} (thêm {@code url} nếu có). */
    static final class HttpError extends RuntimeException {
        final int status;
        final String url;

        HttpError(int status, String detail) {
            this(status, detail, null);
        }

        HttpError(int status, String detail, String url) {
            super(detail);
            this.status = status;
            this.url = url;
        }
    }

    /** Chạy một handler, ghi kết quả hay lỗi ra JSON. */
    static void handle(HttpExchange ex, String method, java.util.function.Supplier<Object> body) throws IOException {
        int status = 200;
        Object out;
        try {
            if (!ex.getRequestMethod().equals(method)) throw new HttpError(405, "chỉ nhận " + method);
            out = body.get();
        } catch (HttpError e) {
            status = e.status;
            out = e.url == null ? Map.of("detail", e.getMessage()) : Map.of("detail", e.getMessage(), "url", e.url);
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

    /** {@code GET /ping}. */
    static Map<String, Object> ping() {
        int n = BUSY.get();
        return n == 0 ? Map.of("status", "đang chờ") : Map.of("status", "đang xử lý", "dang_xu_ly", n);
    }

    /**
     * {@code POST /fetch {"url"}}: Tải url, trả đúng body mà {@code /parse} nhận
     * ({@code encoding} base64). Chỉ bật khi {@code DEMO_FETCH=1}, vì nó tải bất kỳ url nào được gửi tới.
     */
    static Map<String, Object> fetch(HttpExchange ex) {
        String url;
        try (var in = ex.getRequestBody()) {
            JsonNode b = JSON.readTree(in.readNBytes(64 * 1024));
            url = b == null ? "" : b.path("url").asText("").strip();
        } catch (IOException e) {
            throw new HttpError(400, "body phải là JSON {\"url\": \"...\"}");
        }
        checkUrl(url);
        int maxFile = MAX_BODY / 4 * 3;  // base64 làm tệp to thêm 1/3
        HttpResponse<java.io.InputStream> r;
        byte[] data;
        try {
            r = DOWNLOAD.send(HttpRequest.newBuilder(httpUri(url)).timeout(Duration.ofSeconds(60))
                    .header("User-Agent", BROWSER_UA).build(), HttpResponse.BodyHandlers.ofInputStream());
            try (var in = r.body()) {
                data = in.readNBytes(maxFile + 1);
            }
        } catch (IOException e) {
            throw new HttpError(502, "không tải được: " + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new HttpError(502, "không tải được: bị ngắt");
        }
        if (r.statusCode() >= 400) throw new HttpError(502, "site trả HTTP " + r.statusCode());
        if (data.length > maxFile) throw new HttpError(413, "tệp vượt " + maxFile / 1024 / 1024 + " MB");
        String contentType = r.headers().firstValue("Content-Type").orElse("");
        String mime = contentType.split(";", -1)[0].strip().toLowerCase(Locale.ROOT);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("url", url);
        if (!r.uri().equals(httpUri(url))) out.put("final_url", r.uri().toString());
        out.put("format", mime.isEmpty() || mime.contains("html") ? "html" : "other");
        out.put("content_type", contentType);
        out.put("encoding", "base64");
        out.put("content", Base64.getEncoder().encodeToString(data));
        return out;
    }

    /** {@code POST /parse}: đọc body, bóc, chuyển tiếp; ghi một dòng nhật ký mỗi request. */
    static Map<String, Object> parse(HttpExchange ex, String storageUrl, String mediatorUrl) {
        long t0 = System.nanoTime();
        int status = 200;
        Object nLinks = 0;
        String url = "", format = "";
        BUSY.incrementAndGet();
        try {
            byte[] raw;
            try (var in = ex.getRequestBody()) {
                raw = in.readNBytes(MAX_BODY + 1);
            } catch (IOException e) {
                throw new HttpError(400, "không đọc được body");
            }
            if (raw.length > MAX_BODY) throw new HttpError(413, "body vượt " + MAX_BODY / 1024 / 1024 + " MB");
            JsonNode b;
            try {
                b = JSON.readTree(raw);
            } catch (IOException e) {
                throw new HttpError(400, "body phải là JSON");
            }
            if (b == null || !b.isObject()) throw new HttpError(400, "body phải là JSON object");
            url = b.path("url").asText("");
            format = b.path("format").asText("");
            Map<String, Object> res = parse(b, storageUrl, mediatorUrl);
            nLinks = res.get("n_out_links");
            return res;
        } catch (HttpError e) {
            status = e.status;
            throw e;
        } finally {
            BUSY.decrementAndGet();
            System.err.printf("parse url=%s format=%s status=%d %d ms n_out_links=%s%n", url, format, status,
                    (System.nanoTime() - t0) / 1_000_000, nLinks);
        }
    }

    private static Map<String, Object> parse(JsonNode b, String storageUrl, String mediatorUrl) {
        String url = b.path("url").asText("");
        String format = b.path("format").asText("");
        String encoding = b.path("encoding").asText("");
        String content = b.path("content").asText("");
        String contentType = b.path("content_type").asText("");
        String finalUrl = b.path("final_url").asText("");
        if (url.isEmpty() || content.isEmpty() || format.isEmpty() || encoding.isEmpty())
            throw new HttpError(400, "thiếu khoá bắt buộc: url, format, encoding, content");
        if (!format.equals("html") && !format.equals("other")) throw new HttpError(400, "format phải là html hoặc other");
        if (!encoding.equals("text") && !encoding.equals("base64")) throw new HttpError(400, "encoding phải là text hoặc base64");
        checkUrl(url);
        if (!finalUrl.isEmpty()) checkUrl(finalUrl);
        String base = finalUrl.isEmpty() ? url : finalUrl;
        byte[] bytes = null;
        if (encoding.equals("base64")) {
            try {
                bytes = Base64.getDecoder().decode(content);
            } catch (IllegalArgumentException e) {
                throw new HttpError(400, "base64 hỏng");
            }
        }

        Map<String, Object> rec = new LinkedHashMap<>();  // chính là body gửi Lưu trữ
        rec.put("url", url);
        List<String> hustUrls = new ArrayList<>();
        int nLinks = 0;
        if (format.equals("html")) {
            String html = bytes == null ? content : new String(bytes, charsetOf(contentType));
            ContentBlock.Page p = ContentBlock.extract(html, base);
            if (p.title().isEmpty() && p.text().isEmpty()) throw new HttpError(422, "không bóc được chữ", url);
            List<Map<String, String>> links = new ArrayList<>();
            for (ContentBlock.Link l : p.links()) {
                // Lưu trữ từ chối cả bản ghi nếu một url có dấu cách, chữ có dấu hay user@: mã hoá, bỏ url hỏng
                URI u;
                try {
                    u = httpUri(l.url());
                } catch (IllegalArgumentException e) {
                    continue;
                }
                if (u.getHost() == null || u.getUserInfo() != null) continue;
                String lu = u.toString();
                links.add(Map.of("url", lu, "text", l.text()));
                if (isHust(u.getHost()) && !hustUrls.contains(lu)) hustUrls.add(lu);
            }
            nLinks = links.size();
            String title = p.title().isBlank() ? fileTitle(base) : p.title();
            rec.put("format", "html");
            rec.put("title", title);
            // Lưu trữ bắt buộc có content: trang không có chữ thì dùng tiêu đề
            rec.put("content", p.text().isEmpty() ? title : head(p.text()));
            rec.put("intro", p.intro());
            rec.put("out-links", links);
        } else {
            String ext = extOf(base, contentType);
            byte[] data = bytes == null ? content.getBytes(StandardCharsets.UTF_8) : bytes;
            DocumentText.Text t = DocumentText.extract(data);
            if (t.mime().equals("application/octet-stream"))
                throw new HttpError(415, "không đọc được tệp" + (ext.isEmpty() ? "" : " ." + ext));
            String title = t.meta().get(TikaCoreProperties.TITLE);
            title = title == null || title.isBlank() ? fileTitle(base) : title.strip();
            if (t.mime().startsWith("image/")) {
                // ảnh: không OCR, chỉ tiêu đề và metadata; byte ảnh gửi Lưu trữ qua base64
                String desc = t.meta().get(TikaCoreProperties.DESCRIPTION);
                rec.put("format", formatOf(ext.isEmpty() ? t.mime().substring("image/".length()).replace("+xml", "") : ext));
                rec.put("title", title);
                rec.put("content", "");
                rec.put("base64", Base64.getEncoder().encodeToString(data));
                rec.put("intro", desc == null ? "" : desc.strip());
                rec.put("metadata", imageMeta(t));
            } else {
                if (t.text().isEmpty()) throw new HttpError(422, "không bóc được chữ", url);
                rec.put("format", formatOf(ext));
                rec.put("title", title);
                rec.put("content", head(t.text()));
            }
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("status", "ok");
        res.put("url", url);
        res.put("format", format);
        res.put("n_out_links", nLinks);
        res.put("n_hust_links", hustUrls.size());
        res.put("chars", ((String) rec.get("content")).length());
        if (storageUrl.isEmpty()) res.put("record", rec);
        else forward(storageUrl, rec, "Lưu trữ");
        if (!mediatorUrl.isEmpty() && !hustUrls.isEmpty()) forward(mediatorUrl, Map.of("urls", hustUrls), "Điều khiển");
        return res;
    }

    /** Host là {@code hust.edu.vn} hoặc tên miền con của nó. */
    private static boolean isHust(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        return h.equals("hust.edu.vn") || h.endsWith(".hust.edu.vn");
    }

    /** Đuôi tệp làm {@code format} gửi Lưu trữ; rỗng hoặc không khớp {@code [a-z0-9][a-z0-9.+_-]{0,31}} thì "other". */
    private static String formatOf(String ext) {
        ext = ext.toLowerCase(Locale.ROOT);
        return FORMAT.matcher(ext).matches() ? ext : "other";
    }

    /** POST JSON sang một service, thử lại một lần; lỗi thì 502 kèm tên service và lý do (có đoạn đầu body trả về). */
    private static void forward(String target, Object body, String name) {
        String reason = "";
        for (int i = 0; i < 2; i++) {
            try {
                var req = HttpRequest.newBuilder(URI.create(target)).timeout(Duration.ofSeconds(10))
                        .header("Content-Type", "application/json; charset=utf-8")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(JSON.writeValueAsBytes(body))).build();
                var r = HTTP.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (r.statusCode() / 100 == 2) return;
                String snip = r.body().strip();
                reason = "HTTP " + r.statusCode() + (snip.isEmpty() ? "" : " " + (snip.length() <= 200 ? snip : snip.substring(0, 200)));
            } catch (IOException | IllegalArgumentException e) {
                reason = e.toString();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                reason = "bị ngắt";
                break;
            }
        }
        throw new HttpError(502, name + " không nhận: " + reason);
    }

    /** Đuôi tệp: từ đoạn cuối đường dẫn, không có thì đổi từ MIME; không biết thì rỗng. */
    private static String extOf(String base, String contentType) {
        String path = httpUri(base).getPath();
        path = path.substring(path.lastIndexOf('/') + 1);
        int dot = path.lastIndexOf('.');
        if (dot >= 0 && dot < path.length() - 1) return path.substring(dot + 1).toLowerCase(Locale.ROOT);
        return MIME_TO_EXT.getOrDefault(contentType.split(";", -1)[0].strip().toLowerCase(Locale.ROOT), "");
    }

    /** Tên tệp trong url (đã giải %XX, bỏ đuôi) làm tiêu đề ảnh; đường dẫn rỗng thì lấy host. */
    private static String fileTitle(String base) {
        URI u = httpUri(base);
        String name = u.getPath() == null ? "" : u.getPath().substring(u.getPath().lastIndexOf('/') + 1);
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        return name.isBlank() ? u.getHost() : name.strip();
    }

    /** Metadata ảnh đã chuẩn hoá của Tika: kiểu, kích thước điểm ảnh, ngày chụp, tác giả, máy; khoá không có thì bỏ. */
    private static Map<String, Object> imageMeta(DocumentText.Text t) {
        Metadata m = t.meta();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mime", t.mime());
        Integer w = m.getInt(TIFF.IMAGE_WIDTH), h = m.getInt(TIFF.IMAGE_LENGTH);
        if (w != null) out.put("width", w);
        if (h != null) out.put("height", h);
        putText(out, "created", m.get(TikaCoreProperties.CREATED));
        putText(out, "creator", m.get(TikaCoreProperties.CREATOR));
        putText(out, "camera", (Objects.toString(m.get(TIFF.EQUIPMENT_MAKE), "") + " "
                + Objects.toString(m.get(TIFF.EQUIPMENT_MODEL), "")));
        return out;
    }

    private static void putText(Map<String, Object> out, String key, String value) {
        if (value != null && !value.isBlank()) out.put(key, value.strip());
    }

    private static String head(String s) {
        return s.length() <= MAX_CHARS ? s : s.substring(0, MAX_CHARS);
    }

    /** url phải là http(s) đầy đủ có host, nếu không 400. */
    private static void checkUrl(String url) {
        URI u;
        try {
            u = httpUri(url);
        } catch (IllegalArgumentException e) {
            u = null;
        }
        if (u == null || u.getHost() == null || !"http".equalsIgnoreCase(u.getScheme()) && !"https".equalsIgnoreCase(u.getScheme()))
            throw new HttpError(400, "url phải là HTTP hoặc HTTPS đầy đủ: " + url);
    }

    /** Url -> URI: mã hoá ký tự không hợp lệ (dấu cách, chữ có dấu) thành %XX, giữ các %XX đã có. */
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
}
