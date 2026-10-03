import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { htmlToText } from "../ingest/html";

// Firefox Reader View's algorithm: finds the main article in a page and drops
// nav, ads, comments and footers. linkedom stands in for the browser DOM,
// which Workers doesn't have.
export function extractArticle(html: string): string | null {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
  const text = article?.content ? htmlToText(article.content) : "";
  return text.length > 200 ? text : null;
}
