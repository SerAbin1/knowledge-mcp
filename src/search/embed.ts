import { truncate } from "../ingest/html";

// 768-dimension English embedding model. The Vectorize index must be created
// with the same dimensions and cosine distance:
//   wrangler vectorize create knowledge-mcp --dimensions=768 --metric=cosine
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
// The model reads at most 512 tokens; ~2000 chars of English stays under it.
const MAX_CHARS = 2000;
// Texts per Workers AI call.
const BATCH = 50;
// Chunks embedded per cron run, so a big backfill is spread over runs
// instead of blowing the per-invocation subrequest limit.
const PER_RUN = 500;

export async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = (await ai.run(EMBEDDING_MODEL, { text: texts.slice(i, i + BATCH) })) as { data: number[][] };
    out.push(...res.data);
  }
  return out;
}

// What gets embedded for a chunk: the document title and section heading give
// the vector context a bare paragraph lacks ("it", "this approach", ...).
export const chunkEmbeddingText = (c: { title: string; heading: string | null; text: string }) =>
  truncate([c.title, c.heading, c.text].filter(Boolean).join("\n"), MAX_CHARS);

// Embeds chunks that don't have a vector yet and upserts them into Vectorize.
// The vector id is the chunk id, so re-embedding a changed chunk overwrites
// its old vector.
export async function embedPending(db: D1Database, ai: Ai, index: Vectorize, limit = PER_RUN) {
  const { results } = await db
    .prepare("SELECT c.id, c.document_id, c.title, c.heading, c.text, d.kind FROM chunk c JOIN document d ON d.id = c.document_id WHERE c.embedded = 0 LIMIT ?")
    .bind(limit)
    .all<{ id: string; document_id: string; title: string; heading: string | null; text: string; kind: string }>();
  if (!results.length) return { embedded: 0 };

  const vectors = await embed(ai, results.map(chunkEmbeddingText));
  await index.upsert(
    results.map((c, i) => ({ id: c.id, values: vectors[i], metadata: { documentId: c.document_id, kind: c.kind } })),
  );
  await db.batch(results.map((c) => db.prepare("UPDATE chunk SET embedded = 1 WHERE id = ?").bind(c.id)));
  return { embedded: results.length };
}
