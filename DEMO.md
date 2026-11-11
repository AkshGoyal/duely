# Duely: 5-beat demo script

**Live app:** https://duely-production-dc131949.up.railway.app
**Login:** `demo@duely.app` / `duely-demo-2026`
**Claude connector URL:** copy it from the app's **Connect Claude** page (it's secret, so it isn't printed here).

Runtime: about 4.5 minutes. You need two screens: claude.ai on a laptop and a phone for the pay page (or an incognito window).

---

## Before you start (5 min, once)

1. **Reset demo data.** In Railway open the **duely** service → **Console** and run `npm run seed`. You should see `Seeded 10 invoices… (connector token unchanged)`.
2. **Check the connector.** In claude.ai go to Settings → Connectors. **Duely** should be listed with the URL from the Connect page.
3. **Start a fresh chat** in claude.ai with Duely switched on (tools menu under the message box).
4. **Open the dashboard** in a laptop tab, logged in.

The seed gives a realistic book: 10 invoices over 45 days, one broken promise (Bluefin), one dispute (Kaveri), a 64-day-old invoice (Mehta), a promise due this week (Orbit), and two paid. It does **not** contain Acme / INV-104; beat 1 creates that one live.

---

## Beat 1: Claude creates something real (60s)

**Say:** "I run a small design studio. Clients pay late. I already use Claude, so I just tell it."

**Type into Claude:**
> Acme Studios owes me ₹85,000 for the October retainer, INV-104, due 20 Oct. Their WhatsApp is +91 98765 43210. Create it in Duely and draft a WhatsApp nudge, firm but friendly.

**Expect:** Claude calls `create_invoice`, then `save_nudge`. It reports the invoice is about 22 days overdue, shows the message *it* wrote, and gives a WhatsApp link plus the pay link.

**Point out:** "Duely has no AI inside. Claude wrote that message; Duely stored it, added the pay link and made it a one-tap WhatsApp send."

## Beat 2: The client opens the pay page on their phone (45s)

Open the **pay link** on the phone (or in an incognito tab).

**Show:** business name, ₹85,000, "22 days overdue", the **Pay with UPI app** button and the QR code.
**Tap:** **I'll pay by a date**, pick a date 3 days out, **Send promise**. The confirmation appears.

**Say:** "No login, no app. The client either pays, promises a date, or flags an issue in one tap."

## Beat 3: The owner sees it and edits (45s)

Refresh the **dashboard**. Acme is now **Promised**, with "Pays by …" in the *Latest from client* column. **Chase today** at the top still shows Bluefin, Kaveri and Mehta, not Acme.

Open **Acme Studios** and change **Amount** to `80000` → **Save changes**.

**Show the timeline:** "Invoice created via Claude → WhatsApp nudge saved → Client opened the pay link → Client promised to pay by … → Edited on web: amount ₹85,000 → ₹80,000."

**Say:** "Everything Claude makes is editable by a human. The pay link updates instantly."

## Beat 4: Claude uses Duely's memory to decide (60s)

**Type into Claude:**
> Who owes me money and what should I do today?

**Expect:** Claude calls `get_receivables_summary` and answers in priority order:
1. **Bluefin Foods**: promise broken 4 days ago, so send a firm nudge referencing the promise.
2. **Kaveri Textiles**: dispute ("banners were cancelled, should be ₹96,000"), so resolve it before chasing.
3. **Mehta Consulting**: 64 days overdue after 2 nudges, so escalate or call.

Acme shows as *promised, don't chase yet*.

**Say:** "Duely is the memory: amounts, dates, promises kept or broken, every nudge. Claude is the judgement. The priority order comes from plain sorting rules, no model on our side."

Optional follow-up: *"Draft the Bluefin nudge."* Claude reads the history and writes a firmer message that references the broken promise.

## Beat 5: Proof it works as a business (30s)

Open **Metrics**.

**Show:** the north star (₹ collected through Duely links within 30 days of due date), activation, client response rate, promise-kept rate, edit rate (a tool-quality proxy), and Claude vs web.

**Say:** "Every number is computed live from the event log. Edit rate tells me whether my tool descriptions are good. If people keep correcting what Claude created, the prompt is wrong."

## Close: how the loop closes (30s)

**Say:** "Every rupee should end up paid, promised or disputed. Never unknown. Today clients tell us, or you tell Claude. In v2, a Razorpay webhook confirms payments automatically, WhatsApp read receipts show whether a nudge was seen, and a daily digest brings you back to Claude when a client goes quiet. That's also the business: a take rate on money collected through Duely links."

---

## Likely questions (short answers; full detail in ROADMAP.md)

| Question | Answer |
| --- | --- |
| How does Duely know an invoice is paid? | v1: the client taps *I've paid* (with UTR), or the owner marks it paid on the web or tells Claude. v2: a Razorpay webhook confirms it, and *I've paid* becomes "claimed" until confirmed. |
| What if the client pays and taps nothing? | v1 blind spot. The owner pastes a bank statement into Claude: "mark whatever these paid". Claude matches by amount and UTR and calls `mark_paid`. v2: webhook, plus bank reconciliation through the Account Aggregator framework. |
| What if the client ignores the message? | Silence is data. Days overdue grow, the invoice moves up *Chase today*, and Claude sees the nudge history and escalates one step (friendly → firm → call). v2: read receipts and a daily owner digest. |
| Do you know the nudge was actually sent? | v1: we know it was drafted, not sent. v2: log the tap on the send button, then WhatsApp Business API delivery and read receipts. |
| Isn't trusting *I've paid* risky? | Yes, and it's deliberate for v1 speed. The fix is the "claimed paid" state plus webhook confirmation, and the north star will only count confirmed payments. |
| How do invoices get in? | v1: tell Claude (a sentence, a pasted list, a PDF or a screenshot) or use the web form. v2: Tally / Zoho sync. |
| How do you make money? | Take rate on payments collected through Duely links (v2 Razorpay), plus a subscription for teams and sync. Duely's AI cost is zero because the customer brings their own Claude. |
| How does it grow? | Every pay page carries a "Sent with Duely" footer and reaches someone else's client. Later, payers get one page for everything they owe. |

---

## QA checklist (run before the demo)

### Hard constraints
- [ ] The no-AI grep from the assignment brief (model SDK names, run over everything except `node_modules`, `.git` and the local `CLAUDE.md`) prints nothing
- [ ] `https://…/health` returns `"db":"ready"`
- [ ] The app is served over HTTPS

### Claude (MCP)
- [ ] Connector lists 7 tools: create_invoice, list_invoices, get_invoice, update_invoice, save_nudge, mark_paid, get_receivables_summary
- [ ] Beat 1 prompt creates the invoice and returns a `wa.me` link with the pay link inside
- [ ] Bad input (e.g. "due date: someday") returns an error Claude fixes and retries
- [ ] A wrong connector URL gets "Unknown Duely connector URL"

### Web
- [ ] Logged out, `/` redirects to `/login`; a wrong password shows an error
- [ ] Dashboard: 4 KPI figures with aging bar, 3 "Chase today" cards, 5 filter tabs with counts, "Claude" marks on Claude-created invoices
- [ ] Phone width: the dashboard shows a card list and nothing scrolls sideways
- [ ] Invoice page: edit amount → "Saved: amount." and a timeline entry
- [ ] Line items: add, remove, "Use as amount"
- [ ] Mark paid (with confirm) → status Paid, KPI "Collected this month" updates
- [ ] New invoice by hand → source badge "web"
- [ ] Copy buttons show "Copied"

### Pay page (logged out / incognito)
- [ ] Amount, days overdue, UPI button, QR code, UPI ID
- [ ] First view moves Sent → Viewed (owner's own visits don't count)
- [ ] I've paid / I'll pay by / There's an issue each show a confirmation and appear in the owner's timeline
- [ ] Promise date in the past is rejected
- [ ] The 11th submission in 10 minutes is rate-limited (429)
- [ ] An invalid token shows a friendly 404

### Connect & Metrics
- [ ] Connect shows the URL with Copy, "Connected" once Claude has called a tool, 3 setup steps, 3 copyable prompts
- [ ] Rotate is disabled on the shared demo account
- [ ] Metrics shows the north star plus 6 metrics; the (i) on each opens its definition

## If something goes wrong live

| Symptom | Fix |
| --- | --- |
| Claude says it has no Duely tools | Turn Duely on in the chat's tools menu; start a new chat |
| "Invoice number INV-104 already exists" | You didn't reseed. Say "use update_invoice instead", or run `npm run seed` in the Railway console |
| Pay link / pages 502 | Railway is redeploying; wait 60s. Check `/health` |
| Logged out unexpectedly | `SESSION_SECRET` isn't set on Railway, so each deploy logs everyone out |
