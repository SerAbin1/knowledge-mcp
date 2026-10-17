import { embed } from "./embed";
import type { Hit } from "./fts";

// Semantic search: embeds the query and finds the nearest chunks by cosine
// similarity. Returns the best chunk per document, like ftsSearch.
export async function vectorSearch(
  db: D1Database,
  ai: Ai,
  index: Vectorize,
  query: string,
  limit = 10,
): Promise<Hit[]> {
  const [vector] = await embed(ai, [query]);
  const { matches } = await index.query(vector, { topK: limit * 3 });
  if (!matches.length) return [];

  // Vectors can outlive their chunk (a post got shorter, or was deleted), so
  // only ids that still exist in D1 count. D1 is the source of truth.
  const ids = matches.map((m) => m.id);
  const { results } = await db
    .prepare(
      `SELECT id, document_id, heading, text FROM chunk WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<{ id: string; document_id: string; heading: string | null; text: string }>();
  const chunks = new Map(results.map((r) => [r.id, r]));

  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const m of matches) {
    const c = chunks.get(m.id);
    if (!c || seen.has(c.document_id)) continue;
    seen.add(c.document_id);
    hits.push({
      documentId: c.document_id,
      heading: c.heading,
      snippet: c.text.slice(0, 240),
      score: m.score,
    });
    if (hits.length === limit) break;
  }
  return hits;
}
