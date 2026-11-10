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
20. **Client "I've paid" marks the invoice paid** (source `client`, full amount, their UTR as reference). v1 has no "claimed" status; the timeline shows "Client reported payment" so the owner can reopen it via the status override. The `mark_paid` tool description tells Claude this.
21. **`page_viewed` is logged once per invoice** (first client view only) and moves `sent → viewed`. The owner previewing their own pay link while logged in is not counted.
22. **Client promise dates** must be between today and 90 days out. A promise moves the invoice to `promised`; an issue moves it to `disputed`.
23. **Rate limits** are in-memory, per IP: 10 pay-page POSTs per 10 min, 20 login attempts per 10 min. Fine for one instance.
24. **CSRF**: owner forms rely on `SameSite=Lax` session cookies (cross-site POSTs carry no session). No token library added.
25. **HTML escaping**: a small tagged-template helper (`src/web/html.ts`) escapes every interpolated value by default; only trusted markup is passed through `raw()`.
26. **`SESSION_SECRET` falls back to a random value** with a warning, so a missing variable can't take the site down. The cost is logging everyone out on each deploy.
27. **Pay page sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`** so the token doesn't leak through Referer headers or shared caches.
28. **Web form edits** always post a status; if only the promise date changed, the status is left to the service so the invoice still moves to `promised`.
29. **Nav shows only built pages**: Connect and Metrics links arrive with Gate 4.
