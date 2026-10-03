import { describe, expect, it } from "vitest";
import { parseFeed, parseOpml } from "./feed-parser";

describe("parseFeed", () => {
  it("parses RSS with HTML descriptions, CDATA and content:encoded", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Lemire</title>
          <link>https://lemire.me/blog</link>
          <item>
            <title>Parsing &amp; SIMD</title>
            <link>https://lemire.me/blog/simd/</link>
            <pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate>
            <description><![CDATA[<p>Fast <b>parsing</b> with SIMD &#8212; really fast.</p>]]></description>
          </item>
          <item>
            <title>Only full content</title>
            <link>https://lemire.me/blog/full/</link>
            <content:encoded><![CDATA[<p>The whole post.</p><script>evil()</script>]]></content:encoded>
          </item>
          <item><title>No link, skipped</title></item>
        </channel>
      </rss>`);
    expect(feed.title).toBe("Lemire");
    expect(feed.items).toEqual([
      {
        title: "Parsing & SIMD",
        link: "https://lemire.me/blog/simd/",
        publishedAt: "2026-09-28T10:00:00.000Z",
        summary: "Fast parsing with SIMD — really fast.",
      },
      { title: "Only full content", link: "https://lemire.me/blog/full/", publishedAt: null, summary: "The whole post." },
    ]);
  });

  it("parses Atom, picking the alternate link and an HTML title", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>research!rsc</title>
        <link rel="self" href="https://research.swtch.com/feed.atom"/>
        <entry>
          <title type="html">Go &amp;lt;3</title>
          <link rel="replies" href="https://research.swtch.com/go#comments"/>
          <link rel="alternate" href="https://research.swtch.com/go"/>
          <updated>2026-01-02T03:04:05Z</updated>
          <summary>Why Go.</summary>
        </entry>
      </feed>`);
    expect(feed.title).toBe("research!rsc");
    expect(feed.items).toEqual([
      { title: "Go <3", link: "https://research.swtch.com/go", publishedAt: "2026-01-02T03:04:05.000Z", summary: "Why Go." },
    ]);
  });

  it("caps summaries at a word boundary", () => {
    const long = "word ".repeat(400);
    const feed = parseFeed(
      `<rss><channel><item><title>T</title><link>https://x.dev/a</link><description>${long}</description></item></channel></rss>`,
    );
    expect(feed.items[0].summary.length).toBeLessThanOrEqual(1001);
    expect(feed.items[0].summary.endsWith("word…")).toBe(true);
  });

  it("rejects documents that aren't feeds", () => {
    expect(() => parseFeed("<html><body>nope</body></html>")).toThrow(/Unrecognized/);
  });
});

describe("parseOpml", () => {
  it("flattens nested outlines and prefers title over text", () => {
    const feeds = parseOpml(`<opml version="2.0"><body>
      <outline text="Default" title="Default">
        <outline title="Mitchell Hashimoto " text="x" xmlUrl="https://mitchellh.com/feed.xml"/>
        <outline text="tonsky.me" xmlUrl="https://tonsky.me/atom.xml"/>
      </outline>
      <outline title="Top level" xmlUrl="https://top.dev/rss"/>
    </body></opml>`);
    expect(feeds).toEqual([
      { url: "https://mitchellh.com/feed.xml", title: "Mitchell Hashimoto" },
      { url: "https://tonsky.me/atom.xml", title: "tonsky.me" },
      { url: "https://top.dev/rss", title: "Top level" },
    ]);
  });
});
