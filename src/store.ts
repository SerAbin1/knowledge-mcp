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

// Inserts or updates a document and replaces its chunks. Returns false (and
// writes nothing) when the content is unchanged, so callers can skip
// downstream work such as embedding.
export async function upsertDocument(db: D1Database, doc: DocumentInput, chunks: Chunk[]): Promise<boolean> {
  const id = await documentId(doc.url);
  const hash = await sha256Hex(JSON.stringify([doc, chunks]));
  const existing = await db.prepare("SELECT content_hash FROM document WHERE id = ?").bind(id).first<{ content_hash: string }>();
  if (existing?.content_hash === hash) return false;

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO document (id, kind, source, url, title, summary, body, published_at, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, source = excluded.source, title = excluded.title,
           summary = excluded.summary, body = excluded.body, published_at = excluded.published_at,
           content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
      )
      .bind(id, doc.kind, doc.source, doc.url, doc.title, doc.summary, doc.body, doc.publishedAt, hash, now),
    db.prepare("DELETE FROM chunk WHERE document_id = ?").bind(id),
    ...chunks.map((c, idx) =>
      db
        .prepare("INSERT INTO chunk (id, document_id, idx, title, heading, text) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`${id}:${idx}`, id, idx, doc.title, c.heading, c.text),
    ),
  ]);
  return true;
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
