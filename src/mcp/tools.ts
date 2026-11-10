import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UserError } from '../lib/errors';
import { daysOverdue, formatDate, formatINR, isValidDate, todayIST, toPaise } from '../lib/format';
import { invoiceTimeline, logEvent, markMcpConnected } from '../services/events';
import {
  createInvoice, describeClientAction, getInvoice, getInvoiceByNumber, invoiceView, isOpen, listNudges,
  listWithActivity, markPaid, nudgeLinks, promiseBroken, saveNudge, Status, updateInvoice,
} from '../services/invoices';
import { receivablesSummary } from '../services/summary';
import type { User } from '../services/users';

// ---------- shared schemas ----------
const date = (what: string) =>
  z
    .string()
    .refine(isValidDate, { message: `${what} must be a real calendar date in YYYY-MM-DD format, e.g. 2026-10-20` })
    .describe(`${what} as YYYY-MM-DD`);
const rupees = (what: string) =>
  z.number().positive(`${what} must be greater than 0 (in rupees, e.g. 85000 for ₹85,000)`).max(1e10).describe(`${what} in rupees, e.g. 85000 for ₹85,000`);
const invoiceId = z.number().int().positive().describe('Duely invoice id (the numeric "id" from create_invoice or list_invoices)');
const lineItems = z
  .array(z.object({ description: z.string().min(1).max(300), amount: rupees('Line item amount') }))
  .max(50)
  .describe('Optional breakdown. Each item: description and amount in rupees.');

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (obj: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (msg: string): Result => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });

export function registerTools(server: McpServer, user: User) {
  /** Runs a tool body, records first-connection, and turns errors into messages Claude can act on. */
  const run = (name: string, body: () => Promise<Record<string, unknown>>) => async (): Promise<Result> => {
    try {
      const out = await body();
      await markMcpConnected(user.id, name);
      return json({ today: todayIST(), ...out });
    } catch (e) {
      if (e instanceof UserError) return fail(e.message);
      console.error(`Tool ${name} failed:`, (e as Error).message);
      return fail('Duely hit an internal error. Retry once; if it fails again, tell the user Duely is having trouble.');
    }
  };

  const lineItemsToPaise = (items?: { description: string; amount: number }[]) =>
    items?.map((li) => ({ description: li.description.trim(), amount_paise: toPaise(li.amount) }));

  // 1. create_invoice
  server.registerTool(
    'create_invoice',
    {
      title: 'Create invoice + pay link',
      description:
        'Record money a client owes the user and get a live public pay link (shows amount, days overdue and a UPI QR; the client can reply "I\'ve paid", "I\'ll pay by <date>" or raise an issue). ' +
        'Use when the user says someone owes them money, or asks to log/bill/track an invoice. ' +
        'Amount is in rupees. Resolve partial dates ("due 20 Oct") to YYYY-MM-DD using today (Asia/Kolkata); a due date in the past is fine and normal for overdue invoices. ' +
        'Include client_phone (WhatsApp number) if the user gave one, so the nudge link opens straight to the client. ' +
        'If the user might be describing an invoice already in Duely, call list_invoices first to avoid duplicates. ' +
        'After creating, if the user asked for a reminder, write one and call save_nudge.',
      inputSchema: {
        client_name: z.string().trim().min(1, 'client_name is required').max(200).describe('Client or company name, e.g. "Acme Studios"'),
        amount: rupees('Total amount owed'),
        due_date: date('Due date'),
        invoice_number: z.string().trim().min(1).max(50).optional().describe('The user\'s own invoice number, e.g. "INV-104". Omit to auto-number.'),
        client_phone: z.string().max(30).optional().describe('Client WhatsApp number, e.g. "+91 98765 43210"'),
        client_email: z.string().email('client_email must be a valid email address').optional(),
        issue_date: date('Issue date').optional(),
        line_items: lineItems.optional(),
        notes: z.string().max(2000).optional().describe('Internal context, e.g. "October retainer". Shown on the pay page.'),
      },
    },
    async (a) =>
      run('create_invoice', async () => {
        const inv = await createInvoice(
          user.id,
          {
            client_name: a.client_name,
            amount_paise: toPaise(a.amount),
            due_date: a.due_date,
            invoice_number: a.invoice_number,
            client_phone: a.client_phone,
            client_email: a.client_email,
            issue_date: a.issue_date,
            line_items: lineItemsToPaise(a.line_items),
            notes: a.notes,
          },
          'claude',
        );
        const v = invoiceView(inv);
        const hints = [
          `Invoice ${v.invoice_number} for ${v.amount_formatted} is live at pay_url.`,
          v.days_overdue > 0 ? `It is already ${v.days_overdue} day(s) overdue.` : `It is due ${formatDate(v.due_date)}.`,
          'If the user wants a reminder, write it yourself (tone matched to days overdue) and call save_nudge with this id.',
        ];
        if (!inv.client_phone) hints.push('No client WhatsApp number saved, so the WhatsApp link will ask who to send to. Ask the user if they want to add it (update_invoice).');
        return { invoice: v, next_step_hint: hints.join(' ') };
      })(),
  );

  // 2. list_invoices
  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'List the user\'s invoices with what Duely remembers about each: days overdue, status, promise date, whether a promise was broken, the client\'s last action on the pay link, and nudges sent. ' +
        'Use to find an invoice id, check for duplicates, or answer questions like "what\'s overdue?" or "has Acme paid?". ' +
        'By default returns everything except cancelled invoices, most overdue first. For a prioritised "what should I do today" view, use get_receivables_summary instead.',
      inputSchema: {
        status: z.enum(['draft', 'sent', 'viewed', 'promised', 'paid', 'disputed', 'cancelled']).optional().describe('Only invoices with this status'),
        overdue_only: z.boolean().optional().describe('Only unpaid invoices past their due date'),
        client_name: z.string().max(200).optional().describe('Case-insensitive substring match on client name'),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run('list_invoices', async () => {
        const today = todayIST();
        let rows = await listWithActivity(user.id);
        rows = a.status ? rows.filter((r) => r.status === a.status) : rows.filter((r) => r.status !== 'cancelled');
        if (a.overdue_only) rows = rows.filter((r) => isOpen(r.status) && daysOverdue(r.due_date, today) > 0);
        if (a.client_name) rows = rows.filter((r) => r.client_name.toLowerCase().includes(a.client_name!.toLowerCase()));
        const items = rows
          .map((r) => {
            const v = invoiceView(r, today);
            return {
              id: v.id,
              invoice_number: v.invoice_number,
              client_name: v.client_name,
              amount: v.amount,
              amount_formatted: v.amount_formatted,
              due_date: v.due_date,
              days_overdue: v.days_overdue,
              status: v.status,
              promise_date: v.promise_date,
              promise_broken: v.promise_broken,
              last_client_action: describeClientAction(r.lca_type, r.lca_meta),
              nudges_sent: r.nudge_count,
              pay_url: v.pay_url,
            };
          })
          .sort((x, y) => y.days_overdue - x.days_overdue || x.due_date.localeCompare(y.due_date));
        return {
          count: items.length,
          invoices: items,
          next_step_hint: items.length
            ? 'Use get_invoice for the full timeline of one invoice, or get_receivables_summary for a prioritised plan.'
            : 'No matching invoices. If the user mentions money owed, create one with create_invoice.',
        };
      })(),
  );

  // 3. get_invoice
  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice with history',
      description:
        'Full record of one invoice: all fields, the event timeline (created, edited, client viewed the link, promised a date, said they paid, raised an issue) and every past nudge with its tone and text. ' +
        'Read this before writing a follow-up nudge so you escalate from what was already said, never repeat it. Pass id or invoice_number.',
      inputSchema: {
        id: invoiceId.optional(),
        invoice_number: z.string().max(50).optional().describe('e.g. "INV-104"'),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run('get_invoice', async () => {
        if (!a.id && !a.invoice_number) throw new UserError('Pass either id or invoice_number.');
        const inv = a.id ? await getInvoice(user.id, a.id) : await getInvoiceByNumber(user.id, a.invoice_number!);
        if (!inv) throw new UserError(`No invoice found for ${a.id ? `id ${a.id}` : `number ${a.invoice_number}`}. Call list_invoices to see what exists.`);
        const [timeline, nudges] = await Promise.all([invoiceTimeline(inv.id), listNudges(inv.id)]);
        const v = invoiceView(inv);
        let hint = 'Use update_invoice to change fields, save_nudge to record a new reminder, mark_paid when money arrives.';
        if (inv.status === 'disputed') hint = 'Client has raised an issue (see timeline). Help the user resolve it before any payment reminder; set status back to "sent" with update_invoice once resolved.';
        else if (v.promise_broken) hint = `Client broke their promise to pay by ${formatDate(inv.promise_date)}. A firm, polite nudge referencing that promise is appropriate.`;
        else if (nudges.length) hint = `${nudges.length} nudge(s) already sent; the latest was "${nudges[0].tone}". If following up, escalate one step and don't repeat earlier wording.`;
        return {
          invoice: v,
          timeline: timeline.map((e) => ({ at: e.created_at, type: e.type, by: e.source, details: e.meta })),
          nudges: nudges.map((n) => ({ id: n.id, at: n.created_at, channel: n.channel, tone: n.tone, message: n.message })),
          next_step_hint: hint,
        };
      })(),
  );

  // 4. update_invoice
  server.registerTool(
    'update_invoice',
    {
      title: 'Update invoice',
      description:
        'Change fields on an existing invoice. Only the fields you pass are changed. ' +
        'Use for corrections ("make it ₹80,000", "due date is actually the 25th"), adding the client\'s phone/email, recording a promise the client made off-Duely (set promise_date; status becomes "promised"), ' +
        'marking a dispute resolved (status "sent") or cancelling (status "cancelled"). Passing line_items replaces the whole list. ' +
        'To record a payment, use mark_paid instead. Pass null to clear client_email, client_phone, notes or promise_date.',
      inputSchema: {
        id: invoiceId,
        client_name: z.string().trim().min(1).max(200).optional(),
        amount: rupees('New total amount').optional(),
        due_date: date('Due date').optional(),
        issue_date: date('Issue date').optional(),
        invoice_number: z.string().trim().min(1).max(50).optional(),
        client_phone: z.string().max(30).nullable().optional(),
        client_email: z.string().email('client_email must be a valid email address').nullable().optional(),
        line_items: lineItems.optional(),
        notes: z.string().max(2000).nullable().optional(),
        status: z.enum(['draft', 'sent', 'viewed', 'promised', 'disputed', 'cancelled']).optional().describe('Status override. Use mark_paid for payments.'),
        promise_date: date('Date the client promised to pay by').nullable().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async (a) =>
      run('update_invoice', async () => {
        const { id, amount, line_items, ...rest } = a;
        const patch = {
          ...rest,
          status: rest.status as Status | undefined,
          ...(amount !== undefined ? { amount_paise: toPaise(amount) } : {}),
          ...(line_items !== undefined ? { line_items: lineItemsToPaise(line_items) } : {}),
        };
        const { invoice, changes } = await updateInvoice(user.id, id, patch, 'claude');
        const changed = Object.keys(changes).map((k) => (k === 'amount_paise' ? 'amount' : k));
        return {
          invoice: invoiceView(invoice),
          changed_fields: changed,
          next_step_hint: changed.length
            ? `Updated ${changed.join(', ')}. The pay link already shows the new values; no need to resend unless the amount or due date changed.`
            : 'Nothing changed: the values passed match what is stored.',
        };
      })(),
  );

  // 5. save_nudge
  server.registerTool(
    'save_nudge',
    {
      title: 'Save payment reminder (you write it)',
      description:
        'Save a payment reminder YOU have written for an invoice and get one-tap links to send it (WhatsApp / email). Duely never writes or sends messages itself; the user taps the link to send from their own account. ' +
        'Writing rules: write the message yourself in the user\'s voice, addressed to the client. ' +
        'Escalate tone with the situation: not yet due or 1–7 days overdue = friendly; 8–30 days or second nudge = firm; 30+ days or a broken promise = final but courteous (reference the promise and ask for a specific date). ' +
        'If the client raised an issue (status "disputed"), address the issue instead of asking for payment. ' +
        'Always polite, never threatening: no legal threats, penalties or public shaming. ' +
        'Always include the amount and the invoice number. Duely appends the pay link automatically unless your message already contains it. ' +
        'WhatsApp: 80 words or fewer, plain text, no markdown. Email: may be longer; first line is not a subject. ' +
        'Check get_invoice first if earlier nudges exist, so you escalate rather than repeat.',
      inputSchema: {
        invoice_id: invoiceId,
        channel: z.enum(['whatsapp', 'email']).describe('Where the user will send it'),
        tone: z.string().trim().min(1).max(40).describe('One or two words, e.g. "friendly", "firm", "final", "issue follow-up"'),
        message: z.string().trim().min(10, 'message is too short; write the full reminder text').max(4000).describe('The full reminder text you wrote, ready to send'),
      },
    },
    async (a) =>
      run('save_nudge', async () => {
        const { nudge, invoice } = await saveNudge(user.id, a.invoice_id, a, 'claude');
        const links = nudgeLinks(invoice, nudge.message);
        const words = nudge.message.split(/\s+/).filter(Boolean).length;
        const warnings: string[] = [];
        if (a.channel === 'whatsapp' && words > 80) warnings.push(`Message is ${words} words; WhatsApp nudges should be 80 or fewer. Consider a shorter version.`);
        if (!mentionsAmount(nudge.message, invoice.amount_paise)) warnings.push('Message does not seem to state the amount; consider including it.');
        if (a.channel === 'whatsapp' && !invoice.client_phone) warnings.push('No client phone on file: the WhatsApp link will ask the user to pick a contact.');
        if (a.channel === 'email' && !invoice.client_email) warnings.push('No client email on file: the email link opens with an empty "To".');
        return {
          nudge: { id: nudge.id, channel: nudge.channel, tone: nudge.tone, saved_at: nudge.created_at },
          invoice: { id: invoice.id, invoice_number: invoice.invoice_number, client_name: invoice.client_name, amount_formatted: formatINR(invoice.amount_paise), status: invoice.status, promise_broken: promiseBroken(invoice) },
          whatsapp_url: links.whatsapp_url,
          mailto_url: links.mailto_url,
          text_as_sent: links.final_text,
          warnings,
          next_step_hint: `Show the user the ${a.channel === 'whatsapp' ? 'whatsapp_url' : 'mailto_url'} as a clickable link; tapping it opens a ready-to-send message from their own account. Duely has logged this nudge in the invoice history.`,
        };
      })(),
  );

  // 6. mark_paid
  server.registerTool(
    'mark_paid',
    {
      title: 'Mark invoice paid',
      description:
        'Record that the user received payment for an invoice. Use when the user confirms money arrived (e.g. "Acme paid, UTR 4521..."). ' +
        'amount defaults to the full invoice amount; pass it if they paid a different amount. reference is the UTR / transaction id / cheque number, if known. ' +
        'Only call this when the user confirms receipt; a client saying "I\'ve paid" on the pay link is a claim the user should check first.',
      inputSchema: {
        id: invoiceId,
        amount: rupees('Amount received').optional(),
        reference: z.string().trim().max(100).optional().describe('UTR, transaction id or cheque number'),
      },
    },
    async (a) =>
      run('mark_paid', async () => {
        const inv = await markPaid(user.id, a.id, { amount_paise: a.amount !== undefined ? toPaise(a.amount) : undefined, reference: a.reference }, 'claude');
        const short = inv.amount_paise - (inv.paid_amount_paise ?? 0);
        return {
          invoice: invoiceView(inv),
          short_by: short > 0 ? formatINR(short) : null,
          next_step_hint:
            short > 0
              ? `Recorded a part payment; ${formatINR(short)} is still short. If the balance is still owed, suggest creating a new invoice for it.`
              : `Marked paid. Offer to draft a short thank-you note to ${inv.client_name} if the user wants one.`,
        };
      })(),
  );

  // 7. get_receivables_summary
  server.registerTool(
    'get_receivables_summary',
    {
      title: 'Receivables summary + priority list',
      description:
        'The user\'s collections briefing: total outstanding, total overdue, collected this month, aging buckets (not due, 1–15, 16–30, 31–60, 60+ days), promises due this week, broken promises, open disputes, ' +
        'and a priority list already sorted by fixed rules (broken promise > dispute > days overdue × amount), each with a suggested_action based on Duely\'s history. ' +
        'Call this when the user asks who owes them money, what to do today, how collections are going, or whom to chase. ' +
        'Present the priority list in order in plain language, use your judgement on wording, and offer to draft nudges (save_nudge) for the top items.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      run('get_receivables_summary', async () => {
        const s = await receivablesSummary(user.id);
        await logEvent(user.id, null, 'summary_requested', 'claude', { priority_count: s.priority.length });
        const top = s.priority[0];
        return {
          ...s,
          next_step_hint: top
            ? `Lead with ${top.client_name} (${top.formatted}): ${top.suggested_action} Then offer to draft nudges for the top items.`
            : s.totals.outstanding.count
              ? 'Nothing is overdue. Mention upcoming due dates and promises this week.'
              : 'No open invoices. Ask the user if anyone owes them money and offer to create an invoice.',
        };
      })(),
  );
}

/** Loose check that the amount (e.g. 85,000 / 85000 / 85k) appears in the message. */
function mentionsAmount(msg: string, paise: number): boolean {
  const rupees = Math.round(paise / 100);
  const plain = msg.replace(/[,\s]/g, '');
  return plain.includes(String(rupees)) || /₹|rs\.?|inr/i.test(msg);
}
