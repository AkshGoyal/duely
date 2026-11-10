import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { addDays, daysBetween, daysOverdue, formatDate, formatINR, isValidDate, todayIST, toRupees } from '../lib/format';
import { rateLimit } from '../lib/rateLimit';
import {
  getInvoiceByPayToken, Invoice, isOpen, markPaid, recordClientIssue, recordClientPromise, recordPageView,
} from '../services/invoices';
import { findUserById, User } from '../services/users';
import { html, Raw } from './html';
import { icon, logoMark } from './icons';
import { barePage } from './layout';

export const payRouter = Router();

const MAX_PROMISE_DAYS = 90;

function upiLink(user: User, inv: Invoice): string {
  const p = new URLSearchParams({
    pa: user.upi_id!,
    pn: user.business_name,
    am: toRupees(inv.amount_paise).toFixed(2),
    cu: 'INR',
    tn: inv.invoice_number,
  });
  // UPI apps expect %20 rather than '+' for spaces.
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

function shell(title: string, content: Raw) {
  return barePage({
    title,
    bg: 'bg-slate-100',
    body: html`
    <main class="min-h-screen flex flex-col items-center px-4 py-6 sm:py-12">
      <div class="w-full max-w-md">${content}</div>
      <footer class="mt-8 text-center text-xs text-slate-500">
        <a href="/login" class="inline-flex items-center gap-2 rounded-full px-3 py-2 hover:bg-white hover:text-slate-800 transition-colors">${logoMark('h-5 w-5')} Sent with <span class="font-semibold text-slate-700">Duely</span> — get paid on time</a>
      </footer>
    </main>`,
  });
}

function notFound(res: Response) {
  res.status(404).send(
    String(
      shell(
        'Link not found',
        html`<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <p class="text-lg font-semibold">This payment link isn't valid</p>
          <p class="mt-2 text-sm text-slate-500">Check the link you were sent, or ask the sender for a new one.</p>
        </div>`,
      ),
    ),
  );
}

const CONFIRM: Record<string, (inv: Invoice, biz: string) => Raw> = {
  paid: (inv, biz) => html`<p class="font-semibold">Thanks! ${biz} has been told you've paid.</p>
    ${inv.paid_reference ? html`<p class="text-sm mt-1">Reference: <span class="font-mono">${inv.paid_reference}</span></p>` : ''}`,
  promise: (inv, biz) => html`<p class="font-semibold">Got it. ${biz} knows you'll pay by ${formatDate(inv.promise_date)}.</p>
    <p class="text-sm mt-1">You can pay any time before then using the options below.</p>`,
  issue: (_inv, biz) => html`<p class="font-semibold">Thanks for flagging it.</p><p class="text-sm mt-1">${biz} will get back to you.</p>`,
};

payRouter.get('/pay/:token', async (req: Request, res: Response) => {
  const inv = await getInvoiceByPayToken(String(req.params.token));
  if (!inv) return notFound(res);
  const owner = await findUserById(inv.user_id);
  if (!owner) return notFound(res);

  // The owner previewing their own link must not count as the client viewing it.
  const isOwner = Number(req.session?.userId) === inv.user_id;
  if (!isOwner && (await recordPageView(inv)) && inv.status === 'sent') inv.status = 'viewed';

  const today = todayIST();
  const od = isOpen(inv.status) ? daysOverdue(inv.due_date, today) : 0;
  const dueIn = daysBetween(today, inv.due_date);
  const biz = owner.business_name;
  const done = typeof req.query.done === 'string' ? CONFIRM[req.query.done] : undefined;
  const payable = inv.status !== 'paid' && inv.status !== 'cancelled';
  const upi = payable && owner.upi_id ? upiLink(owner, inv) : null;
  const qr = upi ? await QRCode.toDataURL(upi, { margin: 1, width: 240, errorCorrectionLevel: 'M' }) : null;
  const self = `/pay/${encodeURIComponent(String(req.params.token))}`;

  const dueLine =
    inv.status === 'paid'
      ? html`<span class="text-brand-700 font-medium">Paid${inv.paid_at ? ` on ${formatDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(inv.paid_at))}` : ''}</span>`
      : od > 0
        ? html`Was due ${formatDate(inv.due_date)} · <span class="text-red-600 font-medium">${od} day${od === 1 ? '' : 's'} overdue</span>`
        : dueIn === 0
          ? html`<span class="text-amber-700 font-medium">Due today</span>`
          : html`Due ${formatDate(inv.due_date)} · in ${dueIn} day${dueIn === 1 ? '' : 's'}`;

  const content = html`
    ${isOwner ? html`<div class="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">You're viewing your own pay link. Your visit isn't recorded as a client view.</div>` : ''}
    ${done ? html`<div class="mb-4 flex gap-3 rounded-2xl bg-brand-600 text-white p-5 shadow-sm" role="status">${icon('checkCircle', 'h-6 w-6 shrink-0')}<div>${done(inv, biz)}</div></div>` : ''}

    <div class="bg-white rounded-3xl shadow-card border border-slate-200 overflow-hidden">
      <div class="p-6 border-b border-slate-100">
        <div class="flex items-center gap-3">
          <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white" aria-hidden="true">${biz.trim().slice(0, 1).toUpperCase()}</span>
          <div class="min-w-0">
            <p class="font-semibold text-slate-900 truncate">${biz}</p>
            <p class="text-xs text-slate-500">Invoice ${inv.invoice_number} · for ${inv.client_name}</p>
          </div>
        </div>
        <p class="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Amount due</p>
        <p class="mt-1 text-4xl font-bold tracking-tight num text-slate-900">${formatINR(inv.amount_paise)}</p>
        <p class="mt-2 text-sm text-slate-600">${dueLine}</p>
        ${inv.status === 'promised' && inv.promise_date && !done
          ? html`<p class="mt-2 text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2">You said you'd pay by ${formatDate(inv.promise_date)}.</p>`
          : ''}
        ${inv.status === 'disputed' && !done
          ? html`<p class="mt-2 text-sm text-red-800 bg-red-50 rounded-md px-3 py-2">You raised an issue on this invoice. ${biz} will get back to you.</p>`
          : ''}
        ${inv.status === 'cancelled' ? html`<p class="mt-2 text-sm text-slate-600 bg-slate-100 rounded-md px-3 py-2">This invoice has been cancelled. Nothing to pay.</p>` : ''}
      </div>

      ${inv.line_items?.length || inv.notes
        ? html`<div class="px-6 py-4 border-b border-slate-100 text-sm">
            ${inv.notes ? html`<p class="text-slate-600 whitespace-pre-line">${inv.notes}</p>` : ''}
            ${inv.line_items?.length
              ? html`<table class="w-full mt-2"><tbody>${inv.line_items.map(
                  (li) => html`<tr><td class="py-1 text-slate-600">${li.description}</td><td class="py-1 text-right num">${formatINR(li.amount_paise)}</td></tr>`,
                )}</tbody></table>`
              : ''}
          </div>`
        : ''}

      ${upi
        ? html`<div class="p-6 border-b border-slate-100 text-center">
            <a href="${upi}" class="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800">${icon('smartphone', 'h-5 w-5')} Pay ${formatINR(inv.amount_paise)} with UPI app</a>
            <p class="mt-4 text-xs text-slate-500">or scan with any UPI app</p>
            <img src="${qr}" alt="UPI QR code for ${formatINR(inv.amount_paise)}" class="mx-auto mt-2 h-48 w-48 rounded-lg border border-slate-200 p-1" />
            <p class="mt-2 text-xs text-slate-500">UPI ID: <span class="font-mono text-slate-700">${owner.upi_id}</span></p>
            <p class="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">${icon('shield', 'h-3.5 w-3.5 text-brand-600')} You pay ${biz} directly. Duely never touches the money.</p>
          </div>`
        : payable
          ? html`<div class="p-6 border-b border-slate-100 text-sm text-slate-600">Please pay ${biz} using the bank details they shared with you.</div>`
          : ''}

      ${payable
        ? html`<div class="p-6 space-y-3">
            <p class="text-sm font-semibold text-slate-900">Already sorted, or need more time?</p><p class="text-xs text-slate-500 -mt-2">Let ${biz} know in one tap.</p>

            <details class="group rounded-xl border border-slate-200 open:border-brand-600">
              <summary class="cursor-pointer list-none min-h-[48px] px-4 py-3 font-medium text-slate-900 flex justify-between items-center rounded-xl hover:bg-slate-50">I've paid ${icon('chevronDown', 'h-5 w-5 text-slate-400 transition-transform group-open:rotate-180')}</summary>
              <form method="post" action="${self}/paid" class="px-4 pb-4 space-y-3">
                <label class="block text-xs text-slate-600" for="ref">UTR / transaction reference (optional)</label>
                <input id="ref" name="reference" maxlength="100" inputmode="text" autocomplete="off" class="block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" placeholder="e.g. 412345678901" />
                <button class="w-full min-h-[48px] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800" data-loading="Sending…">Confirm payment sent</button>
              </form>
            </details>

            <details class="group rounded-xl border border-slate-200 open:border-brand-600">
              <summary class="cursor-pointer list-none min-h-[48px] px-4 py-3 font-medium text-slate-900 flex justify-between items-center rounded-xl hover:bg-slate-50">I'll pay by a date ${icon('chevronDown', 'h-5 w-5 text-slate-400 transition-transform group-open:rotate-180')}</summary>
              <form method="post" action="${self}/promise" class="px-4 pb-4 space-y-3">
                <label class="block text-xs text-slate-600" for="pdate">I'll pay by</label>
                <input id="pdate" name="promise_date" type="date" required min="${today}" max="${addDays(today, MAX_PROMISE_DAYS)}" value="${addDays(today, 3)}" class="block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
                <button class="w-full min-h-[48px] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800" data-loading="Sending…">Send promise</button>
              </form>
            </details>

            <details class="group rounded-xl border border-slate-200 open:border-red-500">
              <summary class="cursor-pointer list-none min-h-[48px] px-4 py-3 font-medium text-slate-900 flex justify-between items-center rounded-xl hover:bg-slate-50">There's an issue ${icon('chevronDown', 'h-5 w-5 text-slate-400 transition-transform group-open:rotate-180')}</summary>
              <form method="post" action="${self}/issue" class="px-4 pb-4 space-y-3">
                <label class="block text-xs text-slate-600" for="issue">What's wrong?</label>
                <textarea id="issue" name="message" required minlength="3" maxlength="1000" rows="3" class="block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500" placeholder="e.g. Amount should be ₹80,000 as agreed"></textarea>
                <button class="w-full min-h-[48px] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800" data-loading="Sending…">Send to ${biz}</button>
              </form>
            </details>
          </div>`
        : ''}
    </div>`;

  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer'); // keep the token out of Referer headers
  res.send(String(shell(`${formatINR(inv.amount_paise)} to ${biz} · ${inv.invoice_number}`, content)));
});

// ---------- client actions ----------
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: 'Too many submissions. Please wait a few minutes and try again.' });

async function loadPayable(req: Request, res: Response): Promise<Invoice | undefined> {
  const inv = await getInvoiceByPayToken(String(req.params.token));
  if (!inv) {
    notFound(res);
    return undefined;
  }
  if (inv.status === 'paid' || inv.status === 'cancelled') {
    res.redirect(303, `/pay/${encodeURIComponent(String(req.params.token))}`);
    return undefined;
  }
  return inv;
}

const back = (req: Request, res: Response, done?: string) =>
  res.redirect(303, `/pay/${encodeURIComponent(String(req.params.token))}${done ? `?done=${done}` : ''}`);

payRouter.post('/pay/:token/paid', limiter, async (req, res) => {
  const inv = await loadPayable(req, res);
  if (!inv) return;
  const reference = String(req.body?.reference ?? '').trim().slice(0, 100);
  await markPaid(inv.user_id, inv.id, { reference: reference || undefined }, 'client');
  back(req, res, 'paid');
});

payRouter.post('/pay/:token/promise', limiter, async (req, res) => {
  const inv = await loadPayable(req, res);
  if (!inv) return;
  const d = String(req.body?.promise_date ?? '');
  const today = todayIST();
  if (!isValidDate(d) || d < today || d > addDays(today, MAX_PROMISE_DAYS)) return back(req, res);
  await recordClientPromise(inv, d);
  back(req, res, 'promise');
});

payRouter.post('/pay/:token/issue', limiter, async (req, res) => {
  const inv = await loadPayable(req, res);
  if (!inv) return;
  const message = String(req.body?.message ?? '').trim().slice(0, 1000);
  if (message.length < 3) return back(req, res);
  await recordClientIssue(inv, message);
  back(req, res, 'issue');
});
