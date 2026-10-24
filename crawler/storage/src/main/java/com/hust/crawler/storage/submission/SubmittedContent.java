package com.hust.crawler.storage.submission;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.data.annotation.Id;
import java.time.Instant;
import java.util.List;

public record SubmittedContent(
        @Id String id, String url, String format, String title, String content, String base64, String origin,
        @JsonProperty("out-links") List<OutLink> outLinks,
        Instant createdAt, Instant updatedAt) {
    public record OutLink(String url, String text) {}
}
