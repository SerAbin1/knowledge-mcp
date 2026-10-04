import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
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
  "access-control-allow-methods": "POST, OPTIONS",
  // "*" rather than a list: 2026-07-28 adds standard headers (Mcp-Method,
  // Mcp-Name) and per-tool Mcp-Param-* headers, and an allow-list would
  // silently break browser clients whenever a new one appears.
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "mcp-protocol-version",
};

// One MCP handler per Worker env (the factory needs env's bindings but only
// receives the request context). It serves both protocol eras on one
// endpoint: 2026-07-28 requests natively, and 2025-era clients through the
// stateless legacy fallback, each with a fresh server per request.
const handlers = new WeakMap<Env, McpHttpHandler>();
function mcpHandler(env: Env): McpHttpHandler {
  let handler = handlers.get(env);
  if (!handler) {
    handler = createMcpHandler(() => createServer(env), { onerror: (e) => console.error("mcp:", e) });
    handlers.set(env, handler);
  }
  return handler;
}

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

    return withCors(await mcpHandler(env).fetch(request));
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
