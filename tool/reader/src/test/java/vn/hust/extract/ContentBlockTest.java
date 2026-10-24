package vn.hust.extract;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;

class ContentBlockTest {
    private static final String P = "Đây là một đoạn văn đủ dài để được tính điểm nội dung chính. ";

    @Test
    void picksArticleOverMenuAndFooter() {
        String html = "<title>Trang - HUST</title><body><nav><ul><li><a href=/>Trang chủ</a></li><li><a href=/a>Tin tức và sự kiện của trường</a></li></ul></nav>"
                + "<div id=main><h1>Tiêu đề</h1><p>" + P + "<span>" + P + "</span></p><p>" + P + "</p></div>"
                + "<div id=side><p>" + P + "</p></div><footer><p>Địa chỉ: số 1 Đại Cồ Việt, Hà Nội</p></footer></body>";
        var p = ContentBlock.extract(html, "https://hust.edu.vn/");
        assertEquals("#main", p.block());
        assertEquals("Tiêu đề", p.title());
    }

    @Test
    void fallsBackToBodyWithoutText() {
        assertEquals("body", ContentBlock.find(Jsoup.parse("<body><a href=/>Trang chủ</a></body>")).normalName());
    }

    private static final String BASE = "https://hust.edu.vn/tin/bai-1.html";

    private static List<ContentBlock.Link> links(String body) {
        return ContentBlock.extract("<body>" + body + "</body>", BASE).links();
    }

    @Test
    void resolvesRelativeAndDropsFragmentMailtoJs() {
        var l = links("<a href='/a/b#x'>A</a><a href='mailto:x@y.z'>M</a><a href='javascript:void(0)'>J</a><a href='c.html'>C</a>");
        assertEquals(List.of("https://hust.edu.vn/a/b", "https://hust.edu.vn/tin/c.html"), l.stream().map(ContentBlock.Link::url).toList());
    }

    @Test
    void dedupesKeepingFirstAndDropsSelfLink() {
        var l = links("<a href='/x'>Một</a><a href='/x#y'>Hai</a><a href='" + BASE + "#top'>Tự</a><a href='/bai-1.html'>Khác</a>");
        assertEquals(List.of(new ContentBlock.Link("https://hust.edu.vn/x", "Một"), new ContentBlock.Link("https://hust.edu.vn/bai-1.html", "Khác")), l);
    }

    @Test
    void includesImgSrcWithAlt() {
        var l = links("<a href='/p'>P</a><img src='/uploads/a.png' alt=' Ảnh lễ khai giảng '><img src='data:image/png;base64,AA'>");
        assertEquals(List.of(new ContentBlock.Link("https://hust.edu.vn/p", "P"),
                new ContentBlock.Link("https://hust.edu.vn/uploads/a.png", "Ảnh lễ khai giảng")), l);
    }

    @Test
    void onlyLinksAndImagesInsideContentBlock() {
        String html = "<body><ul><li><a href=/menu>Tin tức</a></li></ul><img src=/logo.png alt=Logo>"
                + "<div id=main><p>" + P + "Xem <a href=/tb>thông báo</a>. " + P + "</p><p>" + P + "<img src=/anh.jpg alt=Ảnh></p></div>"
                + "<div id=side><a href=/side>Bài khác</a></div></body>";
        var urls = ContentBlock.extract(html, BASE).links().stream().map(ContentBlock.Link::url).toList();
        assertEquals(List.of("https://hust.edu.vn/tb", "https://hust.edu.vn/anh.jpg"), urls);
    }

    @Test
    void anchorTextIsTheSentence() {
        var l = links("<p>Câu trước đó. Điểm chuẩn là 3.5 theo <a href='/d'>thông báo</a> mới nhất. Câu sau.</p>");
        assertEquals("Điểm chuẩn là 3.5 theo thông báo mới nhất.", l.get(0).text());
    }

    @Test
    void menuAnchorKeepsOwnText() {
        assertEquals("Tin tức", links("<ul><li><a href='/t'>Tin tức</a></li></ul>").get(0).text());
    }

    @Test
    void menuWithSubmenuIgnoresSubmenuText() {
        var l = links("<ul><li><a href='/gt'>Giới thiệu</a><ul><li><a href='/ls'>Lịch sử</a></li></ul></li></ul>");
        assertEquals("Giới thiệu", l.get(0).text());
        assertEquals("Lịch sử", l.get(1).text());
    }

    @Test
    void emptyAnchorFallsBackToImgAlt() {
        assertEquals("Logo", links("<a href='/l'><img src='l.png' alt='Logo'></a>").get(0).text());
    }

    @Test
    void introFromOgDescription() {
        var p = ContentBlock.extract("<head><meta property='og:description' content=' Sapo '><meta name=description content=x></head><body>a</body>", BASE);
        assertEquals("Sapo", p.intro());
    }
}
