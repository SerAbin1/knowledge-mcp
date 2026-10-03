-- One row per thing a user could be pointed at: a blog post, a project, a job,
-- or an article from a curated feed. `body` is the full text when we have it;
-- feed articles start with only title + summary and get their body lazily the
-- first time an assistant fetches them.
CREATE TABLE document (
  id           TEXT PRIMARY KEY,          -- sha256(url), hex, first 32 chars
  kind         TEXT NOT NULL,             -- 'blog' | 'project' | 'experience' | 'article'
  source       TEXT NOT NULL,             -- where it came from: site or feed title
  url          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT,
  body         TEXT,
  published_at TEXT,
  content_hash TEXT NOT NULL,             -- skips re-chunking/re-embedding unchanged docs
  updated_at   TEXT NOT NULL
);
CREATE INDEX document_kind ON document(kind);

-- The units search runs over. Long posts are split by heading so a match
-- points at the relevant section and (later) each section gets its own
-- embedding. `title` is copied from the document so FTS can weight it.
CREATE TABLE chunk (
  id          TEXT PRIMARY KEY,           -- '<document_id>:<idx>'
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  title       TEXT NOT NULL,
  heading     TEXT,
  text        TEXT NOT NULL
);
CREATE INDEX chunk_document ON chunk(document_id);

-- Keyword index. External-content FTS5: the text lives in `chunk`, the index
-- only stores tokens, kept in sync by the triggers below. Porter stemming so
-- "caching" matches "cache".
CREATE VIRTUAL TABLE chunk_fts USING fts5(
  title, heading, text,
  content='chunk', content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
  INSERT INTO chunk_fts(rowid, title, heading, text) VALUES (new.rowid, new.title, new.heading, new.text);
END;
CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, title, heading, text) VALUES ('delete', old.rowid, old.title, old.heading, old.text);
END;
CREATE TRIGGER chunk_au AFTER UPDATE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, title, heading, text) VALUES ('delete', old.rowid, old.title, old.heading, old.text);
  INSERT INTO chunk_fts(rowid, title, heading, text) VALUES (new.rowid, new.title, new.heading, new.text);
END;
