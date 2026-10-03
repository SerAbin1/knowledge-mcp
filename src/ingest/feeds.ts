import { syncDocuments, type Item } from "../store";
import { parseFeed, parseOpml, type OpmlFeed } from "./feed-parser";

// Feeds refreshed per cron run. Each costs one subrequest plus a few D1
// queries; Workers caps both per invocation (50 on the free plan), so the
// 51 curated feeds are refreshed a slice at a time, stalest first.
const FEEDS_PER_RUN = 10;
// Only the newest items of a feed are (re)indexed each time. Older ones stay
// in the index from earlier runs; nothing is deleted when it scrolls off.
const ITEMS_PER_FEED = 30;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "knowledge-mcp/0.1 (+https://github.com/SerAbin1/knowledge-mcp)";

type FeedRow = { url: string; title: string; etag: string | null; last_modified: string | null };

// Brings the feed table in line with the OPML: adds new feeds, and removes
// feeds (and their articles) that are no longer curated. Feeds pointing at
// `skipHost` are skipped since that site is indexed in full elsewhere.
export async function syncFeedList(db: D1Database, opmlUrl: string, skipHost: string) {
  const res = await fetch(opmlUrl, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`opml: GET ${opmlUrl} → ${res.status}`);
  const feeds = parseOpml(await res.text()).filter((f) => new URL(f.url).host !== skipHost);

  const { results } = await db.prepare("SELECT url FROM feed").all<{ url: string }>();
  const known = new Set(results.map((r) => r.url));
  const curated = new Set(feeds.map((f) => f.url));
  const removed = results.filter((r) => !curated.has(r.url));

  await db.batch([
    ...feeds.map((f: OpmlFeed) =>
      known.has(f.url)
        ? db.prepare("UPDATE feed SET title = ? WHERE url = ?").bind(f.title, f.url)
        : db.prepare("INSERT INTO feed (url, title) VALUES (?, ?)").bind(f.url, f.title),
    ),
    ...removed.flatMap((r) => [
      db.prepare("DELETE FROM document WHERE feed_url = ?").bind(r.url),
      db.prepare("DELETE FROM feed WHERE url = ?").bind(r.url),
    ]),
  ]);
  return { feeds: feeds.length, removed: removed.length };
}

// Refreshes the stalest feeds. Returns ids of new or changed articles.
export async function ingestFeeds(db: D1Database, limit = FEEDS_PER_RUN) {
  const { results: feeds } = await db
    .prepare("SELECT url, title, etag, last_modified FROM feed ORDER BY last_ingested_at IS NOT NULL, last_ingested_at LIMIT ?")
    .bind(limit)
    .all<FeedRow>();

  const outcomes = await Promise.all(feeds.map((f) => ingestFeed(db, f)));
  return {
    feeds: feeds.length,
    failed: outcomes.filter((o) => o.error).map((o) => `${o.url}: ${o.error}`),
    changedIds: outcomes.flatMap((o) => o.changedIds),
  };
}

async function ingestFeed(db: D1Database, feed: FeedRow) {
  const now = new Date().toISOString();
  try {
    const headers: Record<string, string> = { "user-agent": USER_AGENT };
    if (feed.etag) headers["if-none-match"] = feed.etag;
    if (feed.last_modified) headers["if-modified-since"] = feed.last_modified;
    const res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (res.status === 304) {
      await markIngested(db, feed.url, now, null, feed.etag, feed.last_modified);
      return { url: feed.url, error: null, changedIds: [] };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const parsed = parseFeed(await res.text());
    const items: Item[] = parsed.items.slice(0, ITEMS_PER_FEED).map((it) => ({
      doc: {
        kind: "article",
        source: feed.title,
        url: it.link,
        title: it.title,
        summary: it.summary || null,
        body: null, // fetched lazily the first time an assistant reads it
        publishedAt: it.publishedAt,
        feedUrl: feed.url,
      },
      chunks: [{ heading: null, text: it.summary || it.title }],
    }));
    const changedIds = await syncDocuments(db, items);
    await markIngested(db, feed.url, now, null, res.headers.get("etag"), res.headers.get("last-modified"));
    return { url: feed.url, error: null, changedIds };
  } catch (e) {
    // A broken feed is recorded and retried on its next turn; it must not
    // stop the other feeds in this run.
    const error = e instanceof Error ? e.message : String(e);
    await markIngested(db, feed.url, now, error, feed.etag, feed.last_modified);
    return { url: feed.url, error, changedIds: [] };
  }
}

function markIngested(db: D1Database, url: string, at: string, error: string | null, etag: string | null, lastModified: string | null) {
  return db
    .prepare("UPDATE feed SET last_ingested_at = ?, last_error = ?, etag = ?, last_modified = ? WHERE url = ?")
    .bind(at, error, etag, lastModified, url)
    .run();
}
