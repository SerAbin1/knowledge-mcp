import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import worker from "./index";
import { createServer } from "./server";

async function connectedClient() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

describe("mcp server", () => {
  it("lists the ping tool", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("ping");
  });

  it("ping returns pong", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
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
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("ping");
  });

  it("404s outside /mcp", async () => {
    const res = await worker.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(404);
  });
});
