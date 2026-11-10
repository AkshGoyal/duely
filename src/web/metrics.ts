import { Router } from 'express';
import { formatINR } from '../lib/format';
import { productMetrics } from '../services/metrics';
import { requireAuth, takeFlash } from './auth';
import { html } from './html';
import { icon } from './icons';
import { appPage, card, pageHeader } from './layout';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const ratio = (n: number, d: number) => (d ? n / d : 0);

function hours(h: number | null): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

const bar = (value: number, tone = 'bg-brand-600') =>
  html`<div class="mt-3 h-1.5 w-full rounded-full bg-slate-100" aria-hidden="true"><div class="h-1.5 rounded-full ${tone}" style="width:${Math.min(100, Math.round(value * 100))}%"></div></div>`;

export const metricsRouter = Router();

metricsRouter.get('/metrics', requireAuth, async (req, res) => {
  const m = await productMetrics();
  const tiles = [
    {
      label: 'Activation',
      value: pct(m.activation.activated, m.activation.users),
      sub: `${m.activation.activated} of ${m.activation.users} account(s)`,
      def: 'Connected Claude (first MCP tool call) AND first invoice created by Claude within 24h of signup.',
      r: ratio(m.activation.activated, m.activation.users),
    },
    {
      label: 'Time to first link',
      value: hours(m.ttfl.median_h),
      sub: `median · avg ${hours(m.ttfl.avg_h)} · ${m.ttfl.n} account(s)`,
      def: 'Signup → first invoice (any source). Every invoice has a live pay link from creation.',
    },
    {
      label: 'Client response rate',
      value: pct(m.response.responded, m.response.links),
      sub: `${m.response.responded} of ${m.response.links} links · ${pct(m.response.viewed, m.response.links)} opened`,
      def: 'Share of pay links (non-draft invoices) where the client tapped I’ve paid, I’ll pay by, or There’s an issue.',
      r: ratio(m.response.responded, m.response.links),
    },
    {
      label: 'Promise-kept rate',
      value: pct(m.promises.kept, m.promises.resolved),
      sub: `${m.promises.kept} of ${m.promises.resolved} resolved · ${m.promises.pending} pending`,
      def: 'Of promises that are due or settled, the share paid on or before the promised date.',
      r: ratio(m.promises.kept, m.promises.resolved),
      tone: 'bg-amber-500',
    },
    {
      label: 'Due date → paid',
      value: m.dso.avg_days === null ? '—' : `${m.dso.avg_days.toFixed(1)} days`,
      sub: `average over ${m.dso.n} paid invoice(s)`,
      def: 'Average days between due date and payment (negative = paid early). Lower is better.',
    },
    {
      label: 'Edit rate',
      value: pct(m.edits.edited, m.edits.claude_total),
      sub: `${m.edits.edited} of ${m.edits.claude_total} Claude-created invoices`,
      def: 'Claude-created invoices edited afterwards. A proxy for tool quality: lower means Claude got it right first time.',
      r: ratio(m.edits.edited, m.edits.claude_total),
      tone: 'bg-slate-400',
    },
  ];
  const total = m.sources.claude + m.sources.web;

  const body = html`
    ${pageHeader('Metrics', 'Computed live from the event log across all accounts. Definitions under each number.')}

    ${card(
      html`<div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <span class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white">${icon('rupee', 'h-6 w-6')}</span>
        <div class="flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">North star</p>
          <p class="text-sm text-slate-600">₹ collected through Duely links within 30 days of the due date</p>
          <p class="mt-1 text-3xl sm:text-4xl font-bold tracking-tight num text-slate-900">${formatINR(m.northStar.paise)}</p>
          <p class="mt-1 text-xs text-slate-500">${m.northStar.count} invoice(s). “Through Duely” = paid invoices whose link the client acted on or that got a nudge. All collections: ${formatINR(m.northStar.all_paise)}.</p>
        </div>
      </div>`,
      'mb-6 border-brand-200',
    )}

    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      ${tiles.map((t) =>
        card(html`<div class="p-5">
          <p class="text-sm font-medium text-slate-500">${t.label}</p>
          <p class="mt-1 text-2xl font-semibold tracking-tight num text-slate-900">${t.value}</p>
          <p class="text-xs text-slate-500">${t.sub}</p>
          ${t.r !== undefined ? bar(t.r, t.tone) : ''}
          <p class="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">${t.def}</p>
        </div>`),
      )}
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${card(html`<div class="p-5">
        <h2 class="text-sm font-semibold text-slate-900">Invoices created: Claude vs web</h2>
        <div class="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Claude ${m.sources.claude}, web ${m.sources.web}">
          ${total ? html`<div class="bg-orange-400" style="width:${((m.sources.claude / total) * 100).toFixed(1)}%"></div><div class="bg-slate-300 flex-1"></div>` : ''}
        </div>
        <dl class="mt-3 flex gap-6 text-sm">
          <div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-sm bg-orange-400"></span><dt class="text-slate-500">Via Claude</dt><dd class="font-semibold num">${m.sources.claude} <span class="font-normal text-slate-400">(${pct(m.sources.claude, total)})</span></dd></div>
          <div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-sm bg-slate-300"></span><dt class="text-slate-500">Web</dt><dd class="font-semibold num">${m.sources.web}</dd></div>
        </dl>
      </div>`)}
      ${card(html`<div class="p-5">
        <h2 class="text-sm font-semibold text-slate-900">Last 30 days</h2>
        <dl class="mt-4 grid grid-cols-3 gap-4 text-center">
          <div><dd class="text-2xl font-semibold num">${m.activity.nudges}</dd><dt class="text-xs text-slate-500">Nudges written by Claude</dt></div>
          <div><dd class="text-2xl font-semibold num">${m.activity.views}</dd><dt class="text-xs text-slate-500">Pay links opened</dt></div>
          <div><dd class="text-2xl font-semibold num">${m.activity.summaries}</dd><dt class="text-xs text-slate-500">“Who owes me?” briefings</dt></div>
        </dl>
      </div>`)}
    </div>`;

  res.send(String(appPage({ title: 'Metrics', active: 'metrics', business: req.user!.business_name, flash: takeFlash(req), body })));
});
