package vn.hust.extract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ParseTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private HttpServer n8, main, bare;
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private volatile int n8Status = 200;

    @BeforeEach
    void setUp() throws Exception {
        n8 = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        n8.createContext("/add", ex -> {
            lastBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            calls.incrementAndGet();
            ex.sendResponseHeaders(n8Status, -1);
            ex.close();
        });
        n8.createContext("/page", ex -> {  // trang web giả cho /fetch
            byte[] b = HTML.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            ex.sendResponseHeaders(200, b.length);
            try (var os = ex.getResponseBody()) {
                os.write(b);
            }
        });
        n8.start();
        main = Main.start(0, "http://127.0.0.1:" + n8.getAddress().getPort() + "/add", false);
        bare = Main.start(0, "", true);
    }

    @AfterEach
    void tearDown() {
        n8.stop(0);
        main.stop(0);
        bare.stop(0);
    }

    private static HttpResponse<String> send(HttpServer s, String method, String path, String body) throws Exception {
        var b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + s.getAddress().getPort() + path));
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static String req(Map<String, ?> m) throws Exception {
        return JSON.writeValueAsString(m);
    }

    private static final String HTML = "<head><meta name=description content='Sapo'></head><body><h1>Tiêu đề</h1>"
            + "<p>Đây là đoạn văn đủ dài để làm khối nội dung chính, có <a href='/b'>liên kết</a> ở giữa.</p></body>";

    @Test
    void htmlIsForwarded() throws Exception {
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(200, r.statusCode());
        assertEquals(1, JSON.readTree(r.body()).get("n_out_links").asInt());
        JsonNode f = JSON.readTree(lastBody.get());
        assertEquals("[url, format, title, content, intro, out-links]", f.properties().stream().map(Map.Entry::getKey).toList().toString());
        assertEquals("https://hust.edu.vn/a", f.get("url").asText());
        assertEquals("Tiêu đề", f.get("title").asText());
        assertEquals("Sapo", f.get("intro").asText());
        assertEquals(2, f.get("out-links").get(0).size());
        assertEquals("https://hust.edu.vn/b", f.get("out-links").get(0).get(0).asText());
        assertTrue(f.get("out-links").get(0).get(1).asText().contains("có liên kết ở giữa"));
    }

    @Test
    void withoutAggregatorReturnsRecord() throws Exception {
        var r = send(bare, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(200, r.statusCode());
        assertEquals("Tiêu đề", JSON.readTree(r.body()).at("/record/title").asText());
    }

    @Test
    void badRequests() throws Exception {
        assertEquals(400, send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/", "format", "html", "encoding", "text"))).statusCode());
        assertEquals(400, send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/x.pdf", "format", "other", "encoding", "base64", "content", "@@@"))).statusCode());
        assertEquals(400, send(main, "POST", "/parse", req(Map.of("url", "ftp://a.vn/", "format", "html", "encoding", "text", "content", "x"))).statusCode());
        assertEquals(400, send(main, "POST", "/parse", "không phải json").statusCode());
    }

    @Test
    void randomBytesAsOtherIs415() throws Exception {
        byte[] junk = new byte[2000];
        new Random(1).nextBytes(junk);
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/f.xyz", "format", "other", "encoding", "base64",
                "content", Base64.getEncoder().encodeToString(junk))));
        assertEquals(415, r.statusCode());
        assertEquals("không đọc được tệp .xyz", JSON.readTree(r.body()).get("detail").asText());
    }

    @Test
    void rtfAsOtherIsForwarded() throws Exception {
        byte[] rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0 Hello Tika\\par}".getBytes(StandardCharsets.US_ASCII);
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/f.RTF", "format", "other", "encoding", "base64",
                "content", Base64.getEncoder().encodeToString(rtf))));
        assertEquals(200, r.statusCode());
        JsonNode f = JSON.readTree(lastBody.get());
        assertEquals("other", f.get("format").asText());
        assertEquals("rtf", f.get("ext").asText());
        assertEquals("Hello Tika", f.get("content").asText());
    }

    @Test
    void imageGivesTitleAndMetadata() throws Exception {
        var bos = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(40, 30, java.awt.image.BufferedImage.TYPE_INT_RGB), "png", bos);
        String png = Base64.getEncoder().encodeToString(bos.toByteArray());
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/anh/s%C6%A1%20%C4%91%E1%BB%93.png", "format", "other",
                "encoding", "base64", "content", png)));
        assertEquals(200, r.statusCode());
        JsonNode f = JSON.readTree(lastBody.get());
        assertEquals("[url, format, ext, title, content, intro, metadata]", f.properties().stream().map(Map.Entry::getKey).toList().toString());
        assertEquals("png", f.get("ext").asText());
        assertEquals("sơ đồ", f.get("title").asText());
        assertEquals("", f.get("content").asText());
        assertEquals("{\"mime\":\"image/png\",\"width\":40,\"height\":30}", f.get("metadata").toString());
        // url không đuôi: đuôi lấy từ kiểu Tika nhận dạng, tiêu đề là đoạn cuối đường dẫn
        send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/img/42", "format", "other", "encoding", "base64", "content", png)));
        f = JSON.readTree(lastBody.get());
        assertEquals("png", f.get("ext").asText());
        assertEquals("42", f.get("title").asText());
    }

    @Test
    void emptyHtmlIs422() throws Exception {
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/", "format", "html", "encoding", "text", "content", "<body></body>")));
        assertEquals(422, r.statusCode());
        assertEquals("https://a.vn/", JSON.readTree(r.body()).get("url").asText());
    }

    @Test
    void aggregatorFailureIs502AfterRetry() throws Exception {
        n8Status = 500;
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(502, r.statusCode());
        assertEquals(2, calls.get());
    }

    @Test
    void fetchOutputFeedsParse() throws Exception {
        String page = "http://127.0.0.1:" + n8.getAddress().getPort() + "/page";
        var f = send(bare, "POST", "/fetch", req(Map.of("url", page)));
        assertEquals(200, f.statusCode());
        assertEquals("html", JSON.readTree(f.body()).get("format").asText());
        var r = send(bare, "POST", "/parse", f.body());
        assertEquals(200, r.statusCode());
        assertEquals("Tiêu đề", JSON.readTree(r.body()).get("record").get("title").asText());
        assertEquals(404, send(main, "POST", "/fetch", req(Map.of("url", page))).statusCode());  // tắt mặc định
    }

    @Test
    void pingIdle() throws Exception {
        assertEquals("đang chờ", JSON.readTree(send(main, "GET", "/ping", null).body()).get("status").asText());
    }
}
