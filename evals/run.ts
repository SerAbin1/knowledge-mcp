// Retrieval eval: does `search` put the right document in the top 5?
//
//   pnpm eval                         # against local `pnpm dev`
//   pnpm eval https://…/mcp           # against the deployed server
//
// recall@5: share of questions whose expected URL is in the top 5.
// MRR: mean of 1/rank of the expected URL (0 if missing), so rank 1 beats rank 4.
// Split by style: "keyword" questions share words with the answer,
// "paraphrase" ones don't. That's where semantic search should earn its keep.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

type Question = { q: string; expect: string; style: "keyword" | "paraphrase" };

const url = process.argv[2] ?? "http://localhost:8787/mcp";
const questions: Question[] = JSON.parse(readFileSync(join(import.meta.dirname, "questions.json"), "utf8"));

const client = new Client({ name: "knowledge-mcp-eval", version: "0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const rows: (Question & { rank: number | null })[] = [];
let mode = "";
for (const question of questions) {
  const res = await client.callTool({ name: "search", arguments: { query: question.q } });
  const data = JSON.parse((res.content as { text: string }[])[0].text) as { mode: string; results: { url: string }[] };
  mode = data.mode;
  const i = data.results.slice(0, 5).findIndex((r) => r.url === question.expect);
  rows.push({ ...question, rank: i === -1 ? null : i + 1 });
}
const era = client.getProtocolEra();
await client.close();

const summarize = (rs: typeof rows) => ({
  n: rs.length,
  recallAt5: +(rs.filter((r) => r.rank).length / rs.length).toFixed(2),
  mrr: +(rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rs.length).toFixed(2),
});

console.log(`search mode: ${mode}, protocol era: ${era}  (${url})\n`);
for (const r of rows) console.log(`${r.rank ? `#${r.rank}` : "--"}  [${r.style}] ${r.q}`);
console.log();
console.table({
  all: summarize(rows),
  keyword: summarize(rows.filter((r) => r.style === "keyword")),
  paraphrase: summarize(rows.filter((r) => r.style === "paraphrase")),
});
