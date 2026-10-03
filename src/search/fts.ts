export type Hit = { documentId: string; heading: string | null; snippet: string; score: number };

// Turns free text into an FTS5 query. Each word is quoted so punctuation and
// FTS operators in user input ("C++", "AND", "-") can't break the syntax, and
// words are OR-ed: BM25 ranking already favours chunks matching more of them.
export function toFtsQuery(query: string): string | null {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return null;
  return [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}

// Keyword search with BM25 ranking. Title matches weigh most, then the
// source (feed or site name, usually the author), then section headings,
// then body text. Returns the best chunk per document.
export async function ftsSearch(db: D1Database, query: string, limit = 10): Promise<Hit[]> {
  const match = toFtsQuery(query);
  if (!match) return [];
  const { results } = await db
    .prepare(
      `SELECT c.document_id AS documentId, c.heading AS heading,
              snippet(chunk_fts, 3, '', '', '…', 32) AS snippet,
              bm25(chunk_fts, 5.0, 3.0, 2.0, 1.0) AS score
       FROM chunk_fts JOIN chunk c ON c.rowid = chunk_fts.rowid
       WHERE chunk_fts MATCH ?
       ORDER BY score
       LIMIT ?`,
    )
    .bind(match, limit * 5)
    .all<Hit>();

  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const r of results) {
    if (seen.has(r.documentId)) continue;
    seen.add(r.documentId);
    hits.push(r);
    if (hits.length === limit) break;
  }
  return hits;
}
