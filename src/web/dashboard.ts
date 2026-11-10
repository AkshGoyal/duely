import { Router } from 'express';
import { daysOverdue, formatDate, formatINR, todayIST } from '../lib/format';
import { describeClientAction, isOpen, listWithActivity, promiseBroken, STATUSES, Status } from '../services/invoices';
import { receivablesSummary } from '../services/summary';
import { requireAuth, takeFlash } from './auth';
import { html } from './html';
import { appPage } from './layout';
import { btnPrimary, sourceBadge, statusBadge } from './ui';

const BUCKET_COLORS = ['bg-slate-300', 'bg-amber-300', 'bg-orange-400', 'bg-red-500', 'bg-red-700'];

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!;
  const today = todayIST();
  const [summary, all] = await Promise.all([receivablesSummary(user.id), listWithActivity(user.id)]);

  const filter = String(req.query.status ?? 'all');
  const rows = all
    .filter((i) =>
      filter === 'all'
        ? i.status !== 'cancelled'
        : filter === 'overdue'
          ? isOpen(i.status) && daysOverdue(i.due_date, today) > 0
          : i.status === filter,
    )
    .sort((a, b) => {
      // Open invoices first (most overdue first), then the rest by due date, newest first.
      const ao = isOpen(a.status) ? 1 : 0;
      const bo = isOpen(b.status) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      if (ao) return daysOverdue(b.due_date, today) - daysOverdue(a.due_date, today) || a.due_date.localeCompare(b.due_date);
      return b.due_date.localeCompare(a.due_date);
    });

  const counts: Record<string, number> = { all: all.filter((i) => i.status !== 'cancelled').length };
  counts.overdue = all.filter((i) => isOpen(i.status) && daysOverdue(i.due_date, today) > 0).length;
  for (const s of STATUSES) counts[s] = all.filter((i) => i.status === s).length;

  const promisedWeek = summary.promises_due_this_week.reduce((s, p) => s + p.amount * 100, 0);
  const t = summary.totals;
  const kpis = [
    { label: 'Outstanding', value: t.outstanding.formatted, sub: `${t.outstanding.count} open invoice(s)`, tone: 'text-slate-900' },
    { label: 'Overdue', value: t.overdue.formatted, sub: `${t.overdue.count} invoice(s) past due`, tone: t.overdue.count ? 'text-red-600' : 'text-slate-900' },
    { label: 'Promised this week', value: formatINR(promisedWeek), sub: `${summary.promises_due_this_week.length} promise(s) due`, tone: 'text-amber-700' },
    { label: 'Collected this month', value: t.collected_this_month.formatted, sub: `${t.collected_this_month.count} paid`, tone: 'text-brand-700' },
  ];

  const agingTotal = summary.aging.reduce((s, b) => s + b.amount, 0);
  const tabs = ['all', 'overdue', 'sent', 'viewed', 'promised', 'disputed', 'paid', 'draft', 'cancelled'];

  const body = html`
    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Receivables</h1>
        <p class="text-sm text-slate-500 mt-1">As of ${formatDate(today)} · ${summary.broken_promises.length} broken promise(s) · ${summary.open_disputes.length} open dispute(s)</p>
      </div>
      <a href="/invoices/new" class="${btnPrimary}">+ New invoice</a>
    </div>

    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      ${kpis.map(
        (k) => html`<div class="bg-white rounded-xl border border-slate-200 p-4">
          <p class="text-xs font-medium text-slate-500">${k.label}</p>
          <p class="mt-1 text-xl sm:text-2xl font-semibold num ${k.tone}">${k.value}</p>
          <p class="mt-1 text-xs text-slate-500">${k.sub}</p>
        </div>`,
      )}
    </section>

    <section class="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold">Aging</h2>
        <span class="text-xs text-slate-500">Open invoices by days overdue</span>
      </div>
      ${agingTotal
        ? html`<div class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            ${summary.aging.map((b, i) =>
              b.amount ? html`<div class="${BUCKET_COLORS[i]}" style="width:${((b.amount / agingTotal) * 100).toFixed(2)}%" title="${b.label}: ${b.formatted}"></div>` : '',
            )}
          </div>`
        : html`<div class="h-3 w-full rounded-full bg-slate-100"></div>`}
      <div class="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        ${summary.aging.map(
          (b, i) => html`<div class="flex items-start gap-2">
            <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${BUCKET_COLORS[i]}"></span>
            <div><p class="text-xs text-slate-500">${b.label}</p><p class="text-sm font-medium num">${b.formatted} <span class="text-slate-400 font-normal">· ${b.count}</span></p></div>
          </div>`,
        )}
      </div>
    </section>

    <section class="bg-white rounded-xl border border-slate-200">
      <div class="flex gap-1 overflow-x-auto px-3 pt-3 border-b border-slate-200">
        ${tabs.map(
          (s) => html`<a href="${s === 'all' ? '/' : `/?status=${s}`}" class="whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px ${
            filter === s ? 'border-brand-600 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
          }">${s[0].toUpperCase() + s.slice(1)} <span class="text-xs text-slate-400">${counts[s] ?? 0}</span></a>`,
        )}
      </div>
      ${rows.length
        ? html`<div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-slate-500">
              <tr class="border-b border-slate-100">
                <th class="px-4 py-2 font-medium">Client</th>
                <th class="px-4 py-2 font-medium text-right">Amount</th>
                <th class="px-4 py-2 font-medium">Due</th>
                <th class="px-4 py-2 font-medium text-right">Overdue</th>
                <th class="px-4 py-2 font-medium">Status</th>
                <th class="px-4 py-2 font-medium hidden md:table-cell">Promise</th>
                <th class="px-4 py-2 font-medium hidden lg:table-cell">Last client action</th>
                <th class="px-4 py-2 font-medium hidden sm:table-cell">Source</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((i) => {
                const od = isOpen(i.status) ? daysOverdue(i.due_date, today) : 0;
                const broken = promiseBroken(i, today);
                return html`<tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onclick="location.href='/invoices/${i.id}'">
                  <td class="px-4 py-3">
                    <a href="/invoices/${i.id}" class="font-medium text-slate-900 hover:underline">${i.client_name}</a>
                    <div class="text-xs text-slate-500">${i.invoice_number}</div>
                  </td>
                  <td class="px-4 py-3 text-right font-medium num whitespace-nowrap">${formatINR(i.amount_paise)}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-slate-600">${formatDate(i.due_date)}</td>
                  <td class="px-4 py-3 text-right num whitespace-nowrap ${od > 30 ? 'text-red-600 font-medium' : od > 0 ? 'text-amber-700' : 'text-slate-400'}">${od > 0 ? `${od}d` : '—'}</td>
                  <td class="px-4 py-3 whitespace-nowrap">${statusBadge(i.status as Status)}</td>
                  <td class="px-4 py-3 whitespace-nowrap hidden md:table-cell ${broken ? 'text-red-600 font-medium' : 'text-slate-600'}">${
                    i.promise_date ? html`${formatDate(i.promise_date)}${broken ? ' · broken' : ''}` : html`<span class="text-slate-300">—</span>`
                  }</td>
                  <td class="px-4 py-3 text-slate-600 hidden lg:table-cell max-w-[16rem] truncate">${describeClientAction(i.lca_type, i.lca_meta) ?? html`<span class="text-slate-300">—</span>`}</td>
                  <td class="px-4 py-3 hidden sm:table-cell">${sourceBadge(i.source)}</td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>`
        : all.length
          ? html`<div class="px-6 py-12 text-center text-sm text-slate-500">No invoices with this status. <a class="text-brand-700 hover:underline" href="/">Show all</a></div>`
          : html`<div class="px-6 py-14 text-center">
              <p class="font-medium">No invoices yet</p>
              <p class="mt-2 text-sm text-slate-500 max-w-md mx-auto">Tell your Claude something like:<br />
                <span class="inline-block mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700">“Acme Studios owes me ₹85,000 for the October retainer, due 20 Oct. Create it in Duely.”</span></p>
              <p class="mt-4 text-sm text-slate-500">or <a href="/invoices/new" class="text-brand-700 font-medium hover:underline">create one by hand</a>.</p>
            </div>`}
    </section>`;

  res.send(String(appPage({ title: 'Receivables', active: 'dashboard', business: user.business_name, flash: takeFlash(req), body })));
});
