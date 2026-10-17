// Remote MCP server that lets AI assistants (ChatGPT, Claude) search my
// trusted sources: the curated feeds in rss-reader and my own blog/portfolio.
import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "knowledge-mcp",
    // The Workers runtime gates breaking changes behind this date. Bumping it
    // is a deliberate opt-in to newer semantics.
    compatibilityDate: "2026-09-25",
    entrypoint: "src/index.ts",
    triggers: [
      // Refresh the index every 30 minutes (each run refreshes a slice of the
      // feeds). Locally: `pnpm dev`, then
      // `curl localhost:8787/cdn-cgi/local/scheduled`.
      triggers.scheduled({
        schedule: "*/30 * * * *",
      }),
    ],
    env: {
      PORTFOLIO_CONTENT_URL: bindings.text("https://serabin1.github.io/content.json"),
      PORTFOLIO_HOST: bindings.text("serabin1.github.io"),
      CURATED_OPML_URL: bindings.text("https://my-rss-reader.pages.dev/curated-feeds.opml"),
      // Documents, chunks and the FTS5 keyword index. Created with `cf d1
      // create`. The id is an identifier, not a secret, and is meant to be
      // committed. Migrations live in ./migrations, the `cf d1 migrations`
      // default; `pnpm d1:migrate` creates the tables in local dev.
      DB: bindings.d1({
        name: "knowledge-mcp",
        id: "711f0a15-dc10-4234-9644-d455944a2b1f",
      }),
      // Semantic search: Workers AI makes the embeddings, Vectorize stores and
      // searches them. The index was created with 768 dimensions and the
      // cosine metric, and must match the embedding model in
      // src/search/embed.ts. Neither has a local emulator: AI always calls the
      // real account, Vectorize is unavailable in dev, and search falls back
      // to keyword-only.
      VECTORIZE: bindings.vectorize({
        name: "knowledge-mcp",
      }),
      AI: bindings.ai({}),
    },
  },
});
