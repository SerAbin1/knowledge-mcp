-- Index the source (feed or site name, usually the author) alongside each
-- chunk. Found by the retrieval eval: "How did Mitchell Hashimoto start using
-- AI tools?" missed because the author's name appears nowhere in the post's
-- title or summary, only in the feed's name.
ALTER TABLE chunk ADD COLUMN source TEXT NOT NULL DEFAULT '';
UPDATE chunk SET source = (SELECT source FROM document WHERE document.id = chunk.document_id);

DROP TRIGGER chunk_ai;
DROP TRIGGER chunk_ad;
DROP TRIGGER chunk_au;
DROP TABLE chunk_fts;

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  title, source, heading, text,
  content='chunk', content_rowid='rowid',
  tokenize='porter unicode61'
);
INSERT INTO chunk_fts(chunk_fts) VALUES ('rebuild');

CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
  INSERT INTO chunk_fts(rowid, title, source, heading, text) VALUES (new.rowid, new.title, new.source, new.heading, new.text);
END;
CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, title, source, heading, text) VALUES ('delete', old.rowid, old.title, old.source, old.heading, old.text);
END;
CREATE TRIGGER chunk_au AFTER UPDATE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, title, source, heading, text) VALUES ('delete', old.rowid, old.title, old.source, old.heading, old.text);
  INSERT INTO chunk_fts(rowid, title, source, heading, text) VALUES (new.rowid, new.title, new.source, new.heading, new.text);
END;
