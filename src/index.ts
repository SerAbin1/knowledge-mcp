import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") {
      return new Response("knowledge-mcp: MCP endpoint is at /mcp\n", { status: 404 });
    }

    // Stateless mode: no session id, a fresh server + transport per request.
    // Workers isolates don't keep memory between requests, and none of our
    // tools need conversation state, so there's nothing to persist.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer();
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler;
