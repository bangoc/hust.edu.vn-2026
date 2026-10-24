package vn.hust.extract;

import org.apache.tika.exception.WriteLimitReachedException;
import org.apache.tika.io.TikaInputStream;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.sax.BodyContentHandler;

/** Bóc chữ tệp (pdf, docx, xlsx...) bằng Tika. */
public final class DocumentText {
    private DocumentText() {}

    /** Dựng AutoDetectParser nạp cả bộ parser qua ServiceLoader (~1 s); dùng chung, nó an toàn khi nhiều luồng. */
    private static final AutoDetectParser TIKA = new AutoDetectParser();

    /** Chữ Tika bóc được, Content-Type Tika nhận dạng và metadata (ảnh: kích thước, EXIF/XMP). */
    record Text(String text, String mime, Metadata meta) {}

    /** Chữ thuần của tệp kèm Content-Type Tika nhận dạng; tệp hỏng throw 422. */
    static Text extract(byte[] data) {
        var handler = new BodyContentHandler(Api.MAX_CHARS);
        var meta = new Metadata();
        try (var in = TikaInputStream.get(data)) {
            TIKA.parse(in, handler, meta, new ParseContext());
        } catch (Exception e) {  // TikaException, SAXException, IOException, RuntimeException của POI
            // quá giới hạn ký tự: giữ phần đã có
            if (!WriteLimitReachedException.isWriteLimitReached(e)) throw new Api.HttpError(422, "Tika không đọc được tệp: " + e);
        }
        String mime = String.valueOf(meta.get("Content-Type")).split(";", -1)[0].strip();
        return new Text(handler.toString().strip(), mime, meta);
    }
}
