package vn.hust.extract;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;

class ContentBlockTest {
    private static final String P = "Đây là một đoạn văn đủ dài để được tính điểm nội dung chính. ";

    @Test
    void picksArticleOverMenuAndFooter() {
        String html = "<title>Trang - HUST</title><body><nav><ul><li><a href=/>Trang chủ</a></li><li><a href=/a>Tin tức và sự kiện của trường</a></li></ul></nav>"
                + "<div id=main><h1>Tiêu đề</h1><p>" + P + "<span>" + P + "</span></p><p>" + P + "</p></div>"
                + "<div id=side><p>" + P + "</p></div><footer><p>Địa chỉ: số 1 Đại Cồ Việt, Hà Nội</p></footer></body>";
        var p = ContentBlock.extract(html);
        assertEquals("#main", p.block());
        assertEquals("Tiêu đề", p.title());
    }

    @Test
    void fallsBackToBodyWithoutText() {
        assertEquals("body", ContentBlock.find(Jsoup.parse("<body><a href=/>Trang chủ</a></body>")).normalName());
    }
}
