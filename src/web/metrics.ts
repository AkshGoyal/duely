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

export const metricsRouter = Router();

metricsRouter.get('/metrics', requireAuth, async (req, res) => {
  const m = await productMetrics();
  const claudeTotal = m.sources.claude + m.sources.web;

  // Each tile answers one question. The definition lives behind the info toggle, not on the card.
  const tiles = [
    {
      q: 'Do new users get to value?',
      label: 'Activation',
      value: pct(m.activation.activated, m.activation.users),
      ctx: `${m.activation.activated} of ${m.activation.users} accounts`,
      r: ratio(m.activation.activated, m.activation.users),
      def: 'Connected Claude and created a first invoice from Claude within 24 hours of signup.',
    },
    {
      q: 'How fast is the first pay link?',
      label: 'Time to first link',
      value: hours(m.ttfl.median_h),
      ctx: 'median, signup to first invoice',
      def: `Median time from signup to first invoice (any source). Average ${hours(m.ttfl.avg_h)} over ${m.ttfl.n} accounts.`,
    },
    {
      q: 'Do clients react to the link?',
      label: 'Client response',
      value: pct(m.response.responded, m.response.links),
      ctx: `${m.response.responded} of ${m.response.links} links · ${pct(m.response.viewed, m.response.links)} opened`,
      r: ratio(m.response.responded, m.response.links),
      def: 'Sent pay links where the client tapped I’ve paid, I’ll pay by, or There’s an issue.',
    },
    {
      q: 'Are promises worth anything?',
      label: 'Promises kept',
      value: pct(m.promises.kept, m.promises.resolved),
      ctx: `${m.promises.kept} of ${m.promises.resolved} · ${m.promises.pending} pending`,
      r: ratio(m.promises.kept, m.promises.resolved),
      def: 'Promises that are due or settled, paid on or before the promised date.',
    },
    {
      q: 'How late is money arriving?',
      label: 'Due date to paid',
      value: m.dso.avg_days === null ? '—' : `${m.dso.avg_days.toFixed(1)} days`,
      ctx: `average of ${m.dso.n} paid`,
      def: 'Average days from due date to payment. Negative means paid early. Lower is better.',
    },
    {
      q: 'Does Claude get it right first time?',
      label: 'Edit rate',
      value: pct(m.edits.edited, m.edits.claude_total),
      ctx: `${m.edits.edited} of ${m.edits.claude_total} Claude invoices`,
      r: ratio(m.edits.edited, m.edits.claude_total),
      def: 'Claude-created invoices a person edited afterwards. Lower means the tool descriptions work.',
    },
  ];

  const bar = (r: number) =>
    html`<div class="mt-4 h-1 w-full rounded-full bg-slate-100" aria-hidden="true"><div class="h-1 rounded-full bg-slate-900" style="width:${Math.min(100, Math.round(r * 100))}%"></div></div>`;

  const body = html`
    ${pageHeader('Metrics', 'Live from the event log, all accounts')}

    <section class="mb-6 rounded-2xl bg-slate-900 text-white p-6 sm:p-8" aria-labelledby="ns">
      <p id="ns" class="text-sm text-slate-300">North star · collected through Duely links within 30 days of due date</p>
      <p class="mt-2 text-4xl sm:text-5xl font-semibold tracking-tight num">${formatINR(m.northStar.paise)}</p>
      <p class="mt-2 text-sm text-slate-400"><span class="num">${m.northStar.count}</span> invoice${m.northStar.count === 1 ? '' : 's'} · <span class="num">${formatINR(m.northStar.all_paise)}</span> collected in total</p>
    </section>

    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start gap-4 mb-6">
      ${tiles.map((t) =>
        card(html`<details class="group h-full p-5">
          <summary class="list-none">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm text-slate-500">${t.label}</p>
              <span class="-m-1 rounded-md p-1 text-slate-300 transition-colors group-open:text-slate-700 hover:text-slate-600" aria-label="How ${t.label} is measured">${icon('info', 'h-4 w-4')}</span>
            </div>
            <p class="mt-1 text-3xl font-semibold tracking-tight num text-slate-900">${t.value}</p>
            <p class="mt-0.5 text-xs text-slate-400">${t.ctx}</p>
            ${t.r !== undefined ? bar(t.r) : ''}
          </summary>
          <p class="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600"><span class="font-medium text-slate-800">${t.q}</span> ${t.def}</p>
        </details>`),
      )}
    </section>

    ${card(html`<div class="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-y lg:divide-y-0 divide-slate-100">
      <div class="p-5">
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm text-slate-500">Invoices created</h2>
          <p class="text-xs text-slate-400"><span class="num font-medium text-slate-800">${pct(m.sources.claude, claudeTotal)}</span> via Claude</p>
        </div>
        <div class="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Claude ${m.sources.claude}, web ${m.sources.web}">
          ${claudeTotal ? html`<div class="bg-orange-400" style="width:${((m.sources.claude / claudeTotal) * 100).toFixed(1)}%"></div>` : ''}
        </div>
        <dl class="mt-3 flex gap-5 text-xs text-slate-500">
          <div class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm bg-orange-400"></span><dt>Claude</dt><dd class="num font-medium text-slate-800">${m.sources.claude}</dd></div>
          <div class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm bg-slate-200"></span><dt>Web</dt><dd class="num font-medium text-slate-800">${m.sources.web}</dd></div>
        </dl>
      </div>
      <div class="p-5">
        <h2 class="text-sm text-slate-500">Last 30 days</h2>
        <dl class="mt-3 grid grid-cols-3 gap-4">
          <div><dd class="text-2xl font-semibold num">${m.activity.nudges}</dd><dt class="text-xs text-slate-400">nudges drafted</dt></div>
          <div><dd class="text-2xl font-semibold num">${m.activity.views}</dd><dt class="text-xs text-slate-400">links opened</dt></div>
          <div><dd class="text-2xl font-semibold num">${m.activity.summaries}</dd><dt class="text-xs text-slate-400">daily briefings</dt></div>
        </dl>
      </div>
    </div>`)}`;

  res.send(String(appPage({ title: 'Metrics', active: 'metrics', business: req.user!.business_name, flash: takeFlash(req), body })));
});
