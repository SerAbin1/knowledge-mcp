import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import worker from "./index";
import { createServer } from "./server";
import { seededEnv } from "./test/env";

let env: Env;
beforeEach(async () => {
  env = await seededEnv();
});

async function connectedClient() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(env).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

async function callJson(name: string, args: Record<string, unknown> = {}) {
  const client = await connectedClient();
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { result, data: JSON.parse(first.text) };
}

describe("mcp server", () => {
  it("lists the tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["fetch", "list_sources", "ping", "search"]);
  });

  it("ping returns pong", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
  });

  it("search finds the blog post about LRU caches", async () => {
    const { data } = await callJson("search", { query: "least recently used eviction" });
    expect(data.results[0].url).toBe("https://serabin1.github.io/blogs/lru-lfu-cache/");
    expect(data.results[0]).toMatchObject({ kind: "blog", source: "serabin1.github.io" });
  });

  it("search matches stemmed words and survives FTS syntax in the query", async () => {
    const { data } = await callJson("search", { query: 'parsing "GT06" AND -tcp*' });
    expect(data.results.map((r: { url: string }) => r.url)).toContain(
      "https://serabin1.github.io/blogs/learn-rust-by-building-gt06-parser/",
    );
  });

  it("search finds projects and experience", async () => {
    const { data } = await callJson("search", { query: "Pumato campus food delivery" });
    expect(data.results[0]).toMatchObject({ kind: "project", title: "Project: Pumato" });
  });

  it("fetch returns the full text of a search result", async () => {
    const { data: search } = await callJson("search", { query: "keyd" });
    const { data } = await callJson("fetch", { id: search.results[0].id });
    expect(data.title).toBe("How Keyd Works");
    expect(data.text.length).toBeGreaterThan(5000);
    expect(data.metadata).toMatchObject({ kind: "blog", published: "2026-03-07" });
  });

  it("fetch of an unknown id is a tool error", async () => {
    const { result } = await callJson("fetch", { id: "nope" });
    expect(result.isError).toBe(true);
  });

  it("list_sources counts documents per source and kind", async () => {
    const { data } = await callJson("list_sources");
    expect(data.sources).toContainEqual(expect.objectContaining({ source: "serabin1.github.io", kind: "blog", documents: 5 }));
  });

  it("serves the profile resource", async () => {
    const client = await connectedClient();
    const { contents } = await client.readResource({ uri: "profile://abin" });
    const text = (contents[0] as { text: string }).text;
    expect(text).toContain("Backend Developer Intern at Evide.AI");
    expect(text).toContain("### Project: gt06");
  });

  it("offers the answer prompt", async () => {
    const client = await connectedClient();
    const prompt = await client.getPrompt({ name: "answer_from_trusted_sources", arguments: { question: "What is keyd?" } });
    expect((prompt.messages[0].content as { text: string }).text).toContain("What is keyd?");
  });
});

describe("http endpoint", () => {
  it("answers a JSON-RPC tools/list over POST /mcp", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("search");
  });

  it("answers CORS preflight and adds CORS headers for browser clients", async () => {
    const preflight = await worker.fetch(new Request("http://localhost/mcp", { method: "OPTIONS" }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");

    const res = await worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s outside /mcp", async () => {
    const res = await worker.fetch(new Request("http://localhost/"), env);
    expect(res.status).toBe(404);
  });
});

describe("source names are searchable", () => {
  it("finds a document by its source when the name isn't in the text", async () => {
    const { syncDocuments } = await import("./store");
    await syncDocuments(env.DB, [
      {
        doc: { kind: "article", source: "Mitchell Hashimoto", url: "https://mitchellh.com/ai", title: "My AI Adoption Journey", summary: "How I started.", body: null, publishedAt: null },
        chunks: [{ heading: null, text: "How I started." }],
      },
    ]);
    const { data } = await callJson("search", { query: "hashimoto" });
    expect(data.results[0].url).toBe("https://mitchellh.com/ai");
  });
});
