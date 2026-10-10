package vn.hust.extract;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * Bóc tiêu đề và chữ của khối nội dung chính. Tìm khối: mỗi phần tử có chữ trực tiếp ({@code ownText}, không tính
 * thẻ {@code a}) cộng số ký tự cho cha (đủ) và ông (một nửa) của thẻ khối gần nhất chứa nó; phần tử điểm cao nhất
 * là khối nội dung. Không có đoạn chữ nào thì lấy body.
 */
public final class ContentBlock {
    private ContentBlock() {}

    /** Đoạn chữ ngắn hơn chừng này ký tự (menu, nhãn...) không tính điểm. */
    private static final int MIN_CHARS = 25;

    /** Kết quả bóc tách; {@code block} là CSS selector của khối được chọn. */
    public record Page(String title, String text, String block) {}

    /** HTML thô -> tiêu đề (og:title, h1, rồi thẻ title) và chữ của khối nội dung. */
    public static Page extract(String html) {
        Document doc = Jsoup.parse(html);
        String title = doc.select("meta[property=og:title]").attr("content");
        Element h1 = doc.selectFirst("h1");
        if (title.isBlank() && h1 != null) title = h1.text();
        if (title.isBlank()) title = doc.title();
        Element block = find(doc);
        return new Page(title.strip(), block.text(), block.cssSelector());
    }

    /** Dọn phần không hiển thị rồi chọn khối nội dung. Sửa cây tại chỗ. */
    static Element find(Document doc) {
        doc.select("script, style, noscript, template, iframe, [hidden]").remove();
        Element body = doc.body();
        Map<Element, Double> scores = new HashMap<>();
        for (Element e : body.getAllElements()) {
            int n = e.ownText().length();
            if (n < MIN_CHARS || e.normalName().equals("a") || e == body) continue;
            while (!e.isBlock() && e.parent() != body) e = e.parent();  // span/strong trong p: tính từ p
            Element parent = e.parent();
            scores.merge(parent, (double) n, Double::sum);
            if (parent != body && parent.parent() != null) scores.merge(parent.parent(), n / 2.0, Double::sum);
        }
        return scores.isEmpty() ? body : Collections.max(scores.entrySet(), Map.Entry.comparingByValue()).getKey();
    }
}
