import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { syncDocuments, type DocumentInput } from "../store";
import { fakeAi, fakeVectorize } from "../test/ai";
import { createTestDb } from "../test/d1";
import { embedPending } from "./embed";
import { hybridSearch } from "./hybrid";

const article = (url: string, title: string, summary: string) => ({
  doc: { kind: "article", source: "test", url, title, summary, body: null, publishedAt: null } satisfies DocumentInput,
  chunks: [{ heading: null, text: summary }],
});

async function setup() {
  const db = createTestDb();
  await syncDocuments(db, [
    article("https://a.dev/latency", "Why code review latency hurts", "Waiting days for a reviewer kills momentum."),
    article("https://a.dev/lru", "Building an LRU cache", "Eviction policies explained."),
    article("https://a.dev/slow", "Slow tests", "Making a slow test suite fast."),
  ]);
  const env: Env = {
    DB: db,
    AI: fakeAi(),
    VECTORIZE: fakeVectorize(),
    PORTFOLIO_CONTENT_URL: "",
    PORTFOLIO_HOST: "",
    CURATED_OPML_URL: "",
  };
  return env;
}

const titles = async (env: Env, q: string) => (await hybridSearch(env, q)).hits.map((h) => h.documentId);

describe("embedPending", () => {
  it("embeds each chunk once, keyed by chunk id, with title context", async () => {
    const env = await setup();
    expect(await embedPending(env.DB, env.AI!, env.VECTORIZE!)).toEqual({ embedded: 3 });
    expect(await embedPending(env.DB, env.AI!, env.VECTORIZE!)).toEqual({ embedded: 0 });

    const index = env.VECTORIZE as ReturnType<typeof fakeVectorize>;
    expect([...index.vectors.keys()].every((id) => /^[0-9a-f]{32}:0$/.test(id))).toBe(true);
    expect((env.AI as ReturnType<typeof fakeAi>).calls[0]).toContain("Building an LRU cache\nEviction policies explained.");
  });

  it("re-embeds a document whose content changed", async () => {
    const env = await setup();
    await embedPending(env.DB, env.AI!, env.VECTORIZE!);
    await syncDocuments(env.DB, [article("https://a.dev/lru", "Building an LRU cache", "Now with LFU too.")]);
    expect(await embedPending(env.DB, env.AI!, env.VECTORIZE!)).toEqual({ embedded: 1 });
  });
});

describe("hybridSearch", () => {
  it("finds paraphrases keyword search misses", async () => {
    const env = await setup();
    await embedPending(env.DB, env.AI!, env.VECTORIZE!);
    const keywordOnly = await hybridSearch({ ...env, AI: undefined }, "sluggish pr");
    expect(keywordOnly).toEqual({ hits: [], mode: "keyword" });

    const { hits, mode } = await hybridSearch(env, "sluggish pr");
    expect(mode).toBe("hybrid");
    const [latency] = await env.DB.prepare("SELECT id FROM document WHERE url = 'https://a.dev/latency'").all<{ id: string }>().then((r) => r.results);
    expect(hits[0].documentId).toBe(latency.id);
  });

  it("ranks documents both retrievers agree on first", async () => {
    const env = await setup();
    await embedPending(env.DB, env.AI!, env.VECTORIZE!);
    // keyword: "slow" matches only the slow-tests post; semantic: "slow" also
    // pulls in the latency post. Both agree on slow tests.
    const ids = await titles(env, "slow");
    const slow = (await env.DB.prepare("SELECT id FROM document WHERE url = 'https://a.dev/slow'").first<{ id: string }>())!.id;
    expect(ids[0]).toBe(slow);
    expect(ids).toHaveLength(2);
  });

  it("ignores vectors whose chunk no longer exists", async () => {
    const env = await setup();
    await embedPending(env.DB, env.AI!, env.VECTORIZE!);
    await env.DB.prepare("DELETE FROM document WHERE url = 'https://a.dev/lru'").run();
    expect(await titles(env, "eviction cache")).toEqual([]);
  });

  it("falls back to keyword search when the vector side fails", async () => {
    const env = await setup();
    env.AI = { run: async () => { throw new Error("AI down"); } } as unknown as Ai;
    const { hits, mode } = await hybridSearch(env, "LRU");
    expect(mode).toBe("keyword");
    expect(hits).toHaveLength(1);
  });
});
