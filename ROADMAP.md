# Roadmap: closing the loop

Duely's job is to make sure every rupee owed ends in one of three states: **paid**, **promised with a date**, or **disputed with a reason**. "Unknown" is the enemy. This doc maps how each state change reaches Duely today, where v1 relies on someone telling us, and what v2 builds to make the loop close by itself.

## 1. The loop in v1

```
Owner tells Claude ──▶ create_invoice ──▶ invoice (sent) + live pay link
        │
        ▼
Claude writes nudge ──▶ save_nudge ──▶ wa.me / mailto link ──▶ owner taps send
                                                                  │
                                                                  ▼
                                               client opens /pay/… ──▶ viewed
                                         ┌────────────┬─────────────┼──────────────┐
                                         ▼            ▼             ▼              ▼
                                     I've paid   I'll pay by    There's an     does nothing
                                      → paid     → promised      issue          → stays viewed,
                                                 (date passes   → disputed      days overdue grow
                                                  → broken)
        ▲                                                                          │
        └──── get_receivables_summary / "Chase today" ranks it, Claude escalates ◀─┘
```

## 2. Every status change and who triggers it

| Change | Trigger in v1 | How reliable | Gap |
| --- | --- | --- | --- |
| → sent | Claude `create_invoice` or web form | Certain | None |
| → viewed | Client opens pay link (owner's own visits ignored) | Certain | None |
| → promised | Client taps *I'll pay by*, or owner/Claude sets a promise date | Certain | None |
| promise broken | Computed daily: promise date passed, not paid | Certain | Nobody is told until they look |
| → disputed | Client taps *There's an issue* | Certain | None |
| → paid (client says) | Client taps *I've paid*, optional UTR | **Trust-based** | Not verified against the bank |
| → paid (owner says) | Owner marks paid on web, or tells Claude (`mark_paid`) | Correct but **manual** | Owner has to remember |
| Client pays by UPI and taps nothing | Nothing changes | **Blind spot** | Duely keeps showing it as overdue until the owner says so |
| Nudge actually sent | We store the draft (`nudge_saved`); the owner sends from their own WhatsApp | **Unknown** | We can't tell drafted from sent, delivered or read |
| Client ignores everything | Status stays sent/viewed; days overdue rise | Certain (silence is data) | Nothing prompts the owner; they have to ask Claude or open the dashboard |

**What already works for the blind spot (no new code):** the owner pastes a bank statement or UPI SMS list into Claude and says "mark whatever these paid". Claude calls `list_invoices`, matches by amount and UTR, then calls `mark_paid` for each. It's manual, but it takes one sentence.

## 3. v2: make the loop close by itself (in priority order)

### P0: payment truth
1. **Razorpay payment links / UPI intent with a webhook.** The pay page's UPI button goes through Razorpay. The webhook marks the invoice paid with the exact amount, UTR and time. This removes the blind spot and both trust problems at once. It's also the **business model**: a take rate on money collected through Duely.
2. **"Claimed paid" status.** The client's *I've paid* moves the invoice to *claimed*, not *paid*. It becomes *paid* when the webhook confirms it, or when the owner confirms with one tap. Until then it doesn't count towards the north star.
3. **Partial payments.** Track balance due, keep the link live for the remainder, and keep the promise logic working on the balance.
4. **Bank reconciliation for off-link payments** (NEFT or a direct UPI to the owner's ID). Start with statement upload; later use India's Account Aggregator framework to read statements with the owner's consent, then auto-match on amount + UTR + client name and ask the owner to confirm fuzzy matches.

### P1: delivery truth and silence handling
5. **Track sends.** Route the WhatsApp/email buttons through a Duely redirect, so we log `nudge_sent` when the owner taps send, not just `nudge_saved`. This is a small build.
6. **WhatsApp Business API.** Duely sends the message Claude wrote, using owner-approved templates, and records *delivered* and *read* receipts as events. Silence becomes measurable ("read 3 days ago, no reply").
7. **Owner digest.** A daily WhatsApp or email to the owner: "3 invoices need you today", each with a one-tap link that opens Claude with the right prompt ready. Duely sends no AI-written text itself; it only points the owner back to their Claude. This closes the "client ignores everything" loop.
8. **Promise-day reminders to the client.** On the promised date, send a templated reminder ("you said you'd pay today") the owner approved in advance. If it's still unpaid the next day, it shows as broken in the digest.
9. **Escalation ladder per client.** Store each nudge's tone (friendly → firm → call → final notice) so Claude always knows the next step up. The tools already return nudge history; v2 makes the ladder explicit and editable.

### P2: getting invoices in, and trust
10. **Tally / Zoho Books sync** so open invoices arrive automatically. Until then, Claude imports from pasted lists, PDFs or screenshots (it calls `create_invoice` once per row).
11. **GST invoice PDF** generated from the record and attached to the pay page.
12. **OAuth for MCP** instead of a secret URL, plus self-serve signup and onboarding.
13. **Teams:** multiple seats per business, with an owner/accountant split.
14. **Per-account metrics** alongside the product-wide view.

### Later: the network
15. **Payer side.** A client who receives Duely links from several vendors gets one page listing everything they owe. Every pay page already carries the "Sent with Duely" footer, so the payer side is also the acquisition channel.

## 4. How the metrics change when the loop closes

| Metric | v1 source | v2 source |
| --- | --- | --- |
| North star (₹ collected through Duely within 30 days of due) | Paid invoices the client acted on or that got a nudge; partly self-reported | Webhook-confirmed payments: exact and auditable |
| Client response rate | Taps on the pay page | Plus WhatsApp read receipts and replies |
| Promise-kept rate | Paid date vs promise date | Same, with verified paid dates |
| Nudge effectiveness (new) | Not measurable | Payments within N days of a *sent* (not drafted) nudge, by tone |
| Time to cash | Due date to paid | Due date to confirmed payment, split by channel |

## 5. Principles that don't change

- **No AI inside Duely.** Claude writes and decides; Duely stores, sends, tracks and verifies. v2 features are plumbing (webhooks, receipts, schedules), never a model.
- **The owner sends or approves every message to a client.** Duely never chases on its own initiative.
- **Every change is an event with a source** (claude, web, client, system), so the timeline, Claude's context and the metrics all read from the same record.
