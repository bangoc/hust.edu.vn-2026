package com.hust.crawler.storage.controller;

import com.hust.crawler.storage.submission.AddContentRequest;
import com.hust.crawler.storage.submission.SubmittedContent;
import com.hust.crawler.storage.submission.SubmittedContentService;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.UUID;
import java.net.URI;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
public class AddContentController {
    private static final Logger log = LoggerFactory.getLogger(AddContentController.class);
    private static final ObjectMapper LOG_JSON = new ObjectMapper().findAndRegisterModules();
    private static final String REQUEST_ID = AddContentController.class.getName() + ".id";
    private static final String START_TIME = AddContentController.class.getName() + ".start";
    private final SubmittedContentService service;
    public AddContentController(SubmittedContentService service) { this.service = service; }

    @PostMapping(value = "/add", consumes = "application/json", produces = "application/json")
    public SubmittedContent add(@RequestBody AddContentRequest request,
                                HttpServletRequest http, HttpServletResponse response) {
        String id = begin(http, response);
        log.info("HTTP REQUEST requestId={} body={}", id, logBody(new AddContentRequest(
                request.url(), request.format(), request.title(), request.content(),
                base64Summary(request.base64()), request.origin(), request.outLinks())));
        String url = httpUrl(requiredText(request.url(), "url"));
        String format = requiredText(request.format(), "format").toLowerCase(Locale.ROOT);
        if (!format.matches("[a-z0-9][a-z0-9.+_-]{0,31}(/[a-z0-9][a-z0-9.+_-]{0,63})?"))
            throw new IllegalArgumentException("format phai la ten dinh dang, vi du html, pdf, docx");
        String title = requiredText(request.title(), "title");
        String base64 = validateBase64(request.base64());
        String content = request.content() == null ? "" : request.content().strip();
        if (content.isEmpty() && base64 == null)
            throw new IllegalArgumentException("Can cung cap content hoac base64");
        List<SubmittedContent.OutLink> links = request.outLinks() == null ? List.of()
                : request.outLinks().stream().map(link -> {
                    if (link == null || link.text() == null)
                        throw new IllegalArgumentException("Moi out-link phai co url va text");
                    return new SubmittedContent.OutLink(httpUrl(requiredText(link.url(), "out-links.url")), link.text());
                }).toList();
        SubmittedContent saved = service.save(url, format, title, content, base64, request.origin(), links);
        logResponse(http, 200, new SubmittedContent(saved.id(), saved.url(), saved.format(), saved.title(),
                saved.content(), base64Summary(saved.base64()), saved.origin(), saved.outLinks(),
                saved.createdAt(), saved.updatedAt()));
        return saved;
    }

    private static String validateBase64(String raw) {
        if (raw == null) return null;
        String value = raw.strip();
        if (value.isEmpty()) throw new IllegalArgumentException("base64 khong duoc rong");
        try {
            Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("base64 khong hop le (gui chuoi Base64 thuan, khong kem data:image/...)");
        }
        return value;
    }

    private static String requiredText(String value, String field) {
        if (value == null || value.isBlank())
            throw new IllegalArgumentException(field + " phai la chuoi khong rong");
        return value.strip();
    }

    private static String httpUrl(String raw) {
        String url = raw.strip();
        try {
            URI uri = URI.create(url);
            if (uri.getHost() != null && uri.getUserInfo() == null
                    && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())))
                return url;
        } catch (IllegalArgumentException ignored) { }
        throw new IllegalArgumentException("URL phai la dia chi http/https tuyet doi: " + url);
    }

    private static String base64Summary(String value) {
        return value == null ? null : "<omitted; length=" + value.length() + ">";
    }

    private static String logBody(Object body) {
        try {
            String text = LOG_JSON.writeValueAsString(body);
            return text.length() <= 4000 ? text : text.substring(0, 4000) + "...[truncated]";
        } catch (JsonProcessingException e) {
            return "<body could not be serialized>";
        }
    }

    private static String begin(HttpServletRequest http, HttpServletResponse response) {
        String id = (String) http.getAttribute(REQUEST_ID);
        if (id == null) {
            id = UUID.randomUUID().toString();
            http.setAttribute(REQUEST_ID, id);
            http.setAttribute(START_TIME, System.nanoTime());
            response.setHeader("X-Request-ID", id);
            log.info("HTTP START requestId={} method={} path=/add clientIp={} serverIp={} serverPort={}",
                    id, http.getMethod(), http.getRemoteAddr(), http.getLocalAddr(), http.getLocalPort());
        }
        return id;
    }

    private static void logResponse(HttpServletRequest http, int status, Object body) {
        long start = (Long) http.getAttribute(START_TIME);
        log.info("HTTP RESPONSE requestId={} status={} durationMs={} body={}", http.getAttribute(REQUEST_ID),
                status, (System.nanoTime() - start) / 1_000_000, logBody(body));
    }

    @ExceptionHandler({IllegalArgumentException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<?> invalid(Exception e, HttpServletRequest http, HttpServletResponse response) {
        String id = begin(http, response);
        if (e instanceof HttpMessageNotReadableException)
            log.info("HTTP REQUEST requestId={} body=<invalid JSON omitted>", id);
        var body = Map.of("error", e instanceof HttpMessageNotReadableException ? "JSON khong hop le" : e.getMessage());
        logResponse(http, 400, body);
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(DataAccessResourceFailureException.class)
    public ResponseEntity<?> unavailable(DataAccessResourceFailureException e,
                                         HttpServletRequest http, HttpServletResponse response) {
        begin(http, response);
        var body = Map.of("error", "Khong ket noi duoc MongoDB");
        logResponse(http, 503, body);
        return ResponseEntity.status(503).body(body);
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<?> storageError(DataAccessException e,
                                          HttpServletRequest http, HttpServletResponse response) {
        begin(http, response);
        var body = Map.of("error", "Khong luu duoc noi dung vao MongoDB");
        logResponse(http, 500, body);
        return ResponseEntity.internalServerError().body(body);
    }
}
