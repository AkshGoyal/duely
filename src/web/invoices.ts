import { Router } from 'express';
import { UserError } from '../lib/errors';
import { daysOverdue, formatDate, formatINR, todayIST, toPaise, toRupees } from '../lib/format';
import { payUrl } from '../lib/tokens';
import { invoiceTimeline } from '../services/events';
import {
  createInvoice, getInvoice, isOpen, listNudges, markPaid, nudgeLinks, promiseBroken, updateInvoice,
} from '../services/invoices';
import { requireAuth, setFlash, takeFlash } from './auth';
import { html } from './html';
import { invoiceFormFields, parseInvoiceForm } from './invoiceForm';
import { icon } from './icons';
import { appPage } from './layout';
import { btnPrimary, btnSecondary, describeEvent, EVENT_DOT, formatDateTime, inputCls, labelCls, sourceBadge, statusBadge } from './ui';

export const invoicesRouter = Router();
invoicesRouter.use('/invoices', requireAuth);

const FIELD_NAMES: Record<string, string> = { amount_paise: 'amount', line_items: 'line items' };
const niceFields = (keys: string[]) => keys.map((k) => FIELD_NAMES[k] ?? k.replace(/_/g, ' ')).join(', ');

// ---------- new ----------
invoicesRouter.get('/invoices/new', (req, res) => {
  const body = html`
    <div class="max-w-3xl">
      <a href="/" class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">${icon('arrowLeft')} Invoices</a>
      <h1 class="text-2xl font-semibold tracking-tight mt-2">New invoice</h1>
      <p class="text-sm text-slate-500 mt-1">Usually Claude creates these for you. This form works the same without it.</p>
      <form method="post" action="/invoices" class="mt-6 bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-6">
        ${invoiceFormFields({ status: 'sent', issue_date: todayIST() }, 'new')}
        <div class="mt-6 flex gap-3"><button class="${btnPrimary}" type="submit" data-loading="Creating…">Create invoice</button><a href="/" class="${btnSecondary}">Cancel</a></div>
      </form>
    </div>`;
  res.send(String(appPage({ title: 'New invoice', active: 'new', business: req.user!.business_name, flash: takeFlash(req), body })));
});

invoicesRouter.post('/invoices', async (req, res) => {
  const { data, error } = parseInvoiceForm(req.body ?? {}, 'new');
  if (error || !data) {
    setFlash(req, { type: 'error', msg: error ?? 'Invalid form' });
    return res.redirect('/invoices/new');
  }
  try {
    const inv = await createInvoice(req.user!.id, data as Parameters<typeof createInvoice>[1], 'web');
    setFlash(req, { type: 'ok', msg: `Invoice ${inv.invoice_number} created. Its pay link is live.` });
    res.redirect(`/invoices/${inv.id}`);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    setFlash(req, { type: 'error', msg: e.message.replace(/ Use update_invoice.*$/, '') });
    res.redirect('/invoices/new');
  }
});

// ---------- edit / view ----------
const idParam = (raw: unknown) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

invoicesRouter.get('/invoices/:id', async (req, res, next) => {
  const user = req.user!;
  const inv = await getInvoice(user.id, idParam(req.params.id));
  if (!inv) return next(); // 404 handler
  const [timeline, nudges] = await Promise.all([invoiceTimeline(inv.id), listNudges(inv.id)]);
  const today = todayIST();
  const od = isOpen(inv.status) ? daysOverdue(inv.due_date, today) : 0;
  const broken = promiseBroken(inv, today);
  const link = payUrl(inv.pay_token);

  const body = html`
    <a href="/" class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">${icon('arrowLeft')} Invoices</a>
    <div class="mt-2 mb-6 flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">${inv.client_name}</h1>
      <span class="text-slate-400">${inv.invoice_number}</span>
      ${statusBadge(inv.status)} ${sourceBadge(inv.source)}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <form method="post" action="/invoices/${inv.id}" class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-6">
          <h2 class="text-sm font-semibold mb-4">Invoice details</h2>
          ${invoiceFormFields(inv, 'edit')}
          <div class="mt-6"><button class="${btnPrimary}" type="submit" data-loading="Saving…">Save changes</button></div>
        </form>

        <section class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-6">
          <h2 class="text-sm font-semibold mb-4">Nudges <span class="text-slate-400 font-normal">· ${nudges.length}</span></h2>
          ${nudges.length
            ? html`<ul class="space-y-4">${nudges.map((n) => {
                const l = nudgeLinks(inv, n.message);
                return html`<li class="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
                    <span class="font-medium text-slate-700">${n.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                    <span>· ${n.tone}</span><span>· ${formatDateTime(n.created_at)}</span>
                  </div>
                  <p class="text-sm whitespace-pre-line text-slate-800">${n.message}</p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <a href="${l.whatsapp_url}" target="_blank" rel="noopener" class="${btnSecondary}">${icon('message')} Send on WhatsApp</a>
                    <a href="${l.mailto_url}" class="${btnSecondary}">${icon('mail')} Send by email</a>
                  </div>
                </li>`;
              })}</ul>`
            : html`<p class="text-sm text-slate-500 rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center">No nudges yet. Ask your Claude: “Draft a friendly WhatsApp reminder for ${inv.invoice_number}.”</p>`}
        </section>
      </div>

      <aside class="space-y-6">
        <section class="bg-white rounded-2xl border border-slate-200 shadow-card p-5">
          <p class="text-xs text-slate-500">Amount</p>
          <p class="text-3xl font-semibold num">${formatINR(inv.amount_paise)}</p>
          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-slate-500">Due</dt><dd>${formatDate(inv.due_date)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">Days overdue</dt><dd class="num ${od > 0 ? 'text-red-600 font-medium' : ''}">${od > 0 ? od : '—'}</dd></div>
            ${inv.promise_date
              ? html`<div class="flex justify-between"><dt class="text-slate-500">Promised by</dt><dd class="${broken ? 'text-red-600 font-medium' : ''}">${formatDate(inv.promise_date)}${broken ? ' · broken' : ''}</dd></div>`
              : ''}
            ${inv.status === 'paid'
              ? html`<div class="flex justify-between"><dt class="text-slate-500">Paid</dt><dd class="text-brand-700 font-medium num">${formatINR(inv.paid_amount_paise ?? inv.amount_paise)}</dd></div>
                ${inv.paid_reference ? html`<div class="flex justify-between"><dt class="text-slate-500">Reference</dt><dd class="font-mono text-xs">${inv.paid_reference}</dd></div>` : ''}`
              : ''}
          </dl>
        </section>

        <section class="bg-white rounded-2xl border border-slate-200 shadow-card p-5">
          <h2 class="text-sm font-semibold mb-2">Pay link</h2>
          <p class="text-xs text-slate-500 mb-3">Public page with UPI QR. Your client needs no login.</p>
          <div class="flex gap-2">
            <input readonly aria-label="Pay link" class="${inputCls} text-xs font-mono" value="${link}" onclick="this.select()" />
            <button type="button" class="${btnSecondary} shrink-0" data-copy="${link}" aria-label="Copy pay link">${icon('copy')}<span data-label>Copy</span></button>
          </div>
          <a href="${link}" target="_blank" rel="noopener" class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">Open pay page ${icon('external', 'h-3.5 w-3.5')}</a>
        </section>

        ${inv.status !== 'paid' && inv.status !== 'cancelled'
          ? html`<form method="post" action="/invoices/${inv.id}/paid" data-confirm="Mark this invoice as paid?" class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 space-y-3">
              <h2 class="text-sm font-semibold">Mark paid</h2>
              <div><label class="${labelCls}" for="paid_amount">Amount received (₹)</label>
                <input class="${inputCls} num" id="paid_amount" name="amount" type="number" step="0.01" min="0.01" value="${toRupees(inv.amount_paise)}" required /></div>
              <div><label class="${labelCls}" for="paid_ref">UTR / reference</label>
                <input class="${inputCls}" id="paid_ref" name="reference" maxlength="100" placeholder="Optional" /></div>
              <button class="${btnPrimary} w-full" type="submit" data-loading="Saving…">${icon('check')} Mark as paid</button>
            </form>`
          : ''}

        <section class="bg-white rounded-2xl border border-slate-200 shadow-card p-5">
          <h2 class="text-sm font-semibold mb-4">Timeline</h2>
          <ol class="relative border-l border-slate-200 ml-1.5 space-y-4">
            ${[...timeline].reverse().map(
              (e) => html`<li class="ml-4">
                <span class="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${EVENT_DOT[e.type] ?? 'bg-slate-300'}"></span>
                <p class="text-sm text-slate-800">${describeEvent(e)}</p>
                <p class="text-xs text-slate-400">${formatDateTime(e.created_at)}</p>
              </li>`,
            )}
          </ol>
        </section>
      </aside>
    </div>`;

  res.send(String(appPage({ title: `${inv.invoice_number} · ${inv.client_name}`, business: user.business_name, flash: takeFlash(req), body })));
});

invoicesRouter.post('/invoices/:id', async (req, res, next) => {
  const user = req.user!;
  const cur = await getInvoice(user.id, idParam(req.params.id));
  if (!cur) return next();
  const { data, error } = parseInvoiceForm(req.body ?? {}, 'edit');
  if (error || !data) {
    setFlash(req, { type: 'error', msg: error ?? 'Invalid form' });
    return res.redirect(`/invoices/${cur.id}`);
  }
  // The form always posts a status. If only the promise date changed, let the service move it to "promised".
  if (data.status === cur.status && data.promise_date && data.promise_date !== cur.promise_date) delete data.status;
  try {
    const { changes } = await updateInvoice(user.id, cur.id, data, 'web');
    const keys = Object.keys(changes);
    setFlash(req, keys.length ? { type: 'ok', msg: `Saved: ${niceFields(keys)}.` } : { type: 'ok', msg: 'No changes to save.' });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    setFlash(req, { type: 'error', msg: e.message.replace(/ Use update_invoice.*$/, '') });
  }
  res.redirect(`/invoices/${cur.id}`);
});

invoicesRouter.post('/invoices/:id/paid', async (req, res, next) => {
  const user = req.user!;
  const cur = await getInvoice(user.id, idParam(req.params.id));
  if (!cur) return next();
  const amount = Number(String(req.body?.amount ?? '').replace(/,/g, ''));
  try {
    const inv = await markPaid(
      user.id,
      cur.id,
      { amount_paise: Number.isFinite(amount) && amount > 0 ? toPaise(amount) : undefined, reference: String(req.body?.reference ?? '') },
      'web',
    );
    setFlash(req, { type: 'ok', msg: `Marked paid: ${formatINR(inv.paid_amount_paise ?? inv.amount_paise)}.` });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    setFlash(req, { type: 'error', msg: e.message });
  }
  res.redirect(`/invoices/${cur.id}`);
});

