import type { Env } from "../env";
import { portfolioDocuments } from "../ingest/portfolio";
import { chunkMarkdown } from "../ingest/chunk";
import { upsertDocument } from "../store";
import { createTestDb } from "./d1";
import portfolio from "./fixtures/portfolio-content.json";

// A fresh in-memory database with the real portfolio export ingested.
export async function seededEnv(): Promise<Env> {
  const DB = createTestDb();
  for (const { doc, markdown } of portfolioDocuments(portfolio)) {
    await upsertDocument(DB, doc, chunkMarkdown(markdown));
  }
  return { DB, PORTFOLIO_CONTENT_URL: "http://test/content.json" };
}
