package vn.hust.extract;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.TextNode;

/**
 * Bóc tiêu đề, chữ của khối nội dung chính, đoạn giới thiệu, liên kết và ảnh nằm trong khối đó. Tìm khối: mỗi phần tử
 * có chữ trực tiếp ({@code ownText}, không tính thẻ {@code a}) cộng số ký tự cho cha (đủ) và ông (một nửa) của thẻ
 * khối gần nhất chứa nó; phần tử điểm cao nhất là khối nội dung. Không có đoạn chữ nào thì lấy body.
 */
public final class ContentBlock {
    private ContentBlock() {}

    /** Đoạn chữ ngắn hơn chừng này ký tự (menu, nhãn...) không tính điểm. */
    private static final int MIN_CHARS = 25;
    private static final int MAX_ANCHOR = 300;
    private static final String SENTENCE_BLOCKS = "p, li, td, th, dd, h1, h2, h3, h4, h5, h6, figcaption, blockquote";
    private static final Pattern END_BEFORE_SPACE = Pattern.compile("[.!?…;]\\s");
    private static final Pattern END_AFTER = Pattern.compile("[.!?…;](?=\\s|$)");

    /** Liên kết đi ra: url và văn bản liên kết. */
    public record Link(String url, String text) {}

    /** Kết quả bóc tách; {@code block} là CSS selector của khối được chọn. */
    public record Page(String title, String text, String block, String intro, List<Link> links) {}

    /** HTML thô -> tiêu đề (og:title, h1, rồi thẻ title), chữ khối nội dung, intro và liên kết; {@code baseUrl} để giải link tương đối. */
    public static Page extract(String html, String baseUrl) {
        Document doc = Jsoup.parse(html, baseUrl);
        String title = doc.select("meta[property=og:title]").attr("content");
        Element h1 = doc.selectFirst("h1");
        if (title.isBlank() && h1 != null) title = h1.text();
        if (title.isBlank()) title = doc.title();
        String intro = doc.select("meta[property=og:description]").attr("content");
        if (intro.isBlank()) intro = doc.select("meta[name=description]").attr("content");
        title = title.strip();
        Element block = find(doc);
        return new Page(title, block.text(), block.cssSelector(), intro.strip(), links(block, baseUrl));
    }

    /**
     * {@code <a href>} và {@code <img src>} trong khối nội dung, theo thứ tự trong trang: chỉ http(s), bỏ fragment, bỏ link
     * về chính trang, khử trùng theo url (giữ lần đầu). Văn bản của ảnh là {@code alt}, rồi {@code title}.
     */
    private static List<Link> links(Element block, String baseUrl) {
        String self = dropFragment(baseUrl);
        Map<String, Link> out = new LinkedHashMap<>();
        for (Element e : block.select("a[href], img[src]")) {
            boolean img = e.normalName().equals("img");
            String url = dropFragment(e.absUrl(img ? "src" : "href"));
            if (!url.startsWith("http://") && !url.startsWith("https://") || url.equals(self) || out.containsKey(url)) continue;
            String text = img ? (e.hasAttr("alt") ? e.attr("alt") : e.attr("title")).strip() : anchorText(e);
            out.put(url, new Link(url, cap(text)));
        }
        return new ArrayList<>(out.values());
    }

    private static String dropFragment(String url) {
        int i = url.indexOf('#');
        return i < 0 ? url : url.substring(0, i);
    }

    /**
     * Câu chứa thẻ a.
     */
    private static String anchorText(Element a) {
        String own = a.text();
        Element block = a.closest(SENTENCE_BLOCKS);
        if (block != null) {
            StringBuilder left = new StringBuilder(), mid = new StringBuilder(), right = new StringBuilder();
            boolean[] seen = {false};
            block.traverse((node, depth) -> {
                if (node == a) seen[0] = true;
                if (!(node instanceof TextNode t)) return;
                if (((Element) t.parent()).closest(SENTENCE_BLOCKS) != block) return;  // menu con lồng trong li
                String s = t.getWholeText();
                if (t.parent() != null && (t.parent() == a || ((Element) t.parent()).parents().contains(a))) mid.append(s);
                else (seen[0] ? right : left).append(s);
            });
            String l = left.toString(), r = right.toString();
            int cut = 0;
            for (Matcher m = END_BEFORE_SPACE.matcher(l); m.find(); ) cut = m.end();
            l = l.substring(cut);
            Matcher m = END_AFTER.matcher(r);
            if (m.find()) r = r.substring(0, m.end());
            String sentence = (l + mid + r).replaceAll("\\s+", " ").strip();
            if (!sentence.equals(own)) return cap(sentence);
        }
        if (own.isEmpty()) own = a.attr("title").strip();
        if (own.isEmpty()) own = a.attr("aria-label").strip();
        if (own.isEmpty()) {
            Element img = a.selectFirst("img");
            if (img != null) own = img.attr("alt").strip();
        }
        return cap(own);
    }

    private static String cap(String s) {
        return s.length() <= MAX_ANCHOR ? s : s.substring(0, MAX_ANCHOR);
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
