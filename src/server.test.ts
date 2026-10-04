import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import worker from "./index";
import { syncDocuments } from "./store";
import { callJson, connect, ERAS } from "./test/client";
import { seededEnv } from "./test/env";

let env: Env;
beforeEach(async () => {
  env = await seededEnv();
});

describe.each(ERAS)("mcp server, %s protocol era", (era) => {
  it("negotiates the expected era", async () => {
    const client = await connect(env, era);
    expect(client.getProtocolEra()).toBe(era);
  });

  it("lists the tools in a stable order", async () => {
    const client = await connect(env, era);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search", "fetch", "list_sources"]);
  });

  it("search finds the blog post about LRU caches", async () => {
    const { data } = await callJson(await connect(env, era), "search", { query: "least recently used eviction" });
    expect(data.results[0].url).toBe("https://serabin1.github.io/blogs/lru-lfu-cache/");
    expect(data.results[0]).toMatchObject({ kind: "blog", source: "serabin1.github.io" });
  });

  it("search matches stemmed words and survives FTS syntax in the query", async () => {
    const { data } = await callJson(await connect(env, era), "search", { query: 'parsing "GT06" AND -tcp*' });
    expect(data.results.map((r: { url: string }) => r.url)).toContain(
      "https://serabin1.github.io/blogs/learn-rust-by-building-gt06-parser/",
    );
  });

  it("search finds projects and experience", async () => {
    const { data } = await callJson(await connect(env, era), "search", { query: "Pumato campus food delivery" });
    expect(data.results[0]).toMatchObject({ kind: "project", title: "Project: Pumato" });
  });

  it("search finds a document by its source when the name isn't in the text", async () => {
    await syncDocuments(env.DB, [
      {
        doc: { kind: "article", source: "Mitchell Hashimoto", url: "https://mitchellh.com/ai", title: "My AI Adoption Journey", summary: "How I started.", body: null, publishedAt: null },
        chunks: [{ heading: null, text: "How I started." }],
      },
    ]);
    const { data } = await callJson(await connect(env, era), "search", { query: "hashimoto" });
    expect(data.results[0].url).toBe("https://mitchellh.com/ai");
  });

  it("fetch returns the full text of a search result", async () => {
    const client = await connect(env, era);
    const { data: search } = await callJson(client, "search", { query: "keyd" });
    const { data } = await callJson(client, "fetch", { id: search.results[0].id });
    expect(data.title).toBe("How Keyd Works");
    expect(data.text.length).toBeGreaterThan(5000);
    expect(data.metadata).toMatchObject({ kind: "blog", published: "2026-03-07" });
  });

  it("fetch of an unknown id is a tool error, not a protocol error", async () => {
    const { result } = await callJson(await connect(env, era), "fetch", { id: "nope" });
    expect(result.isError).toBe(true);
  });

  it("list_sources counts documents per source and kind", async () => {
    const { data } = await callJson(await connect(env, era), "list_sources");
    expect(data.sources).toContainEqual(expect.objectContaining({ source: "serabin1.github.io", kind: "blog", documents: 5 }));
  });

  it("serves the profile resource", async () => {
    const { contents } = await (await connect(env, era)).readResource({ uri: "profile://abin" });
    const text = (contents[0] as { text: string }).text;
    expect(text).toContain("Backend Developer Intern at Evide.AI");
    expect(text).toContain("### Project: gt06");
  });

  it("offers the answer prompt", async () => {
    const prompt = await (await connect(env, era)).getPrompt({
      name: "answer_from_trusted_sources",
      arguments: { question: "What is keyd?" },
    });
    expect((prompt.messages[0].content as { text: string }).text).toContain("What is keyd?");
  });
});

describe("http endpoint", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body),
      }),
      env,
    );

  it("advertises 2026-07-28 and the server's identity via server/discover", async () => {
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("2026-07-28");
    expect(text).toContain("knowledge-mcp");
  });

  it("answers CORS preflight and adds CORS headers for browser clients", async () => {
    const preflight = await worker.fetch(new Request("http://localhost/mcp", { method: "OPTIONS" }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("*");

    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s outside /mcp", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), env);
    expect(res.status).toBe(404);
  });
});
