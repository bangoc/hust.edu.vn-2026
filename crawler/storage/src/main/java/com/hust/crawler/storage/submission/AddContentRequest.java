package com.hust.crawler.storage.submission;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public record AddContentRequest(
        String url,
        String format,
        String title,
        String content,
        String base64,
        String origin,
        @JsonProperty("out-links") List<OutLinkRequest> outLinks) {

    public record OutLinkRequest(String url, String text) {}
}
