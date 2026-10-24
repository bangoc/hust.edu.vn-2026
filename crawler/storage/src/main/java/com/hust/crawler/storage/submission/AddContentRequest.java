package com.hust.crawler.storage.submission;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** Typed request contract for POST /add, separate from the Mongo document model. */
public record AddContentRequest(
        String url,
        String format,
        String title,
        String content,
        @JsonProperty("out-links") List<OutLinkRequest> outLinks) {

    /** Link destination and its visible anchor text (which may be empty). */
    public record OutLinkRequest(String url, String text) {}
}
