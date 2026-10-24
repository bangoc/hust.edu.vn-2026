package com.hust.crawler.storage.submission;

import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.Instant;

@Document("graph")
public record GraphRelation(@Id ObjectId id, String source, String destinations, String intro,
                            Instant createdAt, Instant updatedAt) {}
