import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Builds the MCP server: the list of tools, resources and prompts an AI client
// can discover and call. Kept separate from the HTTP wiring in index.ts so
// tests can talk to it over an in-memory transport.
export function createServer(): McpServer {
  const server = new McpServer({ name: "knowledge-mcp", version: "0.0.1" });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check. Returns 'pong' so you can confirm the server is reachable.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}
