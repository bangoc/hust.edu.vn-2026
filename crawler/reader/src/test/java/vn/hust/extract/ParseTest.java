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
    private HttpServer storage, mediator, main, bare;
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> mediatorBody = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicInteger mediatorCalls = new AtomicInteger();
    private volatile int storageStatus = 200, mediatorStatus = 200;

    @BeforeEach
    void setUp() throws Exception {
        storage = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        storage.createContext("/add", ex -> {
            lastBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            calls.incrementAndGet();
            byte[] err = "{\"error\":\"thiếu title\"}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(storageStatus, storageStatus == 200 ? -1 : err.length);
            if (storageStatus != 200) ex.getResponseBody().write(err);
            ex.close();
        });
        storage.createContext("/page", ex -> {  // trang web giả cho /fetch
            byte[] b = HTML.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
            ex.sendResponseHeaders(200, b.length);
            try (var os = ex.getResponseBody()) {
                os.write(b);
            }
        });
        storage.start();
        mediator = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        mediator.createContext("/add", ex -> {
            mediatorBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            mediatorCalls.incrementAndGet();
            ex.sendResponseHeaders(mediatorStatus, -1);
            ex.close();
        });
        mediator.start();
        main = Main.start(0, "http://127.0.0.1:" + storage.getAddress().getPort() + "/add",
                "http://127.0.0.1:" + mediator.getAddress().getPort() + "/add", false);
        bare = Main.start(0, "", "", true);
    }

    @AfterEach
    void tearDown() {
        storage.stop(0);
        mediator.stop(0);
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
            + "<p>Đây là đoạn văn đủ dài để làm khối nội dung chính, có <a href='/b'>liên kết</a> ở giữa, và <a href='https://example.com/x'>link ngoài</a>.</p></body>";

    @Test
    void htmlIsForwarded() throws Exception {
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(200, r.statusCode());
        assertEquals(2, JSON.readTree(r.body()).get("n_out_links").asInt());
        assertEquals(1, JSON.readTree(r.body()).get("n_hust_links").asInt());
        JsonNode f = JSON.readTree(lastBody.get());
        assertEquals("[url, format, title, content, intro, out-links]", f.properties().stream().map(Map.Entry::getKey).toList().toString());
        assertEquals("html", f.get("format").asText());
        assertEquals("Tiêu đề", f.get("title").asText());
        assertEquals("Sapo", f.get("intro").asText());
        assertEquals("https://hust.edu.vn/b", f.get("out-links").get(0).get("url").asText());
        assertTrue(f.get("out-links").get(0).get("text").asText().contains("có liên kết ở giữa"));
        assertEquals("https://example.com/x", f.get("out-links").get(1).get("url").asText());
        assertEquals("{\"urls\":[\"https://hust.edu.vn/b\"]}", mediatorBody.get());
    }

    @Test
    void outLinkUrlsAreEncoded() throws Exception {
        String html = "<h1>T</h1><p>Đoạn văn đủ dài để làm khối nội dung chính, có <a href='/tài liệu.pdf'>tệp</a>.</p>";
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://soict.hust.edu.vn/a", "format", "html", "encoding", "text", "content", html)));
        assertEquals(200, r.statusCode());
        String enc = "https://soict.hust.edu.vn/t%C3%A0i%20li%E1%BB%87u.pdf";
        assertEquals(enc, JSON.readTree(lastBody.get()).get("out-links").get(0).get("url").asText());
        assertEquals("{\"urls\":[\"" + enc + "\"]}", mediatorBody.get());
    }

    @Test
    void noHustLinksSkipsMediator() throws Exception {
        String html = "<h1>T</h1><p>Đoạn văn đủ dài để làm khối nội dung chính, có <a href='https://example.com/x'>link ngoài</a>.</p>";
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", html)));
        assertEquals(200, r.statusCode());
        assertEquals(0, JSON.readTree(r.body()).get("n_hust_links").asInt());
        assertEquals(0, mediatorCalls.get());
    }

    @Test
    void withoutStorageReturnsRecord() throws Exception {
        var r = send(bare, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(200, r.statusCode());
        assertEquals("Tiêu đề", JSON.readTree(r.body()).at("/record/title").asText());
        assertEquals(0, calls.get());
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
        assertEquals("rtf", f.get("format").asText());
        assertEquals("f", f.get("title").asText());
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
        assertEquals("[url, format, title, content, base64, intro, metadata]", f.properties().stream().map(Map.Entry::getKey).toList().toString());
        assertEquals("png", f.get("format").asText());
        assertEquals(png, f.get("base64").asText());
        assertEquals("sơ đồ", f.get("title").asText());
        assertEquals("", f.get("content").asText());
        assertEquals("{\"mime\":\"image/png\",\"width\":40,\"height\":30}", f.get("metadata").toString());
        // url không đuôi: đuôi lấy từ kiểu Tika nhận dạng, tiêu đề là đoạn cuối đường dẫn
        send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/img/42", "format", "other", "encoding", "base64", "content", png)));
        f = JSON.readTree(lastBody.get());
        assertEquals("png", f.get("format").asText());
        assertEquals("42", f.get("title").asText());
    }

    @Test
    void emptyHtmlIs422() throws Exception {
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://a.vn/", "format", "html", "encoding", "text", "content", "<body></body>")));
        assertEquals(422, r.statusCode());
        assertEquals("https://a.vn/", JSON.readTree(r.body()).get("url").asText());
    }

    @Test
    void storageFailureIs502AndMediatorNotCalled() throws Exception {
        storageStatus = 400;
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(502, r.statusCode());
        assertEquals(2, calls.get());
        assertTrue(JSON.readTree(r.body()).get("detail").asText().startsWith("Lưu trữ không nhận: HTTP 400 {\"error\":\"thiếu title\"}"));
        assertEquals(0, mediatorCalls.get());
    }

    @Test
    void mediatorFailureIs502() throws Exception {
        mediatorStatus = 500;
        var r = send(main, "POST", "/parse", req(Map.of("url", "https://hust.edu.vn/a", "format", "html", "encoding", "text", "content", HTML)));
        assertEquals(502, r.statusCode());
        assertEquals(1, calls.get());
        assertEquals(2, mediatorCalls.get());
        assertTrue(JSON.readTree(r.body()).get("detail").asText().startsWith("Điều khiển không nhận: HTTP 500"));
    }

    @Test
    void fetchOutputFeedsParse() throws Exception {
        String page = "http://127.0.0.1:" + storage.getAddress().getPort() + "/page";
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
