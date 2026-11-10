import { one } from '../db';
import { addDays, daysBetween, daysOverdue, formatDate, formatINR, todayIST, toRupees } from '../lib/format';
import { editUrl, payUrl } from '../lib/tokens';
import { describeClientAction, InvoiceWithActivity, isOpen, listWithActivity, promiseBroken } from './invoices';

const money = (paise: number) => ({ amount: toRupees(paise), formatted: formatINR(paise) });

const daysAgo = (d: Date | null, today: string) =>
  d ? daysBetween(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d), today) : null;

/** Rule-based next action for one invoice. No model involved: plain if/else on the stored memory. */
export function suggestAction(inv: InvoiceWithActivity, today: string): string {
  const overdue = daysOverdue(inv.due_date, today);
  const nudgeAge = daysAgo(inv.last_nudge_at, today);
  if (inv.status === 'disputed') {
    const issue = inv.lca_type === 'issue_raised' ? ` ("${inv.lca_meta?.message ?? ''}")` : '';
    return `Client raised an issue${issue}. Resolve it with them first; do not send a payment reminder until it is settled.`;
  }
  if (promiseBroken(inv, today)) {
    const late = daysBetween(inv.promise_date!, today);
    return `Promise to pay by ${formatDate(inv.promise_date)} was broken ${late} day(s) ago. Send a firm, polite nudge that references the promise and asks for a firm new date.`;
  }
  if (inv.status === 'promised' && inv.promise_date) {
    return `Client promised to pay by ${formatDate(inv.promise_date)}. Do not nudge before then; check again the day after.`;
  }
  if (overdue === 0) return `Not due until ${formatDate(inv.due_date)}. A friendly heads-up 1–2 days before the due date is optional.`;
  if (inv.nudge_count === 0) {
    const viewed = inv.status === 'viewed' ? ' They have opened the pay link but not responded.' : '';
    return `${overdue} day(s) overdue and no reminder sent yet.${viewed} Send a friendly first nudge with the pay link.`;
  }
  if (nudgeAge !== null && nudgeAge < 3) {
    return `Nudged ${nudgeAge === 0 ? 'today' : `${nudgeAge} day(s) ago`} (${inv.last_nudge_tone}). Give them until ${formatDate(addDays(today, 3 - nudgeAge))} before following up.`;
  }
  return `${overdue} day(s) overdue; last nudge ${nudgeAge} day(s) ago was "${inv.last_nudge_tone}" (${inv.nudge_count} sent). Escalate one step in firmness, stay polite, and consider a call.`;
}

function priorityTier(inv: InvoiceWithActivity, today: string): number {
  if (promiseBroken(inv, today)) return 3;
  if (inv.status === 'disputed') return 2;
  return 1;
}

export async function receivablesSummary(userId: number) {
  const today = todayIST();
  const weekEnd = addDays(today, 6);
  const monthStart = today.slice(0, 8) + '01';
  const all = await listWithActivity(userId);
  const open = all.filter((i) => isOpen(i.status));

  const buckets = [
    { key: 'not_due', label: 'Not yet due', min: 0, max: 0 },
    { key: '1_15', label: '1–15 days overdue', min: 1, max: 15 },
    { key: '16_30', label: '16–30 days overdue', min: 16, max: 30 },
    { key: '31_60', label: '31–60 days overdue', min: 31, max: 60 },
    { key: '60_plus', label: '60+ days overdue', min: 61, max: Infinity },
  ].map((b) => {
    const rows = open.filter((i) => {
      const d = daysOverdue(i.due_date, today);
      return d >= b.min && d <= b.max;
    });
    const paise = rows.reduce((s, i) => s + i.amount_paise, 0);
    return { bucket: b.key, label: b.label, count: rows.length, ...money(paise) };
  });

  const overdueRows = open.filter((i) => daysOverdue(i.due_date, today) > 0);
  const outstanding = open.reduce((s, i) => s + i.amount_paise, 0);
  const overdueTotal = overdueRows.reduce((s, i) => s + i.amount_paise, 0);

  const collected = await one<{ paise: number; count: number }>(
    `SELECT COALESCE(SUM(paid_amount_paise), 0)::bigint AS paise, COUNT(*)::int AS count
     FROM invoices WHERE user_id = $1 AND status = 'paid'
       AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date`,
    [userId, monthStart],
  );

  const brief = (i: InvoiceWithActivity) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    client_name: i.client_name,
    ...money(i.amount_paise),
    due_date: i.due_date,
    days_overdue: daysOverdue(i.due_date, today),
    status: i.status,
    promise_date: i.promise_date,
  });

  const priority = open
    .filter((i) => daysOverdue(i.due_date, today) > 0 || i.status === 'disputed' || promiseBroken(i, today))
    .sort(
      (a, b) =>
        priorityTier(b, today) - priorityTier(a, today) ||
        daysOverdue(b.due_date, today) * b.amount_paise - daysOverdue(a.due_date, today) * a.amount_paise,
    )
    .slice(0, 10)
    .map((i, idx) => ({
      rank: idx + 1,
      ...brief(i),
      promise_broken: promiseBroken(i, today),
      last_client_action: describeClientAction(i.lca_type, i.lca_meta),
      nudges_sent: i.nudge_count,
      last_nudge_days_ago: daysAgo(i.last_nudge_at, today),
      suggested_action: suggestAction(i, today),
      pay_url: payUrl(i.pay_token),
      edit_url: editUrl(i.id),
    }));

  return {
    today,
    totals: {
      outstanding: { ...money(outstanding), count: open.length },
      overdue: { ...money(overdueTotal), count: overdueRows.length },
      collected_this_month: { ...money(collected?.paise ?? 0), count: collected?.count ?? 0 },
    },
    aging: buckets,
    promises_due_this_week: open
      .filter((i) => i.promise_date && i.promise_date >= today && i.promise_date <= weekEnd)
      .map(brief),
    broken_promises: open.filter((i) => promiseBroken(i, today)).map(brief),
    open_disputes: open
      .filter((i) => i.status === 'disputed')
      .map((i) => ({ ...brief(i), issue: i.lca_type === 'issue_raised' ? i.lca_meta?.message ?? null : null })),
    priority,
    priority_rules: 'Broken promises first, then disputes, then by days overdue × amount. Rule-based; no model.',
  };
}
