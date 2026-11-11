import { Router } from 'express';
import { daysBetween, daysOverdue, formatDate, formatINR, todayIST } from '../lib/format';
import { describeClientAction, InvoiceWithActivity, isOpen, listWithActivity, promiseBroken, Status } from '../services/invoices';
import { receivablesSummary } from '../services/summary';
import { requireAuth, takeFlash } from './auth';
import { html } from './html';
import { icon } from './icons';
import { appPage, card, pageHeader } from './layout';
import { btnPrimary, statusBadge } from './ui';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const AGING = [
  { label: 'Not due', color: 'bg-slate-300' },
  { label: '1–15d', color: 'bg-amber-300' },
  { label: '16–30d', color: 'bg-orange-400' },
  { label: '31–60d', color: 'bg-red-500' },
  { label: '60d+', color: 'bg-red-800' },
];

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'promised', label: 'Promised' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'paid', label: 'Paid' },
];

type PriorityItem = Awaited<ReturnType<typeof receivablesSummary>>['priority'][number];

/** Short web label for why an invoice needs attention. Same rules as the summary tool, fewer words. */
function attention(p: PriorityItem, today: string) {
  if (p.promise_broken)
    return { why: `Promise broken ${daysBetween(p.promise_date!, today)}d ago`, todo: 'Send a firm nudge', tone: 'text-red-700' };
  if (p.status === 'disputed') return { why: 'Client raised an issue', todo: 'Resolve before chasing', tone: 'text-red-700' };
  if (p.nudges_sent >= 2) return { why: `${p.days_overdue}d overdue · ${p.nudges_sent} nudges`, todo: 'Escalate or call', tone: 'text-amber-800' };
  if (p.nudges_sent === 0) return { why: `${p.days_overdue}d overdue · not chased`, todo: 'Send a first nudge', tone: 'text-amber-800' };
  return { why: `${p.days_overdue}d overdue`, todo: 'Follow up', tone: 'text-amber-800' };
}

/** One line on the latest thing that happened with the client. */
function latest(i: InvoiceWithActivity, today: string) {
  if (promiseBroken(i, today)) return html`<span class="text-red-700 font-medium">Promise broken · ${formatDate(i.promise_date)}</span>`;
  if (i.status === 'promised' && i.promise_date) return html`<span class="text-slate-700">Pays by ${formatDate(i.promise_date)}</span>`;
  const a = describeClientAction(i.lca_type, i.lca_meta);
  return a ? html`<span class="text-slate-600">${a}</span>` : html`<span class="text-slate-300">—</span>`;
}

const overdueText = (od: number) =>
  od > 0 ? html`<span class="${od > 30 ? 'text-red-700' : 'text-amber-800'} font-medium">${od}d overdue</span>` : '';

const claudeMark = html`<span class="inline-flex items-center gap-0.5 text-orange-700" title="Created by Claude">${icon('sparkle', 'h-3 w-3')}Claude</span>`;

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!;
  const today = todayIST();
  const [summary, all] = await Promise.all([receivablesSummary(user.id), listWithActivity(user.id)]);

  const isOverdue = (i: InvoiceWithActivity) => isOpen(i.status) && daysOverdue(i.due_date, today) > 0;
  const filter = String(req.query.status ?? 'all');
  const rows = all
    .filter((i) => (filter === 'all' ? i.status !== 'cancelled' : filter === 'overdue' ? isOverdue(i) : i.status === filter))
    .sort((a, b) => {
      // Open invoices first (most overdue first), then the rest by due date, newest first.
      const ao = isOpen(a.status) ? 1 : 0;
      const bo = isOpen(b.status) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      if (ao) return daysOverdue(b.due_date, today) - daysOverdue(a.due_date, today) || a.due_date.localeCompare(b.due_date);
      return b.due_date.localeCompare(a.due_date);
    });

  const counts: Record<string, number> = {
    all: all.filter((i) => i.status !== 'cancelled').length,
    overdue: all.filter(isOverdue).length,
  };
  for (const t of TABS.slice(2)) counts[t.key] = all.filter((i) => i.status === t.key).length;
  const cancelled = all.filter((i) => i.status === 'cancelled').length;

  const t = summary.totals;
  const promisedWeek = summary.promises_due_this_week.reduce((s, p) => s + p.amount * 100, 0);
  const kpis = [
    { label: 'Outstanding', value: t.outstanding.formatted, sub: `${t.outstanding.count} open`, tone: 'text-slate-900' },
    { label: 'Overdue', value: t.overdue.formatted, sub: plural(t.overdue.count, 'invoice'), tone: t.overdue.count ? 'text-red-700' : 'text-slate-900' },
    { label: 'Promised this week', value: formatINR(promisedWeek), sub: plural(summary.promises_due_this_week.length, 'promise'), tone: 'text-slate-900' },
    { label: 'Collected this month', value: t.collected_this_month.formatted, sub: `${t.collected_this_month.count} paid`, tone: 'text-brand-700' },
  ];
  const agingTotal = summary.aging.reduce((s, b) => s + b.amount, 0);

  // "Chase today": the summary's rule-based priority list, minus clients who are inside a kept promise.
  const chase = summary.priority.filter((p) => p.status !== 'promised' || p.promise_broken).slice(0, 3);

  const body = html`
    ${pageHeader('Receivables', null, html`<a href="/invoices/new" class="${btnPrimary}">${icon('plus')} New invoice</a>`)}

    ${card(
      html`<dl class="grid grid-cols-2 lg:grid-cols-4 divide-slate-100 [&>div]:p-4 sm:[&>div]:p-5 [&>div:nth-child(odd)]:border-r lg:[&>div]:border-r lg:[&>div:last-child]:border-r-0 [&>div:nth-child(-n+2)]:border-b lg:[&>div]:border-b-0 border-slate-100">
        ${kpis.map(
          (k) => html`<div class="border-slate-100">
            <dt class="text-sm text-slate-500">${k.label}</dt>
            <dd class="mt-1 text-2xl sm:text-[28px] font-semibold tracking-tight num ${k.tone}">${k.value}</dd>
            <dd class="text-xs text-slate-400">${k.sub}</dd>
          </div>`,
        )}
      </dl>
      ${agingTotal
        ? html`<div class="border-t border-slate-100 px-4 sm:px-5 py-4">
            <div class="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Open amount by age: ${summary.aging.map((b, i) => `${AGING[i].label} ${b.formatted}`).join(', ')}">
              ${summary.aging.map((b, i) =>
                b.amount ? html`<div class="${AGING[i].color} border-r-2 border-white last:border-r-0" style="width:${((b.amount / agingTotal) * 100).toFixed(2)}%" title="${AGING[i].label}: ${b.formatted}"></div>` : '',
              )}
            </div>
            <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500">
              ${summary.aging.map(
                (b, i) => html`<li class="flex items-center gap-1.5 ${b.amount ? '' : 'opacity-50'}"><span class="h-2 w-2 rounded-sm ${AGING[i].color}" aria-hidden="true"></span>${AGING[i].label} <span class="num font-medium text-slate-800">${b.formatted}</span></li>`,
              )}
            </ul>
          </div>`
        : ''}`,
      'mb-6',
    )}

    ${chase.length
      ? html`<section class="mb-6" aria-labelledby="chase-h">
          <h2 id="chase-h" class="mb-3 text-sm font-semibold text-slate-900">Chase today</h2>
          <ol class="grid grid-cols-1 md:grid-cols-3 gap-3">
            ${chase.map((p) => {
              const a = attention(p, today);
              return html`<li><a href="/invoices/${p.id}" class="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-brand-600">
                <div class="flex items-baseline justify-between gap-3">
                  <p class="font-medium text-slate-900 truncate">${p.client_name}</p>
                  <p class="num font-semibold text-slate-900 whitespace-nowrap">${p.formatted}</p>
                </div>
                <p class="mt-1 text-sm ${a.tone}">${a.why}</p>
                <p class="mt-auto pt-3 flex items-center justify-between text-sm font-medium text-brand-700">${a.todo}${icon('chevronRight', 'h-4 w-4 transition-transform group-hover:translate-x-0.5')}</p>
              </a></li>`;
            })}
          </ol>
        </section>`
      : ''}

    ${card(html`
      <div class="flex gap-1 overflow-x-auto px-2 sm:px-3 border-b border-slate-200" role="tablist" aria-label="Filter invoices">
        ${TABS.map(
          (tb) => html`<a role="tab" aria-selected="${String(filter === tb.key)}" href="${tb.key === 'all' ? '/' : `/?status=${tb.key}`}" class="whitespace-nowrap px-3 py-3 text-sm border-b-2 -mb-px transition-colors ${
            filter === tb.key ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
          }">${tb.label}<span class="ml-1.5 num text-xs ${filter === tb.key ? 'text-slate-500' : 'text-slate-400'}">${counts[tb.key] ?? 0}</span></a>`,
        )}
      </div>
      ${rows.length
        ? html`
          <ul class="md:hidden divide-y divide-slate-100">
            ${rows.map((i) => {
              const od = isOpen(i.status) ? daysOverdue(i.due_date, today) : 0;
              return html`<li><a href="/invoices/${i.id}" class="block px-4 py-3.5 active:bg-slate-50">
                <div class="flex items-start justify-between gap-3">
                  <p class="font-medium text-slate-900 truncate">${i.client_name}</p>
                  <p class="font-semibold num whitespace-nowrap">${formatINR(i.amount_paise)}</p>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  ${statusBadge(i.status as Status)} ${overdueText(od)} ${i.source === 'claude' ? claudeMark : ''}
                </div>
              </a></li>`;
            })}
          </ul>
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-slate-500">
                <tr class="border-b border-slate-100">
                  <th scope="col" class="px-5 py-3 font-medium">Client</th>
                  <th scope="col" class="px-4 py-3 font-medium text-right">Amount</th>
                  <th scope="col" class="px-4 py-3 font-medium">Due</th>
                  <th scope="col" class="px-4 py-3 font-medium">Status</th>
                  <th scope="col" class="px-4 py-3 font-medium">Latest from client</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${rows.map((i) => {
                  const od = isOpen(i.status) ? daysOverdue(i.due_date, today) : 0;
                  return html`<tr class="group hover:bg-slate-50 transition-colors cursor-pointer" onclick="location.href='/invoices/${i.id}'">
                    <td class="px-5 py-3.5">
                      <a href="/invoices/${i.id}" class="font-medium text-slate-900 group-hover:text-brand-700">${i.client_name}</a>
                      <div class="mt-0.5 flex items-center gap-2 text-xs text-slate-400">${i.invoice_number} ${i.source === 'claude' ? claudeMark : ''}</div>
                    </td>
                    <td class="px-4 py-3.5 text-right font-semibold num whitespace-nowrap">${formatINR(i.amount_paise)}</td>
                    <td class="px-4 py-3.5 whitespace-nowrap"><div class="text-slate-700">${formatDate(i.due_date)}</div><div class="text-xs">${overdueText(od)}</div></td>
                    <td class="px-4 py-3.5">${statusBadge(i.status as Status)}</td>
                    <td class="px-4 py-3.5 max-w-[18rem] truncate">${latest(i, today)}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>
          ${cancelled && filter === 'all'
            ? html`<p class="border-t border-slate-100 px-5 py-3 text-xs text-slate-400"><a class="hover:text-slate-700" href="/?status=cancelled">${cancelled} cancelled hidden · show</a></p>`
            : ''}`
        : all.length
          ? html`<div class="px-6 py-12 text-center text-sm text-slate-500">Nothing here. <a class="font-medium text-brand-700 hover:underline" href="/">Show all</a></div>`
          : html`<div class="px-6 py-16 text-center">
              <p class="font-semibold text-slate-900">No invoices yet</p>
              <p class="mt-2 text-sm text-slate-500">Connect Claude and tell it who owes you money.</p>
              <div class="mt-5 flex flex-wrap justify-center gap-2">
                <a href="/connect" class="${btnPrimary}">${icon('plug')} Connect Claude</a>
                <a href="/invoices/new" class="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">Add one by hand</a>
              </div>
            </div>`}
    `)}`;

  res.send(String(appPage({ title: 'Receivables', active: 'dashboard', business: user.business_name, flash: takeFlash(req), body })));
});
