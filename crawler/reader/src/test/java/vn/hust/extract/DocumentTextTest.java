package vn.hust.extract;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class DocumentTextTest {
    @Test
    void readsRtfInProcess() {
        assertEquals("Hello Tika", DocumentText.extract("{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0 Hello Tika\\par}".getBytes(StandardCharsets.US_ASCII)).text());
    }
}
