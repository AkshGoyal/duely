import { Router } from 'express';
import { daysOverdue, formatDate, formatINR, todayIST } from '../lib/format';
import { describeClientAction, isOpen, listWithActivity, promiseBroken, STATUSES, Status } from '../services/invoices';
import { receivablesSummary } from '../services/summary';
import { requireAuth, takeFlash } from './auth';
import { html } from './html';
import { icon } from './icons';
import { appPage, card, pageHeader } from './layout';
import { btnPrimary, sourceBadge, statusBadge } from './ui';

const BUCKET_COLORS = ['bg-slate-300', 'bg-amber-300', 'bg-orange-400', 'bg-red-500', 'bg-red-800'];

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
    { label: 'Outstanding', value: t.outstanding.formatted, sub: `${t.outstanding.count} open invoice${t.outstanding.count === 1 ? '' : 's'}`, ic: 'wallet', tone: 'text-slate-900', chip: 'bg-slate-100 text-slate-600' },
    { label: 'Overdue', value: t.overdue.formatted, sub: `${t.overdue.count} past due date`, ic: 'alert', tone: t.overdue.count ? 'text-red-700' : 'text-slate-900', chip: 'bg-red-50 text-red-600' },
    { label: 'Promised this week', value: formatINR(promisedWeek), sub: `${summary.promises_due_this_week.length} promise${summary.promises_due_this_week.length === 1 ? '' : 's'} due`, ic: 'calendar', tone: 'text-slate-900', chip: 'bg-amber-50 text-amber-600' },
    { label: 'Collected this month', value: t.collected_this_month.formatted, sub: `${t.collected_this_month.count} invoice${t.collected_this_month.count === 1 ? '' : 's'} paid`, ic: 'checkCircle', tone: 'text-brand-700', chip: 'bg-brand-50 text-brand-600' },
  ];

  const agingTotal = summary.aging.reduce((s, b) => s + b.amount, 0);
  const tabs = ['all', 'overdue', 'sent', 'viewed', 'promised', 'disputed', 'paid', 'draft', 'cancelled'];
  const alerts = [
    summary.broken_promises.length ? html`<a href="/?status=promised" class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200 hover:bg-red-100">${icon('alert', 'h-3.5 w-3.5')}${summary.broken_promises.length} broken promise${summary.broken_promises.length === 1 ? '' : 's'}</a>` : '',
    summary.open_disputes.length ? html`<a href="/?status=disputed" class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200 hover:bg-amber-100">${icon('flag', 'h-3.5 w-3.5')}${summary.open_disputes.length} open dispute${summary.open_disputes.length === 1 ? '' : 's'}</a>` : '',
  ];

  const overdueCell = (od: number) =>
    od > 0 ? html`<span class="${od > 30 ? 'text-red-700 font-semibold' : 'text-amber-800 font-medium'}">${od}d</span>` : html`<span class="text-slate-400">—</span>`;

  const body = html`
    ${pageHeader(
      'Receivables',
      html`As of ${formatDate(today)} <span class="inline-flex flex-wrap gap-2 align-middle ml-2">${alerts}</span>`,
      html`<a href="/invoices/new" class="${btnPrimary}">${icon('plus')} New invoice</a>`,
    )}

    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6" aria-label="Key figures">
      ${kpis.map(
        (k) => html`<div class="bg-white rounded-2xl border border-slate-200 shadow-card p-4 sm:p-5">
          <div class="flex items-center justify-between">
            <p class="text-xs sm:text-sm font-medium text-slate-500">${k.label}</p>
            <span class="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg ${k.chip}">${icon(k.ic)}</span>
          </div>
          <p class="mt-2 text-xl sm:text-2xl font-semibold tracking-tight num ${k.tone}">${k.value}</p>
          <p class="mt-1 text-xs text-slate-500">${k.sub}</p>
        </div>`,
      )}
    </section>

    ${card(
      html`<div class="p-4 sm:p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-slate-900">Aging</h2>
          <span class="text-xs text-slate-500">Open invoices by days overdue</span>
        </div>
        <div class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="${summary.aging.map((b) => `${b.label}: ${b.formatted}`).join(', ')}">
          ${agingTotal
            ? summary.aging.map((b, i) =>
                b.amount ? html`<div class="${BUCKET_COLORS[i]} border-r-2 border-white last:border-r-0" style="width:${((b.amount / agingTotal) * 100).toFixed(2)}%" title="${b.label}: ${b.formatted}"></div>` : '',
              )
            : ''}
        </div>
        <dl class="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          ${summary.aging.map(
            (b, i) => html`<div class="flex items-start gap-2">
              <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${BUCKET_COLORS[i]}" aria-hidden="true"></span>
              <div><dt class="text-xs text-slate-500">${b.label}</dt><dd class="text-sm font-semibold num text-slate-900">${b.formatted} <span class="text-slate-400 font-normal">· ${b.count}</span></dd></div>
            </div>`,
          )}
        </dl>
      </div>`,
      'mb-6',
    )}

    ${card(html`
      <div class="flex gap-1 overflow-x-auto px-2 sm:px-3 pt-2 border-b border-slate-200" role="tablist" aria-label="Filter by status">
        ${tabs.map(
          (s) => html`<a role="tab" aria-selected="${filter === s}" href="${s === 'all' ? '/' : `/?status=${s}`}" class="whitespace-nowrap px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
            filter === s ? 'border-brand-600 text-slate-900 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'
          }">${s[0].toUpperCase() + s.slice(1)} <span class="ml-0.5 rounded-full px-1.5 text-xs ${filter === s ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-500'}">${counts[s] ?? 0}</span></a>`,
        )}
      </div>
      ${rows.length
        ? html`
          <ul class="md:hidden divide-y divide-slate-100">
            ${rows.map((i) => {
              const od = isOpen(i.status) ? daysOverdue(i.due_date, today) : 0;
              const broken = promiseBroken(i, today);
              return html`<li><a href="/invoices/${i.id}" class="block px-4 py-3.5 active:bg-slate-50">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0"><p class="font-medium text-slate-900 truncate">${i.client_name}</p><p class="text-xs text-slate-500">${i.invoice_number} · due ${formatDate(i.due_date)}</p></div>
                  <p class="font-semibold num whitespace-nowrap">${formatINR(i.amount_paise)}</p>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  ${statusBadge(i.status as Status)}
                  ${od > 0 ? html`<span class="${od > 30 ? 'text-red-700 font-semibold' : 'text-amber-800 font-medium'}">${od} days overdue</span>` : ''}
                  ${broken ? html`<span class="text-red-700 font-medium">Promise broken</span>` : ''}
                  ${i.source === 'claude' ? sourceBadge('claude') : ''}
                </div>
              </a></li>`;
            })}
          </ul>
          <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50/60">
              <tr class="border-b border-slate-200">
                <th scope="col" class="px-4 py-2.5 font-medium">Client</th>
                <th scope="col" class="px-4 py-2.5 font-medium text-right">Amount</th>
                <th scope="col" class="px-4 py-2.5 font-medium">Due</th>
                <th scope="col" class="px-4 py-2.5 font-medium text-right">Overdue</th>
                <th scope="col" class="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" class="px-4 py-2.5 font-medium">Promise</th>
                <th scope="col" class="px-4 py-2.5 font-medium hidden lg:table-cell">Last client action</th>
                <th scope="col" class="px-4 py-2.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${rows.map((i) => {
                const od = isOpen(i.status) ? daysOverdue(i.due_date, today) : 0;
                const broken = promiseBroken(i, today);
                return html`<tr class="group hover:bg-slate-50 transition-colors cursor-pointer" onclick="location.href='/invoices/${i.id}'">
                  <td class="px-4 py-3">
                    <a href="/invoices/${i.id}" class="font-medium text-slate-900 group-hover:text-brand-700">${i.client_name}</a>
                    <div class="text-xs text-slate-500">${i.invoice_number}</div>
                  </td>
                  <td class="px-4 py-3 text-right font-semibold num whitespace-nowrap">${formatINR(i.amount_paise)}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-slate-600">${formatDate(i.due_date)}</td>
                  <td class="px-4 py-3 text-right num whitespace-nowrap">${overdueCell(od)}</td>
                  <td class="px-4 py-3">${statusBadge(i.status as Status)}</td>
                  <td class="px-4 py-3 whitespace-nowrap ${broken ? 'text-red-700 font-medium' : 'text-slate-600'}">${
                    i.promise_date ? html`${formatDate(i.promise_date)}${broken ? html`<span class="block text-xs">Broken</span>` : ''}` : html`<span class="text-slate-400">—</span>`
                  }</td>
                  <td class="px-4 py-3 text-slate-600 hidden lg:table-cell max-w-[15rem] truncate">${describeClientAction(i.lca_type, i.lca_meta) ?? html`<span class="text-slate-400">—</span>`}</td>
                  <td class="px-4 py-3">${sourceBadge(i.source)}</td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>`
        : all.length
          ? html`<div class="px-6 py-12 text-center text-sm text-slate-500">No invoices with this status. <a class="font-medium text-brand-700 hover:underline" href="/">Show all</a></div>`
          : html`<div class="px-6 py-14 text-center">
              <span class="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">${icon('sparkle', 'h-6 w-6')}</span>
              <p class="mt-4 font-semibold text-slate-900">No invoices yet</p>
              <p class="mt-2 text-sm text-slate-500 max-w-md mx-auto">Connect your Claude, then say something like:</p>
              <p class="mt-3 inline-block rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700 max-w-md">“Acme Studios owes me ₹85,000 for the October retainer, due 20 Oct. Create it in Duely.”</p>
              <div class="mt-5 flex flex-wrap justify-center gap-2">
                <a href="/connect" class="${btnPrimary}">${icon('plug')} Connect Claude</a>
                <a href="/invoices/new" class="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">or create one by hand</a>
              </div>
            </div>`}
    `)}`;

  res.send(String(appPage({ title: 'Receivables', active: 'dashboard', business: user.business_name, flash: takeFlash(req), body })));
});
