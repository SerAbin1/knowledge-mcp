// Test doubles for Workers AI and Vectorize, which only exist on Cloudflare.

// "Embeds" text as a bag of words over a fixed vocabulary of concepts, with
// synonyms folded together, so cosine similarity behaves like a (tiny)
// semantic model: "latency" and "slow" land on the same axis even though
// keyword search would never match one with the other.
const CONCEPTS: Record<string, string[]> = {
  slow: ["slow", "latency", "sluggish", "delay"],
  review: ["review", "reviews", "reviewer", "pr"],
  cache: ["cache", "caching", "eviction", "lru", "lfu"],
  keyboard: ["keyboard", "keys", "remap", "keyd"],
};
const AXES = Object.keys(CONCEPTS);

export function fakeEmbedding(text: string): number[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return AXES.map((axis) => words.filter((w) => CONCEPTS[axis].includes(w)).length);
}

export function fakeAi(): Ai & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (_model: string, input: { text: string[] }) => {
      calls.push(input.text);
      return { shape: [input.text.length, AXES.length], data: input.text.map(fakeEmbedding) };
    },
  } as unknown as Ai & { calls: string[][] };
}

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? dot / norm : 0;
};

export function fakeVectorize(): Vectorize & { vectors: Map<string, { values: number[]; metadata?: unknown }> } {
  const vectors = new Map<string, { values: number[]; metadata?: unknown }>();
  return {
    vectors,
    upsert: async (vs: { id: string; values: number[]; metadata?: unknown }[]) => {
      for (const v of vs) vectors.set(v.id, { values: [...v.values], metadata: v.metadata });
      return { mutationId: "m" };
    },
    query: async (vector: number[], opts?: { topK?: number }) => ({
      matches: [...vectors]
        .map(([id, v]) => ({ id, score: cosine(vector, v.values) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, opts?.topK ?? 5),
      count: 0,
    }),
  } as unknown as Vectorize & { vectors: Map<string, { values: number[]; metadata?: unknown }> };
}
