# Decisions log

Simplest-reasonable calls made where the spec was ambiguous.

1. **MCP stateless pattern** follows the SDK's own `simpleStatelessStreamableHttp` example (SDK 1.32): new `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST; GET/DELETE return 405 JSON-RPC errors.
2. **Plain `express()` instead of the SDK's `createMcpExpressApp()`**: that helper's DNS-rebinding guard targets localhost binding; we bind `0.0.0.0` behind Railway's TLS proxy.
3. **CORS on `/mcp/:token`** (allow `*`, expose `Mcp-Session-Id`) so MCP Inspector's direct browser mode works. Auth is the secret token in the URL, not cookies, so `*` is safe.
4. **Gate 1 token check is format-only** (21–64 URL-safe chars). Gate 2 replaces it with a DB lookup of `users.mcp_token`.
5. **TypeScript pinned to 5.x** (npm resolved 7.x by default; not worth the risk tonight). Backend compiles to CommonJS.
6. **`CLAUDE.md` is git-ignored**: it quotes the no-AI grep pattern verbatim, so committing it would make the grep check match itself.
7. **Logging**: request logger rewrites `/mcp/<token>` and `/pay/<token>` to `:token`; tokens are never logged.
