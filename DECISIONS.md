# Decisions log

Simplest-reasonable calls made where the spec was ambiguous.

1. **MCP stateless pattern** follows the SDK's own `simpleStatelessStreamableHttp` example (SDK 1.32): new `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST; GET/DELETE return 405 JSON-RPC errors.
2. **Plain `express()` instead of the SDK's `createMcpExpressApp()`**: that helper's DNS-rebinding guard targets localhost binding; we bind `0.0.0.0` behind Railway's TLS proxy.
3. **CORS on `/mcp/:token`** (allow `*`, expose `Mcp-Session-Id`) so MCP Inspector's direct browser mode works. Auth is the secret token in the URL, not cookies, so `*` is safe.
4. **Gate 1 token check is format-only** (21–64 URL-safe chars). Gate 2 replaces it with a DB lookup of `users.mcp_token`.
5. **TypeScript pinned to 5.x** (npm resolved 7.x by default; not worth the risk tonight). Backend compiles to CommonJS.
6. **`CLAUDE.md` is git-ignored**: it quotes the no-AI grep pattern verbatim, so committing it would make the grep check match itself.
7. **Logging**: request logger rewrites `/mcp/<token>` and `/pay/<token>` to `:token`; tokens are never logged.
8. **Gate 2 token check** now looks up `users.mcp_token`; unknown tokens get a 404 JSON-RPC error. The demo user is created on boot so the connector works before the seed script exists; `DEMO_MCP_TOKEN` optionally fixes its token at creation.
9. **`paid_at` column added** to `invoices` (not in the spec's model). It makes "collected this month" and "days from due date to paid" simple queries.
10. **Enums are `TEXT` + `CHECK`** instead of Postgres `ENUM` types, so migrations stay idempotent and easy to extend.
11. **"Open" invoices** are `sent | viewed | promised | disputed`. Outstanding, overdue, aging and priority count only these. Drafts and cancelled invoices are excluded.
12. **Default `issue_date`** is the earlier of today and the due date, so back-filled overdue invoices don't show an issue date after their due date.
13. **Auto invoice numbers** are `INV-001`, `INV-002`, … per user when Claude doesn't pass one. Numbers are unique per user (case-insensitive check); a clash returns an error that names the existing invoice.
14. **Setting `promise_date`** (via a tool or the web) moves `sent/viewed/draft` to `promised` and logs `promise_made`, unless a status is passed explicitly.
15. **`mark_paid` with a smaller amount** still marks the invoice paid and returns `short_by`; v1 has no partial-payment state.
16. **`list_invoices` default** returns everything except cancelled, most overdue first. Added an optional `client_name` filter so Claude can answer "has Acme paid?" in one call.
17. **`save_nudge` appends the pay link** unless the message already contains it, and returns soft warnings (WhatsApp over 80 words, missing amount, missing phone/email) rather than rejecting.
18. **`ping` removed**: the connector exposes exactly the 7 spec tools.
19. **Zod validation messages** are written for Claude ("Due date must be a real calendar date in YYYY-MM-DD…"); the SDK returns them as tool errors so Claude can fix and retry.
