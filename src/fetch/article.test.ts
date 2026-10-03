import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Env } from "../env";
import { createServer } from "../server";
import { ftsSearch } from "../search/fts";
import { syncDocuments } from "../store";
import { createTestDb } from "../test/d1";
import { documentId } from "../hash";

const ARTICLE_URL = "https://blog.dev/posts/arenas";
const page = `<!doctype html><html><head><title>Arenas | blog.dev</title></head><body>
  <nav><a href="/">Home</a> <a href="/about">About</a> Subscribe to the newsletter</nav>
  <article>
    <h1>Arena allocators</h1>
    ${"<p>An arena allocator hands out memory from one big block and frees it all at once. " +
      "That makes lifetimes simple and allocation a pointer bump.</p>".repeat(3)}
    <h2>When to use them</h2>
    <p>Per-request scratch memory in a server is the classic fit for a bump allocator.</p>
  </article>
  <footer>© blog.dev. Cookie settings.</footer>
</body></html>`;

let env: Env;
let fetched: string[];
beforeEach(async () => {
  env = { DB: createTestDb(), PORTFOLIO_CONTENT_URL: "", PORTFOLIO_HOST: "", CURATED_OPML_URL: "" };
  await syncDocuments(env.DB, [
    {
      doc: { kind: "article", source: "blog.dev", url: ARTICLE_URL, title: "Arena allocators", summary: "Memory arenas.", body: null, publishedAt: null, feedUrl: "https://blog.dev/rss" },
      chunks: [{ heading: null, text: "Memory arenas." }],
    },
  ]);
  fetched = [];
});
afterEach(() => vi.restoreAllMocks());

function serve(response: () => Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    fetched.push(String(input));
    return response();
  });
}

async function fetchTool(id: string) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createServer(env).connect(s);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(c);
  const res = await client.callTool({ name: "fetch", arguments: { id } });
  return JSON.parse((res.content as { text: string }[])[0].text);
}

describe("fetch tool on a feed article", () => {
  it("downloads the page once, extracts the article, and caches it", async () => {
    serve(() => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }));
    const id = await documentId(ARTICLE_URL);

    const first = await fetchTool(id);
    expect(first.text).toContain("pointer bump");
    expect(first.text).toContain("Per-request scratch memory");
    expect(first.text).not.toMatch(/Subscribe|Cookie settings/);
    expect(first.metadata.note).toBeUndefined();

    const second = await fetchTool(id);
    expect(second.text).toBe(first.text);
    expect(fetched).toEqual([ARTICLE_URL]);
  });

  it("makes the full text searchable afterwards", async () => {
    serve(() => new Response(page, { headers: { "content-type": "text/html" } }));
    expect(await ftsSearch(env.DB, "scratch bump")).toHaveLength(0);
    await fetchTool(await documentId(ARTICLE_URL));
    expect(await ftsSearch(env.DB, "scratch bump")).toHaveLength(1);
  });

  it("falls back to the summary with a note when the site fails, and retries next time", async () => {
    serve(() => new Response("gone", { status: 404 }));
    const id = await documentId(ARTICLE_URL);
    const res = await fetchTool(id);
    expect(res.text).toBe("Memory arenas.");
    expect(res.metadata.note).toMatch(/HTTP 404/);
    await fetchTool(id);
    expect(fetched).toHaveLength(2);
  });

  it("refuses non-HTML responses", async () => {
    serve(() => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
    const res = await fetchTool(await documentId(ARTICLE_URL));
    expect(res.metadata.note).toMatch(/not an HTML page/);
  });
});
