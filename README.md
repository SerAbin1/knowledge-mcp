# knowledge-mcp

Remote MCP server that lets AI assistants (ChatGPT, Claude) answer from my trusted sources: the curated feeds in [rss-reader](https://github.com/SerAbin1/rss-reader) and my blog at [serabin1.github.io](https://serabin1.github.io).

```bash
pnpm install
pnpm dev     # http://localhost:8787/mcp
pnpm test
```

Try it with the MCP Inspector (`pnpm dlx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL above) or Claude Code (`claude mcp add --transport http knowledge http://localhost:8787/mcp`).

## Local data

```bash
pnpm d1:migrate                               # create tables in the local D1
echo 'PORTFOLIO_CONTENT_URL=http://127.0.0.1:4321/content.json' > .dev.vars   # optional: use a local portfolio build
pnpm dev --test-scheduled
curl localhost:8787/__scheduled               # run the ingest cron once
```

## Deploy (once)

1. `pnpm exec wrangler login`
2. `pnpm exec wrangler d1 create knowledge-mcp`, and put the printed `database_id` in `wrangler.toml`.
3. `pnpm exec wrangler vectorize create knowledge-mcp --dimensions=768 --metric=cosine`, then uncomment the `[ai]` and `[[vectorize]]` blocks in `wrangler.toml`.
4. `pnpm d1:migrate:remote && pnpm run deploy` (`pnpm run`, because plain `pnpm deploy` is a built-in pnpm command). After that, pushing to `main` deploys through GitHub Actions. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, the same as rss-reader.
5. Push serabin1.github.io so `/content.json` is live.

The cron runs every 30 minutes. The first few runs pick up the 50 feeds 10 at a time and backfill embeddings up to 500 chunks per run. Watch it with `pnpm exec wrangler tail`.

## Connect

The endpoint is `https://knowledge-mcp.abinyt1234.workers.dev/mcp`. It's public and read-only, with no auth.

- **ChatGPT:** Settings → Apps & Connectors → Advanced → turn on Developer mode → Create. Paste the URL and pick "No authentication".
- **Claude.ai:** Settings → Connectors → Add custom connector → paste the URL.
- **Claude Code:** `claude mcp add --transport http knowledge <url>`
- **MCP Inspector:** `pnpm dlx @modelcontextprotocol/inspector` (web UI), or `pnpm dlx @modelcontextprotocol/inspector --cli <url> --transport http --method tools/list`

## Evals

`pnpm eval [url]` runs `evals/questions.json` through `search` and reports recall@5 and MRR, split into keyword-style and paraphrased questions. Run it before and after any change to chunking or ranking.

| | recall@5 | MRR |
|---|---|---|
| keyword-only, baseline | 0.69 | 0.53 |
| + source names indexed | 0.75 | 0.59 |
| + embeddings (hybrid) | _run after deploy_ | |
