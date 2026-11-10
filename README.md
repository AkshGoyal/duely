# Duely

Your own Claude chases overdue invoices. Duely keeps every payment link live and every client promise on record.

Duely has no model inside. The customer connects their own Claude over MCP; Claude does the thinking and writing, Duely stores, edits and serves the result.

## Status

- [x] Gate 1: skeleton live (`/health`, MCP endpoint with a `ping` tool)
- [ ] Gate 2: Postgres + 7 invoice tools
- [ ] Gate 3: login, dashboard, editor, pay page
- [ ] Gate 4: `/metrics`, `/connect`, seed
- [ ] Gate 5: QA + `DEMO.md`

## Run locally

Requires Node 20.

```bash
npm install
npm run dev            # http://localhost:3000
```

```bash
curl -s localhost:3000/health
```

List tools over MCP (any 21+ char URL-safe token works until Gate 2):

```bash
curl -s -X POST localhost:3000/mcp/gate1-test-token-abcdefghij \
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

In the Inspector UI: **Transport type** = Streamable HTTP, **URL** = `https://<your-domain>/mcp/gate1-test-token-abcdefghij`, **Connect** → **Tools → List Tools** → you should see `ping`; run it and get `pong`.

### Env vars (all gates)

| Var | Needed from | Value |
| --- | --- | --- |
| `PORT` | Gate 1 | Set by Railway automatically |
| `DATABASE_URL` | Gate 2 | Railway: add a Postgres service, then reference `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_BASE_URL` | Gate 2 | `https://<your-domain>` (used to build pay/edit links) |
| `SESSION_SECRET` | Gate 3 | Long random string, e.g. `openssl rand -hex 32` |

## Demo login

Seeded from Gate 4: `demo@duely.app` / `duely-demo-2026`.
