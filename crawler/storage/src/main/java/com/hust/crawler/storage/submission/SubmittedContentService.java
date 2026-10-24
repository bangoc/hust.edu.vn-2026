package com.hust.crawler.storage.submission;

import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

@Service
public class SubmittedContentService {
    private static final Logger log = LoggerFactory.getLogger(SubmittedContentService.class);
    private final MongoTemplate mongo;
    private volatile boolean indexesReady;
    public SubmittedContentService(MongoTemplate mongo) { this.mongo = mongo; }

    private synchronized void ensureIndexes() {
        if (indexesReady) return;
        for (ContentCollection target : ContentCollection.values()) {
            mongo.indexOps(target.collectionName()).ensureIndex(new Index().on("url", Sort.Direction.ASC)
                    .unique().named("uk_url"));
        }
        mongo.indexOps(GraphRelation.class).ensureIndex(new Index().on("source", Sort.Direction.ASC)
                .on("destinations", Sort.Direction.ASC).unique().named("uk_source_destinations"));
        indexesReady = true;
    }

    public SubmittedContent save(String url, String format, String title, String content, String base64, String origin,
                                 List<SubmittedContent.OutLink> links) {
        String collection = ContentCollection.forFormat(format).collectionName();
        String logUrl = url.replace("\r", "\\r").replace("\n", "\\n");
        log.info("Mongo SAVE collection={} url={} contentLength={} base64Length={} outLinks={}",
                collection, logUrl, content.length(), base64 == null ? 0 : base64.length(), links.size());
        try {
            ensureIndexes();
            Instant now = Instant.now();
            Query query = Query.query(Criteria.where("url").is(url));
            Update update = new Update().set("url", url).set("format", format)
                    .set("title", title).set("content", content).set("updatedAt", now)
                    .setOnInsert("createdAt", now);
            if (base64 == null) update.unset("base64"); else update.set("base64", base64);
            if (!"html".equals(collection)) {
                if (origin == null) update.unset("origin"); else update.set("origin", origin);
            }
            SubmittedContent saved;
            try {
                saved = mongo.findAndModify(query, update,
                        FindAndModifyOptions.options().upsert(true).returnNew(true), SubmittedContent.class, collection);
            } catch (DuplicateKeyException e) {
                saved = mongo.findAndModify(query, update,
                        FindAndModifyOptions.options().returnNew(true), SubmittedContent.class, collection);
            }
            Objects.requireNonNull(saved, "Content upsert returned no document");
            int inserted = 0;
            for (SubmittedContent.OutLink link : links) {
                Query edge = Query.query(Criteria.where("source").is(url).and("destinations").is(link.url()));
                Update edgeUpdate = new Update().set("intro", link.text()).set("updatedAt", now)
                        .setOnInsert("createdAt", now);
                try {
                    var result = mongo.upsert(edge, edgeUpdate, GraphRelation.class);
                    if (result.getUpsertedId() != null) inserted++;
                } catch (DuplicateKeyException e) {
                    mongo.updateFirst(edge, edgeUpdate, GraphRelation.class);
                }
            }
            log.info("Mongo SAVED collection={} url={} graphProcessed={} graphInserted={} updatedAt={}",
                    collection, logUrl, links.size(), inserted, saved.updatedAt());
            return new SubmittedContent(saved.id(), saved.url(), saved.format(), saved.title(), saved.content(),
                    saved.base64(), "html".equals(collection) ? null : saved.origin(), links, saved.createdAt(), saved.updatedAt());
        } catch (DataAccessException e) {
            log.error("Mongo SAVE FAILED collection={} url={} exception={}",
                    collection, logUrl, e.getClass().getSimpleName());
            throw e;
        }
    }
}
