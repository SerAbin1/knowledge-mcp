import { chunkMarkdown } from "../ingest/chunk";
import type { DocumentRow } from "../store";
import { extractArticle } from "./extract";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const USER_AGENT = "knowledge-mcp/0.1 (+https://github.com/SerAbin1/knowledge-mcp)";

// Fetches the full text of a feed article the first time an assistant reads
// it, then caches it: the body is stored, and the article is re-chunked so
// later searches (keyword now, semantic after the next embed run) match its
// full text, not just the feed summary.
//
// Only ever called with a URL that came from a curated feed (it's looked up
// by document id), never one supplied by the caller, so this can't be used
// as an open proxy.
export async function loadArticleBody(db: D1Database, doc: DocumentRow): Promise<string> {
  const res = await fetch(doc.url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) throw new Error(`not an HTML page (${type || "no content-type"})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("page too large");
  const html = await res.text();
  if (html.length > MAX_BYTES) throw new Error("page too large");

  const body = extractArticle(html);
  if (!body) throw new Error("couldn't find the article text on the page");

  const chunks = [{ heading: null, text: doc.summary ?? doc.title }, ...chunkMarkdown(body)];
  await db.batch([
    db.prepare("UPDATE document SET body = ? WHERE id = ?").bind(body, doc.id),
    db.prepare("DELETE FROM chunk WHERE document_id = ?").bind(doc.id),
    ...chunks.map((c, idx) =>
      db
        .prepare("INSERT INTO chunk (id, document_id, idx, title, heading, text) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`${doc.id}:${idx}`, doc.id, idx, doc.title, c.heading, c.text),
    ),
  ]);
  return body;
}
