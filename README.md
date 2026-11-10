# Duely

Your own Claude chases overdue invoices. Duely keeps every payment link live and every client promise on record.

Duely has no model inside. The customer connects their own Claude over MCP; Claude does the thinking and writing, Duely stores, edits and serves the result.

## Status

- [x] Gate 1: skeleton live (`/health`, MCP endpoint with a `ping` tool)
- [x] Gate 2: Postgres + 7 invoice tools
- [x] Gate 3: login, dashboard, editor, pay page
- [x] Gate 4: `/metrics`, `/connect`, seed
- [x] Gate 5: QA + [`DEMO.md`](DEMO.md)

## Run locally

Requires Node 20 and a Postgres database.

```bash
npm install
DATABASE_URL=postgres://localhost:5432/duely npm run dev   # http://localhost:3000
```

Migrations in `db/migrations` run on every boot (idempotent). The demo user is created on first boot.

Print the demo user's connector URL (contains a secret, so run it in a trusted shell only):

```bash
npm run connect-url:dev
```

```bash
curl -s localhost:3000/health
```

List tools over MCP (use your connector URL):

```bash
curl -s -X POST localhost:3000/mcp/<your-mcp-token> \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Deploy to Railway (Gate 1)

Railway builds from the `Dockerfile` automatically.

1. Push this repo to GitHub (private is fine).
2. railway.app → **New Project** → **Deploy from GitHub repo** → pick the repo.
3. Service → **Settings → Networking → Generate Domain**. Railway sets `PORT` itself; no env vars are needed for Gate 1.
4. Check: `https://<your-domain>/health` returns `{"ok":true,...}`.

Or with the CLI:

```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```

### Verify with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI: **Transport type** = Streamable HTTP, **URL** = your connector URL, **Connect** → **Tools → List Tools** → you should see the 7 Duely tools.

### Env vars (all gates)

| Var | Needed from | Value |
| --- | --- | --- |
| `PORT` | Gate 1 | Set by Railway automatically |
| `DATABASE_URL` | Gate 2 | Railway: add a Postgres service, then reference `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_BASE_URL` | Gate 2 | `https://<your-domain>` (used to build pay/edit links; falls back to Railway's `RAILWAY_PUBLIC_DOMAIN`) |
| `DEMO_MCP_TOKEN` | Gate 2, optional | Fixes the demo user's connector token when the user is first created (21+ URL-safe chars). Otherwise a random one is generated; read it with `npm run connect-url`. |
| `ALLOW_DEMO_ROTATE` | optional | `true` lets the shared demo account rotate its connector URL (off by default) |
| `SESSION_SECRET` | Gate 3 | Long random string, e.g. `openssl rand -hex 32`. If unset, a random one is used and everyone is logged out on each deploy. |

## MCP tools

| Tool | What it does |
| --- | --- |
| `create_invoice` | Records money owed; returns a live pay link and edit link |
| `list_invoices` | Invoices with days overdue, promises, last client action, nudges sent |
| `get_invoice` | One invoice with full event timeline and past nudges |
| `update_invoice` | Edits any field; records promises; logs `invoice_edited` |
| `save_nudge` | Stores a reminder Claude wrote; returns `wa.me` and `mailto:` links |
| `mark_paid` | Records payment (amount, UTR/reference) |
| `get_receivables_summary` | Totals, aging buckets, promises, disputes, rule-sorted priority list |

## Web pages

| Route | Who | What |
| --- | --- | --- |
| `/login`, `/logout` | Owner | Cookie session (signed, httpOnly, SameSite=Lax) |
| `/` | Owner | KPI tiles, aging bar, invoice table with status filters |
| `/invoices/new` | Owner | Manual creation (works without Claude) |
| `/invoices/:id` | Owner | Edit all fields + line items, status override, mark paid, pay link, nudges, timeline |
| `/pay/:token` | Client, public | Amount, days overdue, UPI QR + deep link, "I've paid" / "I'll pay by" / "There's an issue" |
| `/connect` | Owner | Connector URL + copy, connection status, setup steps, example prompts, rotate token |
| `/metrics` | Owner | North star + activation, time to first link, response rate, promise-kept, due→paid, edit rate, Claude vs web |

## Demo login

`demo@duely.app` / `duely-demo-2026`

## Seed demo data

Resets the demo account to 10 realistic invoices over the last 45 days (broken promise, dispute, paid, draft, cancelled). It keeps the demo user's connector token, so a connected Claude keeps working.

```bash
npm run seed          # production build (Railway console)
npm run seed:dev      # local, via tsx
```

See [DEMO.md](DEMO.md) for the 5-beat demo script and QA checklist.
