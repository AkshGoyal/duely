import { formatDate, formatINR } from '../lib/format';
import type { EventRow } from '../services/events';
import type { Status } from '../services/invoices';
import { html } from './html';
import { icon } from './icons';

const STATUS_STYLE: Record<Status, { cls: string; dot: string; label: string }> = {
  draft: { cls: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400', label: 'Draft' },
  sent: { cls: 'bg-sky-50 text-sky-800', dot: 'bg-sky-500', label: 'Sent' },
  viewed: { cls: 'bg-indigo-50 text-indigo-800', dot: 'bg-indigo-500', label: 'Viewed' },
  promised: { cls: 'bg-amber-50 text-amber-900', dot: 'bg-amber-500', label: 'Promised' },
  paid: { cls: 'bg-brand-50 text-brand-800', dot: 'bg-brand-600', label: 'Paid' },
  disputed: { cls: 'bg-red-50 text-red-800', dot: 'bg-red-500', label: 'Disputed' },
  cancelled: { cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300', label: 'Cancelled' },
};

/** Status pill: dot + text label, never colour alone. */
export const statusBadge = (s: Status, extra?: string) => {
  const st = STATUS_STYLE[s];
  return html`<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${st.cls}"><span class="h-1.5 w-1.5 rounded-full ${st.dot}" aria-hidden="true"></span>${st.label}${
    extra ? html` · ${extra}` : ''
  }</span>`;
};

export const sourceBadge = (src: 'claude' | 'web') =>
  src === 'claude'
    ? html`<span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200 whitespace-nowrap">${icon('sparkle', 'h-3 w-3')}via Claude</span>`
    : html`<span class="inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">web</span>`;

export function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const FIELD_LABEL: Record<string, string> = {
  amount_paise: 'amount',
  client_name: 'client',
  client_email: 'email',
  client_phone: 'phone',
  due_date: 'due date',
  issue_date: 'issue date',
  invoice_number: 'invoice no.',
  promise_date: 'promise date',
  line_items: 'line items',
};

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'amount_paise') return formatINR(Number(v));
  if (field.endsWith('_date')) return formatDate(String(v));
  if (field === 'line_items') return `${(v as unknown[]).length} item(s)`;
  if (field === 'notes') return 'updated';
  return String(v);
}

const BY: Record<string, string> = { claude: 'via Claude', web: 'on web', client: 'by client', system: 'system' };

/** One human sentence per event, for the invoice timeline. */
export function describeEvent(e: EventRow): string {
  const m = e.meta as Record<string, any>;
  switch (e.type) {
    case 'invoice_created':
      return `Invoice created ${BY[e.source]}`;
    case 'invoice_edited': {
      const parts = Object.entries((m.changes || {}) as Record<string, { from: unknown; to: unknown }>).map(([k, c]) =>
        k === 'notes' ? 'notes updated' : `${FIELD_LABEL[k] ?? k} ${fmtValue(k, c.from)} → ${fmtValue(k, c.to)}`,
      );
      return `Edited ${BY[e.source]}: ${parts.join('; ') || 'no changes'}`;
    }
    case 'page_viewed':
      return 'Client opened the pay link';
    case 'promise_made':
      return e.source === 'client'
        ? `Client promised to pay by ${formatDate(m.promise_date)}`
        : `Promise to pay by ${formatDate(m.promise_date)} recorded ${BY[e.source]}`;
    case 'marked_paid':
      return e.source === 'client'
        ? `Client reported payment${m.reference ? ` (ref ${m.reference})` : ''}`
        : `Marked paid ${m.amount_paise ? formatINR(m.amount_paise) : ''} ${BY[e.source]}${m.reference ? ` · ref ${m.reference}` : ''}`;
    case 'issue_raised':
      return `Client raised an issue: “${m.message ?? ''}”`;
    case 'nudge_saved':
      return `${m.channel === 'email' ? 'Email' : 'WhatsApp'} nudge saved (${m.tone}) ${BY[e.source]}`;
    default:
      return e.type;
  }
}

export const EVENT_DOT: Record<string, string> = {
  invoice_created: 'bg-slate-400',
  invoice_edited: 'bg-slate-300',
  page_viewed: 'bg-indigo-400',
  promise_made: 'bg-amber-400',
  marked_paid: 'bg-brand-600',
  issue_raised: 'bg-red-500',
  nudge_saved: 'bg-sky-400',
};

export const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-colors focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
export const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';
export const helpCls = 'mt-1 text-xs text-slate-500';
export const btnPrimary =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed';
export const btnSecondary =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900';
export const btnDanger =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors duration-150 hover:bg-red-50';
