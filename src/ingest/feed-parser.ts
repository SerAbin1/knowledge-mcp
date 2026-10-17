import { XMLParser } from "fast-xml-parser";
import { htmlToText, truncate } from "./html";

// Mirrors rss-reader's src/lib/feed-parser.ts, but without DOMParser (not
// available in Workers) and with a summary per item, which rss-reader doesn't
// need but search does.
export type FeedItem = { title: string; link: string; publishedAt: string | null; summary: string };
export type ParsedFeed = { title: string | null; items: FeedItem[] };
export type OpmlFeed = { url: string; title: string };

const SUMMARY_CHARS = 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true, // content:encoded → encoded, dc:date → date
  textNodeName: "#text",
  parseTagValue: false,
  isArray: (name) => ["item", "entry", "link", "outline"].includes(name),
});

type Node = Record<string, unknown>;

// An element's text, whether the parser gave us a string or an object with
// attributes (e.g. Atom's <title type="html">).
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text((value as Node)["#text"]);
  return "";
}

function isoDate(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const summaryOf = (...candidates: unknown[]) =>
  truncate(htmlToText(candidates.map(text).find(Boolean) ?? ""), SUMMARY_CHARS);

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Node;

  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (channel) {
    const items = ((channel.item as Node[] | undefined) ?? []).flatMap((item) => {
      const title = htmlToText(text(item.title));
      const link = text(item.link) || text(item.guid);
      if (!title || !/^https?:/.test(link)) return [];
      return [
        {
          title,
          link,
          publishedAt: isoDate(text(item.pubDate) || text(item.date)),
          summary: summaryOf(item.description, item.encoded),
        },
      ];
    });
    return { title: text(channel.title) || null, items };
  }

  const feed = doc.feed as Node | undefined;
  if (feed) {
    const items = ((feed.entry as Node[] | undefined) ?? []).flatMap((entry) => {
      const title = htmlToText(text(entry.title));
      const link = alternateLink(entry.link as Node[] | undefined);
      if (!title || !link) return [];
      return [
        {
          title,
          link,
          publishedAt: isoDate(text(entry.published) || text(entry.updated)),
          summary: summaryOf(entry.summary, entry.content),
        },
      ];
    });
    return { title: text(feed.title) || null, items };
  }

  throw new Error("Unrecognized feed format (not RSS or Atom)");
}

// Atom entries can have several links (self, replies, ...); the article is
// rel="alternate", or no rel at all (the spec default).
function alternateLink(links: Node[] | undefined): string | null {
  for (const l of links ?? []) {
    const rel = l["@_rel"];
    if (!rel || rel === "alternate") return (l["@_href"] as string | undefined)?.trim() || null;
  }
  return null;
}

// Every outline with an xmlUrl at any depth, so folders are flattened.
export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parser.parse(xml) as Node;
  const out: OpmlFeed[] = [];
  const walk = (outlines: Node[] | undefined) => {
    for (const o of outlines ?? []) {
      const url = o["@_xmlUrl"] as string | undefined;
      if (url) out.push({ url, title: String(o["@_title"] ?? o["@_text"] ?? url).trim() });
      walk(o.outline as Node[] | undefined);
    }
  };
  walk(((doc.opml as Node | undefined)?.body as Node | undefined)?.outline as Node[] | undefined);
  return out;
}
