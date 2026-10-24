package com.hust.crawler.storage.submission;

import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

@Service
public class SubmittedContentService {
    private final MongoTemplate mongo;
    public SubmittedContentService(MongoTemplate mongo) { this.mongo = mongo; }

    public SubmittedContent save(String url, String format, String title, String content,
                                 List<SubmittedContent.OutLink> links) {
        Instant now = Instant.now();
        // URL itself is the unique Mongo primary key: concurrent submissions cannot duplicate it.
        Update update = new Update().set("url", url).set("format", format)
                .set("title", title).set("content", content).set("outLinks", links)
                .set("updatedAt", now).setOnInsert("createdAt", now);
        return Objects.requireNonNull(mongo.findAndModify(
                Query.query(Criteria.where("_id").is(url)), update,
                FindAndModifyOptions.options().upsert(true).returnNew(true), SubmittedContent.class));
    }
}
