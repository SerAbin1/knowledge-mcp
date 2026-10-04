import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import { loadArticleBody } from "./fetch/article";
import { hybridSearch } from "./search/hybrid";
import { getDocument, listDocuments, listSources } from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

// Builds the MCP server: the list of tools, resources and prompts an AI client
// can discover and call. index.ts serves it over HTTP with a fresh instance
// per request (the protocol is stateless as of 2026-07-28).
//
// `search` and `fetch` follow the shape ChatGPT expects for connectors and
// deep research: search returns {results:[{id,title,url,...}]}, fetch takes one
// of those ids and returns {id,title,text,url,metadata}.
export function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "knowledge-mcp", version: "0.0.1" },
    {
      instructions:
        "Searches Abin Biju's trusted sources: his own blog, projects and work experience, " +
        "plus articles from the blogs he follows. Call `search` first, then `fetch` the most " +
        "relevant ids to read them, and cite the URLs you used.",
      // 2026-07-28 clients may cache list/read results. The tool, prompt and
      // resource lists never change at runtime, so they're cacheable for a
      // day; the profile changes when the portfolio is re-ingested (every 30
      // minutes). Everything here is public, so shared caches may keep it.
      cacheHints: {
        "tools/list": { ttlMs: 86_400_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 86_400_000, cacheScope: "public" },
        "resources/list": { ttlMs: 86_400_000, cacheScope: "public" },
        "resources/read": { ttlMs: 1_800_000, cacheScope: "public" },
      },
    },
  );

  server.registerTool(
    "search",
    {
      title: "Search trusted sources",
      description:
        "Search Abin Biju's blog posts, projects, work experience, and articles from blogs he trusts. " +
        "Returns the best-matching documents with a snippet. Use `fetch` with a result id to read the full text.",
      inputSchema: z.object({ query: z.string().min(1).describe("What to look for, in natural language or keywords.") }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const { hits, mode } = await hybridSearch(env, query, 10);
      const results = [];
      for (const hit of hits) {
        const doc = await getDocument(env.DB, hit.documentId);
        if (!doc) continue;
        results.push({
          id: doc.id,
          title: doc.title,
          url: doc.url,
          snippet: hit.snippet,
          section: hit.heading,
          kind: doc.kind,
          source: doc.source,
          published: doc.published_at,
        });
      }
      return json({ results, mode });
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a document",
      description: "Read the full text of a document returned by `search`, by its id.",
      inputSchema: z.object({ id: z.string().min(1).describe("A document id from search results.") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const doc = await getDocument(env.DB, id);
      if (!doc) return { ...json({ error: `No document with id ${id}` }), isError: true };

      // Feed articles are indexed by summary only; the full text is fetched
      // from the original site the first time someone reads it, then cached.
      let text = doc.body;
      let note: string | undefined;
      if (text == null && doc.kind === "article") {
        try {
          text = await loadArticleBody(env.DB, doc);
        } catch (e) {
          note = `Full text unavailable (${e instanceof Error ? e.message : e}); this is the feed summary. Read the original at the url.`;
        }
      }
      return json({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        text: text ?? doc.summary ?? "",
        metadata: { kind: doc.kind, source: doc.source, published: doc.published_at, ...(note && { note }) },
      });
    },
  );

  server.registerTool(
    "list_sources",
    {
      title: "List sources",
      description: "List every source this server can answer from (sites and feeds) with document counts.",
      annotations: { readOnlyHint: true },
    },
    async () => json({ sources: await listSources(env.DB) }),
  );

  server.registerResource(
    "profile",
    "profile://abin",
    {
      title: "Abin Biju: profile",
      description: "Abin's projects and work experience, as markdown.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const docs = await listDocuments(env.DB, ["experience", "project"]);
      const section = (kind: string) =>
        docs
          .filter((d) => d.kind === kind)
          .map((d) => `### ${d.title}\n${d.body ?? ""}\n${d.url}`)
          .join("\n\n");
      const text = `# Abin Biju\n\n## Experience\n\n${section("experience")}\n\n## Projects\n\n${section("project")}\n`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerPrompt(
    "answer_from_trusted_sources",
    {
      title: "Answer from trusted sources",
      description: "Answer a question using only Abin's trusted sources, with citations.",
      argsSchema: z.object({ question: z.string().describe("The question to answer.") }),
    },
    ({ question }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Answer this question using only the knowledge-mcp tools: ${question}\n\n` +
              "1. Call `search` (try a couple of phrasings if the first finds little).\n" +
              "2. `fetch` the most relevant results and read them.\n" +
              "3. Answer concisely and cite each claim with the document URL.\n" +
              "If the sources don't cover it, say so instead of guessing.",
          },
        },
      ],
    }),
  );

  return server;
}
