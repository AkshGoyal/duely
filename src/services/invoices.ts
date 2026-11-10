import { one, query } from '../db';
import { UserError } from '../lib/errors';
import { daysOverdue, formatDate, formatINR, phoneDigits, todayIST, toRupees } from '../lib/format';
import { editUrl, newPayToken, payUrl } from '../lib/tokens';
import { logEvent, Source } from './events';

export const STATUSES = ['draft', 'sent', 'viewed', 'promised', 'paid', 'disputed', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ['sent', 'viewed', 'promised', 'disputed'];

export interface LineItem {
  description: string;
  amount_paise: number;
}

export interface Invoice {
  id: number;
  user_id: number;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  amount_paise: number;
  currency: string;
  issue_date: string;
  due_date: string;
  line_items: LineItem[];
  notes: string | null;
  status: Status;
  promise_date: string | null;
  paid_amount_paise: number | null;
  paid_reference: string | null;
  paid_at: Date | null;
  pay_token: string;
  source: 'claude' | 'web';
  created_at: Date;
  updated_at: Date;
}

/** Invoice plus derived memory: latest client action and nudge history. */
export interface InvoiceWithActivity extends Invoice {
  lca_type: string | null;
  lca_meta: Record<string, any> | null;
  lca_at: Date | null;
  last_nudge_at: Date | null;
  last_nudge_tone: string | null;
  last_nudge_channel: string | null;
  nudge_count: number;
}

export interface InvoiceInput {
  client_name?: string;
  client_email?: string | null;
  client_phone?: string | null;
  amount_paise?: number;
  issue_date?: string;
  due_date?: string;
  invoice_number?: string;
  line_items?: LineItem[];
  notes?: string | null;
  status?: Status;
  promise_date?: string | null;
}

export const isOpen = (s: Status) => OPEN_STATUSES.includes(s);

export function promiseBroken(inv: Pick<Invoice, 'promise_date' | 'status'>, today = todayIST()): boolean {
  return !!inv.promise_date && inv.promise_date < today && isOpen(inv.status);
}

export function describeClientAction(type: string | null, meta: Record<string, any> | null): string | null {
  if (!type) return null;
  const m = meta || {};
  switch (type) {
    case 'page_viewed':
      return 'Opened the pay link';
    case 'promise_made':
      return `Promised to pay by ${formatDate(m.promise_date)}`;
    case 'marked_paid':
      return `Said they paid${m.reference ? ` (ref ${m.reference})` : ''}`;
    case 'issue_raised':
      return `Raised an issue: "${m.message ?? ''}"`;
    default:
      return type;
  }
}

const ACTIVITY_SELECT = `
  SELECT i.*,
         lca.type AS lca_type, lca.meta AS lca_meta, lca.created_at AS lca_at,
         ln.created_at AS last_nudge_at, ln.tone AS last_nudge_tone, ln.channel AS last_nudge_channel,
         (SELECT count(*) FROM nudges n2 WHERE n2.invoice_id = i.id)::int AS nudge_count
  FROM invoices i
  LEFT JOIN LATERAL (
    SELECT type, meta, created_at FROM events e
    WHERE e.invoice_id = i.id AND e.source = 'client'
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1
  ) lca ON true
  LEFT JOIN LATERAL (
    SELECT created_at, tone, channel FROM nudges n
    WHERE n.invoice_id = i.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1
  ) ln ON true
  WHERE i.user_id = $1`;

export async function listWithActivity(userId: number): Promise<InvoiceWithActivity[]> {
  return query<InvoiceWithActivity>(`${ACTIVITY_SELECT} ORDER BY i.due_date ASC, i.id ASC`, [userId]);
}

export async function getInvoice(userId: number, id: number): Promise<Invoice | undefined> {
  return one<Invoice>('SELECT * FROM invoices WHERE user_id = $1 AND id = $2', [userId, id]);
}

export async function getInvoiceByNumber(userId: number, num: string): Promise<Invoice | undefined> {
  return one<Invoice>('SELECT * FROM invoices WHERE user_id = $1 AND lower(invoice_number) = lower($2)', [
    userId,
    num.trim(),
  ]);
}

export async function getInvoiceByPayToken(token: string): Promise<Invoice | undefined> {
  return one<Invoice>('SELECT * FROM invoices WHERE pay_token = $1', [token]);
}

export async function requireInvoice(userId: number, id: number): Promise<Invoice> {
  const inv = await getInvoice(userId, id);
  if (!inv) throw new UserError(`No invoice with id ${id}. Call list_invoices to see valid ids.`);
  return inv;
}

async function nextInvoiceNumber(userId: number): Promise<string> {
  const rows = await query<{ invoice_number: string }>('SELECT invoice_number FROM invoices WHERE user_id = $1', [userId]);
  const taken = new Set(rows.map((r) => r.invoice_number.toLowerCase()));
  let n = rows.length + 1;
  while (taken.has(`inv-${String(n).padStart(3, '0')}`)) n++;
  return `INV-${String(n).padStart(3, '0')}`;
}

async function assertNumberFree(userId: number, num: string, exceptId?: number) {
  const clash = await getInvoiceByNumber(userId, num);
  if (clash && clash.id !== exceptId) {
    throw new UserError(
      `Invoice number ${num} already exists (id ${clash.id}, ${clash.client_name}). ` +
        'Use update_invoice on that id, or choose a different invoice_number.',
    );
  }
}

export async function createInvoice(
  userId: number,
  input: InvoiceInput & { client_name: string; amount_paise: number; due_date: string },
  source: 'claude' | 'web',
): Promise<Invoice> {
  const num = input.invoice_number?.trim() || (await nextInvoiceNumber(userId));
  await assertNumberFree(userId, num);
  const inv = await one<Invoice>(
    `INSERT INTO invoices (user_id, invoice_number, client_name, client_email, client_phone, amount_paise,
       issue_date, due_date, line_items, notes, status, pay_token, source)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, LEAST((now() AT TIME ZONE 'Asia/Kolkata')::date, $8::date)),$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      userId,
      num,
      input.client_name.trim(),
      input.client_email || null,
      input.client_phone || null,
      input.amount_paise,
      input.issue_date || null,
      input.due_date,
      JSON.stringify(input.line_items || []),
      input.notes || null,
      input.status || 'sent',
      newPayToken(),
      source,
    ],
  );
  await logEvent(userId, inv!.id, 'invoice_created', source, {
    invoice_number: num,
    amount_paise: input.amount_paise,
  });
  return inv!;
}

const EDITABLE: (keyof InvoiceInput)[] = [
  'client_name', 'client_email', 'client_phone', 'amount_paise', 'issue_date', 'due_date',
  'invoice_number', 'line_items', 'notes', 'status', 'promise_date',
];

export async function updateInvoice(
  userId: number,
  id: number,
  patch: InvoiceInput,
  source: Source,
): Promise<{ invoice: Invoice; changes: Record<string, { from: unknown; to: unknown }> }> {
  const cur = await requireInvoice(userId, id);
  const next: InvoiceInput = { ...patch };

  // Recording a promise moves an open invoice to "promised" unless a status was given explicitly.
  if (next.promise_date && next.promise_date !== cur.promise_date && !next.status && ['sent', 'viewed', 'draft'].includes(cur.status)) {
    next.status = 'promised';
  }
  if (next.invoice_number) await assertNumberFree(userId, next.invoice_number.trim(), id);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of EDITABLE) {
    if (!(key in next) || next[key] === undefined) continue;
    let to: unknown = next[key];
    if (typeof to === 'string') to = to.trim() === '' && key !== 'client_name' ? null : to.trim();
    const from = (cur as any)[key];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changes[key] = { from: from ?? null, to: to ?? null };
    vals.push(key === 'line_items' ? JSON.stringify(to) : to);
    sets.push(`${key} = $${vals.length + 2}`);
  }
  if (!sets.length) return { invoice: cur, changes };

  // Reopening a paid invoice clears its payment record.
  if (changes.status && cur.status === 'paid' && changes.status.to !== 'paid') {
    sets.push('paid_amount_paise = NULL', 'paid_reference = NULL', 'paid_at = NULL');
  }
  if (changes.status?.to === 'paid' && !cur.paid_at) {
    sets.push('paid_at = now()', 'paid_amount_paise = COALESCE(paid_amount_paise, amount_paise)');
  }

  const inv = await one<Invoice>(
    `UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id, ...vals],
  );
  await logEvent(userId, id, 'invoice_edited', source, { changes });
  if (changes.promise_date?.to) {
    await logEvent(userId, id, 'promise_made', source, { promise_date: changes.promise_date.to });
  }
  if (changes.status?.to === 'paid') {
    await logEvent(userId, id, 'marked_paid', source, { amount_paise: inv!.paid_amount_paise });
  }
  return { invoice: inv!, changes };
}

export async function markPaid(
  userId: number,
  id: number,
  opts: { amount_paise?: number; reference?: string },
  source: Source,
): Promise<Invoice> {
  const cur = await requireInvoice(userId, id);
  if (cur.status === 'cancelled') throw new UserError(`Invoice ${cur.invoice_number} is cancelled. Reopen it with update_invoice first.`);
  const amount = opts.amount_paise ?? cur.amount_paise;
  const inv = await one<Invoice>(
    // Keep the original payment time when correcting an already-paid invoice (metrics depend on it).
    `UPDATE invoices SET status = 'paid', paid_amount_paise = $3, paid_reference = $4,
       paid_at = COALESCE(paid_at, now()), updated_at = now()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id, amount, opts.reference?.trim() || cur.paid_reference || null],
  );
  await logEvent(userId, id, 'marked_paid', source, { amount_paise: amount, reference: opts.reference || null });
  return inv!;
}

export interface Nudge {
  id: number;
  invoice_id: number;
  channel: 'whatsapp' | 'email';
  tone: string;
  message: string;
  created_at: Date;
}

export const listNudges = (invoiceId: number) =>
  query<Nudge>('SELECT * FROM nudges WHERE invoice_id = $1 ORDER BY created_at DESC, id DESC', [invoiceId]);

export async function saveNudge(
  userId: number,
  invoiceId: number,
  n: { channel: 'whatsapp' | 'email'; tone: string; message: string },
  source: Source,
): Promise<{ nudge: Nudge; invoice: Invoice }> {
  const invoice = await requireInvoice(userId, invoiceId);
  const nudge = await one<Nudge>(
    'INSERT INTO nudges (invoice_id, channel, tone, message) VALUES ($1, $2, $3, $4) RETURNING *',
    [invoiceId, n.channel, n.tone.trim(), n.message.trim()],
  );
  await logEvent(userId, invoiceId, 'nudge_saved', source, { nudge_id: nudge!.id, channel: n.channel, tone: n.tone });
  return { nudge: nudge!, invoice };
}

/** Ready-to-tap links. The pay link is appended unless the message already contains it. */
export function nudgeLinks(inv: Invoice, message: string) {
  const link = payUrl(inv.pay_token);
  const text = message.includes(link) ? message : `${message.trim()}\n\nPay here: ${link}`;
  const digits = phoneDigits(inv.client_phone);
  const subject = `Payment reminder: ${inv.invoice_number} (${formatINR(inv.amount_paise)})`;
  return {
    whatsapp_url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
    mailto_url: `mailto:${inv.client_email ? encodeURIComponent(inv.client_email) : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
    final_text: text,
  };
}

/** Compact, Claude-friendly view of an invoice with computed memory fields. */
export function invoiceView(inv: Invoice, today = todayIST()) {
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    client_name: inv.client_name,
    client_phone: inv.client_phone,
    client_email: inv.client_email,
    amount: toRupees(inv.amount_paise),
    amount_formatted: formatINR(inv.amount_paise),
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    days_overdue: isOpen(inv.status) ? daysOverdue(inv.due_date, today) : 0,
    status: inv.status,
    promise_date: inv.promise_date,
    promise_broken: promiseBroken(inv, today),
    paid_amount: inv.paid_amount_paise != null ? toRupees(inv.paid_amount_paise) : null,
    paid_reference: inv.paid_reference,
    paid_at: inv.paid_at,
    line_items: (inv.line_items || []).map((li) => ({ description: li.description, amount: toRupees(li.amount_paise) })),
    notes: inv.notes,
    source: inv.source,
    pay_url: payUrl(inv.pay_token),
    edit_url: editUrl(inv.id),
  };
}

// ---------- client actions from the public pay page ----------

/** Logs the first client view only and moves sent -> viewed. Returns true if this was the first view. */
export async function recordPageView(inv: Invoice): Promise<boolean> {
  const rows = await query(
    `INSERT INTO events (user_id, invoice_id, type, source)
     SELECT $1, $2, 'page_viewed', 'client'
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE invoice_id = $2 AND type = 'page_viewed')
     RETURNING id`,
    [inv.user_id, inv.id],
  );
  if (!rows.length) return false;
  await query(`UPDATE invoices SET status = 'viewed', updated_at = now() WHERE id = $1 AND status = 'sent'`, [inv.id]);
  return true;
}

export async function recordClientPromise(inv: Invoice, promiseDate: string): Promise<void> {
  await query(
    `UPDATE invoices SET promise_date = $2, status = 'promised', updated_at = now() WHERE id = $1`,
    [inv.id, promiseDate],
  );
  await logEvent(inv.user_id, inv.id, 'promise_made', 'client', { promise_date: promiseDate });
}

export async function recordClientIssue(inv: Invoice, message: string): Promise<void> {
  await query(`UPDATE invoices SET status = 'disputed', updated_at = now() WHERE id = $1`, [inv.id]);
  await logEvent(inv.user_id, inv.id, 'issue_raised', 'client', { message });
}
