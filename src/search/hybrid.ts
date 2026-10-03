import type { Env } from "../env";
import { ftsSearch, type Hit } from "./fts";
import { reciprocalRankFusion } from "./rrf";
import { vectorSearch } from "./vector";

export type SearchMode = "hybrid" | "keyword";

// Keyword (BM25) and semantic (embedding) search run in parallel and are
// merged with RRF. Keyword search nails exact terms (names, "GT06", error
// messages); semantic search finds paraphrases ("why are reviews slow" ↔
// "code review latency"). If the vector side is unavailable or fails, this
// degrades to keyword-only instead of failing the search.
export async function hybridSearch(env: Env, query: string, limit = 10): Promise<{ hits: Hit[]; mode: SearchMode }> {
  const keyword = ftsSearch(env.DB, query, limit * 2);
  const semantic =
    env.AI && env.VECTORIZE
      ? vectorSearch(env.DB, env.AI, env.VECTORIZE, query, limit * 2).catch((e) => {
          console.warn("vector search failed, keyword only:", e);
          return null;
        })
      : Promise.resolve(null);
  const [kw, sem] = await Promise.all([keyword, semantic]);
  if (!sem) return { hits: kw.slice(0, limit), mode: "keyword" };

  // Prefer the keyword snippet (it highlights the matched terms) when both
  // retrievers found a document.
  const byDoc = new Map<string, Hit>();
  for (const h of [...sem, ...kw]) byDoc.set(h.documentId, h);
  const fused = reciprocalRankFusion([kw.map((h) => h.documentId), sem.map((h) => h.documentId)]);
  return { hits: fused.slice(0, limit).map((f) => ({ ...byDoc.get(f.id)!, score: f.score })), mode: "hybrid" };
}
