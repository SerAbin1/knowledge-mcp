// Reciprocal Rank Fusion: merges ranked lists from different retrievers
// without comparing their scores (BM25 and cosine similarity aren't on the
// same scale). Each list contributes 1 / (k + rank) for every item it ranks;
// items that rank well in several lists rise to the top. k = 60 is the value
// from the original paper and damps the influence of any single top rank.
export function reciprocalRankFusion(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
