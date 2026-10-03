export type Env = {
  DB: D1Database;
  // Where the portfolio publishes its full-content export.
  PORTFOLIO_CONTENT_URL: string;
  // The portfolio's host. Its RSS feed is in the curated OPML too, but it's
  // already indexed in full from the content export, so the feed is skipped.
  PORTFOLIO_HOST: string;
  // rss-reader's curated feed list: the single source of truth for which
  // blogs count as trusted.
  CURATED_OPML_URL: string;
};
