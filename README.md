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
