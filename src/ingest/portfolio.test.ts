import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../test/d1";
import portfolio from "../test/fixtures/portfolio-content.json";
import { ingestPortfolio } from "./portfolio";

const serve = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));

afterEach(() => vi.restoreAllMocks());

describe("ingestPortfolio", () => {
  it("indexes posts, projects and experience, and skips unchanged ones next time", async () => {
    const db = createTestDb();
    serve(portfolio);
    expect(await ingestPortfolio(db, "http://test/content.json")).toEqual({ total: 10, changed: 10, removed: 0 });
    expect(await ingestPortfolio(db, "http://test/content.json")).toEqual({ total: 10, changed: 0, removed: 0 });
  });

  it("removes a post that is no longer published, along with its chunks", async () => {
    const db = createTestDb();
    serve(portfolio);
    await ingestPortfolio(db, "http://test/content.json");
    vi.restoreAllMocks();
    serve({ ...portfolio, posts: portfolio.posts.slice(1) });
    expect(await ingestPortfolio(db, "http://test/content.json")).toMatchObject({ changed: 0, removed: 1 });
    const orphans = await db
      .prepare("SELECT COUNT(*) AS n FROM chunk WHERE document_id NOT IN (SELECT id FROM document)")
      .first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });
});
