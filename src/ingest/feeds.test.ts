import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ftsSearch } from "../search/fts";
import { createTestDb } from "../test/d1";
import { ingestFeeds, syncFeedList } from "./feeds";

const opml = (urls: string[]) =>
  `<opml><body>${urls.map((u) => `<outline title="${new URL(u).host}" xmlUrl="${u}"/>`).join("")}</body></opml>`;

const rss = (items: { title: string; link: string; description: string }[]) =>
  `<rss><channel><title>Feed</title>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`,
    )
    .join("")}</channel></rss>`;

// Routes fetch() by URL to canned responses, and records request headers.
let routes: Record<string, () => Response>;
let requests: { url: string; headers: Headers }[];
beforeEach(() => {
  routes = {};
  requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) throw new Error(`connection refused: ${url}`);
    return route();
  });
});
afterEach(() => vi.restoreAllMocks());

const count = async (db: D1Database, sql: string) =>
  (await db.prepare(sql).first<{ n: number }>())!.n;

describe("syncFeedList", () => {
  it("adds curated feeds, skips the portfolio's own feed, and drops uncurated feeds with their articles", async () => {
    const db = createTestDb();
    routes["http://test/opml"] = () =>
      new Response(
        opml(["https://a.dev/rss", "https://b.dev/rss", "https://serabin1.github.io/rss.xml"]),
      );
    expect(await syncFeedList(db, "http://test/opml", "serabin1.github.io")).toEqual({
      feeds: 2,
      removed: 0,
    });

    routes["https://b.dev/rss"] = () =>
      new Response(rss([{ title: "B post", link: "https://b.dev/1", description: "about b" }]));
    routes["https://a.dev/rss"] = () => new Response(rss([]));
    await ingestFeeds(db);
    expect(await count(db, "SELECT COUNT(*) AS n FROM document WHERE kind = 'article'")).toBe(1);

    routes["http://test/opml"] = () => new Response(opml(["https://a.dev/rss"]));
    expect(await syncFeedList(db, "http://test/opml", "serabin1.github.io")).toEqual({
      feeds: 1,
      removed: 1,
    });
    expect(await count(db, "SELECT COUNT(*) AS n FROM document")).toBe(0);
    expect(await count(db, "SELECT COUNT(*) AS n FROM chunk")).toBe(0);
  });
});

describe("ingestFeeds", () => {
  async function dbWithFeeds(urls: string[]) {
    const db = createTestDb();
    routes["http://test/opml"] = () => new Response(opml(urls));
    await syncFeedList(db, "http://test/opml", "serabin1.github.io");
    return db;
  }

  it("indexes title + summary so articles are searchable, with no body yet", async () => {
    const db = await dbWithFeeds(["https://lemire.me/feed"]);
    routes["https://lemire.me/feed"] = () =>
      new Response(
        rss([
          {
            title: "Parsing JSON quickly",
            link: "https://lemire.me/json",
            description: "SIMD tricks for parsers",
          },
        ]),
      );
    const result = await ingestFeeds(db);
    expect(result).toMatchObject({ feeds: 1, failed: [] });
    expect(result.changedIds).toHaveLength(1);

    const [hit] = await ftsSearch(db, "simd parser");
    const doc = await db
      .prepare("SELECT * FROM document WHERE id = ?")
      .bind(hit.documentId)
      .first<Record<string, unknown>>();
    expect(doc).toMatchObject({
      kind: "article",
      source: "lemire.me",
      body: null,
      feed_url: "https://lemire.me/feed",
    });
  });

  it("sends conditional GET headers next time and treats 304 as no change", async () => {
    const db = await dbWithFeeds(["https://a.dev/rss"]);
    routes["https://a.dev/rss"] = () =>
      new Response(rss([{ title: "A", link: "https://a.dev/1", description: "a" }]), {
        headers: { etag: '"v1"' },
      });
    await ingestFeeds(db);

    routes["https://a.dev/rss"] = () => new Response(null, { status: 304 });
    expect(await ingestFeeds(db)).toMatchObject({ failed: [], changedIds: [] });
    expect(requests.at(-1)?.headers.get("if-none-match")).toBe('"v1"');
    expect(await count(db, "SELECT COUNT(*) AS n FROM document")).toBe(1);
  });

  it("re-ingesting an unchanged feed changes nothing", async () => {
    const db = await dbWithFeeds(["https://a.dev/rss"]);
    routes["https://a.dev/rss"] = () =>
      new Response(rss([{ title: "A", link: "https://a.dev/1", description: "a" }]));
    expect((await ingestFeeds(db)).changedIds).toHaveLength(1);
    expect((await ingestFeeds(db)).changedIds).toHaveLength(0);
  });

  it("records a broken feed without failing the others", async () => {
    const db = await dbWithFeeds(["https://down.dev/rss", "https://ok.dev/rss"]);
    routes["https://ok.dev/rss"] = () =>
      new Response(rss([{ title: "Ok", link: "https://ok.dev/1", description: "fine" }]));
    const result = await ingestFeeds(db);
    expect(result.failed).toEqual([
      "https://down.dev/rss: connection refused: https://down.dev/rss",
    ]);
    expect(result.changedIds).toHaveLength(1);
    const feed = await db
      .prepare("SELECT last_error FROM feed WHERE url = ?")
      .bind("https://down.dev/rss")
      .first<{ last_error: string }>();
    expect(feed?.last_error).toMatch(/connection refused/);
  });

  it("refreshes the stalest feeds first, a limited number per run", async () => {
    const urls = ["https://1.dev/rss", "https://2.dev/rss", "https://3.dev/rss"];
    const db = await dbWithFeeds(urls);
    for (const u of urls) routes[u] = () => new Response(rss([]));

    await ingestFeeds(db, 2);
    await ingestFeeds(db, 2);
    const polled = requests.filter((r) => r.url !== "http://test/opml").map((r) => r.url);
    expect(polled.slice(0, 2).sort()).toEqual(urls.slice(0, 2));
    expect(polled[2]).toBe("https://3.dev/rss"); // never polled, so stalest
  });
});
