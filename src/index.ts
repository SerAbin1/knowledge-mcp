import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./env";
import { ingestFeeds, syncFeedList } from "./ingest/feeds";
import { ingestPortfolio } from "./ingest/portfolio";
import { embedPending } from "./search/embed";
import { createServer } from "./server";

// Browser-based MCP clients (e.g. the MCP Inspector's web UI) call the server
// cross-origin. ChatGPT and Claude call it server-side and don't need this.
// Everything here is public and read-only, so any origin is fine.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("knowledge-mcp: MCP endpoint is at /mcp\n", { status: 404 });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Stateless mode: no session id, a fresh server + transport per request.
    // Workers isolates don't keep memory between requests, and none of our
    // tools need conversation state, so there's nothing to persist.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(env);
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  },

  // Cron trigger (see wrangler.toml): refreshes the index from the sources.
  // Stages run independently so one failing source doesn't block the others.
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const report: Record<string, unknown> = {};
    const stage = async (name: string, run: () => Promise<unknown>) => {
      try {
        report[name] = await run();
      } catch (e) {
        report[name] = { error: e instanceof Error ? e.message : String(e) };
      }
    };
    await stage("portfolio", () => ingestPortfolio(env.DB, env.PORTFOLIO_CONTENT_URL));
    await stage("feedList", () => syncFeedList(env.DB, env.CURATED_OPML_URL, env.PORTFOLIO_HOST));
    await stage("feeds", () => ingestFeeds(env.DB));
    if (env.AI && env.VECTORIZE) {
      const [ai, index] = [env.AI, env.VECTORIZE];
      await stage("embed", () => embedPending(env.DB, ai, index));
    }
    console.log("ingest", JSON.stringify(report, (k, v) => (k === "changedIds" ? v.length : v)));
  },
} satisfies ExportedHandler<Env>;
