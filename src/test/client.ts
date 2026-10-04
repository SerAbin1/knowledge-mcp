import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Env } from "../env";
import worker from "../index";

// The two protocol eras a deployed server has to serve: 2026-07-28 clients
// (stateless, `server/discover`, per-request `_meta` envelope) and 2025-era
// clients (`initialize` handshake). Every server test runs against both.
export const ERAS = ["modern", "legacy"] as const;
export type Era = (typeof ERAS)[number];

// A real MCP client talking to the real Worker entry point (routing, CORS and
// all) in-process: the transport's fetch calls worker.fetch directly instead
// of opening a socket.
export async function connect(env: Env, era: Era): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => worker.fetch(new Request(url, init), env),
  });
  const client = new Client(
    { name: "test", version: "0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(transport);
  return client;
}

// Calls a tool whose result is a single JSON text block, and parses it.
export async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { result, data: JSON.parse(first.text) };
}
