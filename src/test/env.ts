import type { Env } from "../env";
import { portfolioDocuments } from "../ingest/portfolio";
import { chunkMarkdown } from "../ingest/chunk";
import { syncDocuments } from "../store";
import { createTestDb } from "./d1";
import portfolio from "./fixtures/portfolio-content.json";

// A fresh in-memory database with the real portfolio export ingested.
export async function seededEnv(): Promise<Env> {
  const DB = createTestDb();
  await syncDocuments(
    DB,
    portfolioDocuments(portfolio).map(({ doc, markdown }) => ({
      doc,
      chunks: chunkMarkdown(markdown),
    })),
  );
  return {
    DB,
    PORTFOLIO_CONTENT_URL: "http://test/content.json",
    PORTFOLIO_HOST: "serabin1.github.io",
    CURATED_OPML_URL: "http://test/curated.opml",
  };
}
