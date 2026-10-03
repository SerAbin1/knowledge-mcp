-- Embedding is a separate step from ingest: new or changed chunks start at 0
-- and the embed stage picks them up. If an embedding run fails halfway, the
-- rest are simply retried next run, and enabling Workers AI later backfills
-- everything that was ingested before.
ALTER TABLE chunk ADD COLUMN embedded INTEGER NOT NULL DEFAULT 0;
CREATE INDEX chunk_unembedded ON chunk(embedded) WHERE embedded = 0;
