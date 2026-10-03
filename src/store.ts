import type { Chunk } from "./ingest/chunk";
import { documentId, sha256Hex } from "./hash";

export type Kind = "blog" | "project" | "experience" | "article";

export type DocumentInput = {
  kind: Kind;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  body: string | null;
  publishedAt: string | null;
  feedUrl?: string;
};

export type DocumentRow = {
  id: string;
  kind: Kind;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  body: string | null;
  published_at: string | null;
};

export type Item = { doc: DocumentInput; chunks: Chunk[] };

// D1 caps bound parameters per statement at 100.
const MAX_PARAMS = 90;

// Writes new or changed documents and replaces their chunks, all in one D1
// batch. Unchanged documents (same content hash) are skipped, and their ids
// are not returned, so callers can limit downstream work such as embedding to
// what actually changed. One read + one batch keeps an ingest run well inside
// the Workers per-invocation query limit.
export async function syncDocuments(db: D1Database, items: Item[]): Promise<string[]> {
  if (!items.length) return [];
  const rows = await Promise.all(
    items.map(async ({ doc, chunks }) => ({
      id: await documentId(doc.url),
      hash: await sha256Hex(JSON.stringify([doc, chunks])),
      doc,
      chunks,
    })),
  );

  const existing = new Map<string, string>();
  for (let i = 0; i < rows.length; i += MAX_PARAMS) {
    const ids = rows.slice(i, i + MAX_PARAMS).map((r) => r.id);
    const { results } = await db
      .prepare(`SELECT id, content_hash FROM document WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ id: string; content_hash: string }>();
    for (const r of results) existing.set(r.id, r.content_hash);
  }

  const seen = new Set<string>();
  const changed = rows.filter((r) => {
    if (seen.has(r.id) || existing.get(r.id) === r.hash) return false;
    seen.add(r.id);
    return true;
  });
  if (!changed.length) return [];

  const now = new Date().toISOString();
  await db.batch(
    changed.flatMap(({ id, hash, doc, chunks }) => [
      db
        .prepare(
          `INSERT INTO document (id, kind, source, url, title, summary, body, published_at, content_hash, updated_at, feed_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, source = excluded.source, title = excluded.title,
             summary = excluded.summary, body = COALESCE(excluded.body, document.body),
             published_at = excluded.published_at, content_hash = excluded.content_hash,
             updated_at = excluded.updated_at, feed_url = excluded.feed_url`,
        )
        .bind(id, doc.kind, doc.source, doc.url, doc.title, doc.summary, doc.body, doc.publishedAt, hash, now, doc.feedUrl ?? null),
      db.prepare("DELETE FROM chunk WHERE document_id = ?").bind(id),
      ...chunks.map((c, idx) =>
        db
          .prepare("INSERT INTO chunk (id, document_id, idx, title, heading, text) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(`${id}:${idx}`, id, idx, doc.title, c.heading, c.text),
      ),
    ]),
  );
  return changed.map((r) => r.id);
}

// Removes documents of the given kinds whose URL is no longer published, e.g.
// a deleted blog post. Returns how many were removed.
export async function deleteMissing(db: D1Database, kinds: Kind[], keepUrls: string[]): Promise<number> {
  const rows = await db
    .prepare(`SELECT id, url FROM document WHERE kind IN (${kinds.map(() => "?").join(",")})`)
    .bind(...kinds)
    .all<{ id: string; url: string }>();
  const keep = new Set(keepUrls);
  const gone = rows.results.filter((r) => !keep.has(r.url));
  if (gone.length) {
    await db.batch(gone.map((r) => db.prepare("DELETE FROM document WHERE id = ?").bind(r.id)));
  }
  return gone.length;
}

export async function getDocument(db: D1Database, id: string): Promise<DocumentRow | null> {
  return db
    .prepare("SELECT id, kind, source, url, title, summary, body, published_at FROM document WHERE id = ?")
    .bind(id)
    .first<DocumentRow>();
}

export async function listDocuments(db: D1Database, kinds: Kind[]): Promise<DocumentRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, source, url, title, summary, body, published_at FROM document
       WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY published_at DESC, title`,
    )
    .bind(...kinds)
    .all<DocumentRow>();
  return results;
}

export async function listSources(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT source, kind, COUNT(*) AS documents, MAX(published_at) AS latest
       FROM document GROUP BY source, kind ORDER BY kind, source`,
    )
    .all<{ source: string; kind: Kind; documents: number; latest: string | null }>();
  return results;
}
