-- Curated feeds from rss-reader's curated-feeds.opml. Each cron run refreshes
-- the few stalest feeds, so a run stays inside the Workers per-invocation
-- subrequest and D1 query limits. etag/last_modified make re-polls cheap
-- (304 Not Modified, no body).
CREATE TABLE feed (
  url              TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  etag             TEXT,
  last_modified    TEXT,
  last_ingested_at TEXT,
  last_error       TEXT
);

-- Which feed an article came from, so dropping a feed from the OPML can drop
-- its articles. NULL for portfolio documents.
ALTER TABLE document ADD COLUMN feed_url TEXT;
CREATE INDEX document_feed ON document(feed_url);
