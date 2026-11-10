import { one } from '../db';

// Product metrics across all accounts, computed live from invoices + events. No caching, no model.
const IST_DATE = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

export async function productMetrics() {
  const northStar = await one<{ paise: number; count: number; all_paise: number }>(`
    SELECT
      COALESCE(SUM(i.paid_amount_paise) FILTER (WHERE ${IST_DATE('i.paid_at')} <= i.due_date + 30 AND touched), 0)::bigint AS paise,
      COUNT(*) FILTER (WHERE ${IST_DATE('i.paid_at')} <= i.due_date + 30 AND touched)::int AS count,
      COALESCE(SUM(i.paid_amount_paise), 0)::bigint AS all_paise
    FROM (
      SELECT i.*, EXISTS (
        SELECT 1 FROM events e WHERE e.invoice_id = i.id AND (e.source = 'client' OR e.type = 'nudge_saved')
      ) AS touched
      FROM invoices i WHERE i.status = 'paid' AND i.paid_at IS NOT NULL
    ) i`);

  const activation = await one<{ users: number; activated: number; connected: number }>(`
    SELECT COUNT(*)::int AS users,
      COUNT(*) FILTER (WHERE conn AND first_claude IS NOT NULL AND first_claude <= u.created_at + interval '24 hours')::int AS activated,
      COUNT(*) FILTER (WHERE conn)::int AS connected
    FROM (
      SELECT u.*,
        EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.type = 'mcp_connected') AS conn,
        (SELECT MIN(created_at) FROM invoices i WHERE i.user_id = u.id AND i.source = 'claude') AS first_claude
      FROM users u
    ) u`);

  const ttfl = await one<{ median_h: number | null; avg_h: number | null; n: number }>(`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS median_h,
      AVG(hours) AS avg_h, COUNT(*)::int AS n
    FROM (
      SELECT EXTRACT(EPOCH FROM (MIN(i.created_at) - u.created_at)) / 3600 AS hours
      FROM users u JOIN invoices i ON i.user_id = u.id GROUP BY u.id, u.created_at
    ) t`);

  const response = await one<{ links: number; responded: number; viewed: number }>(`
    SELECT COUNT(*)::int AS links,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.invoice_id = i.id AND e.source = 'client'
                         AND e.type IN ('promise_made','marked_paid','issue_raised')))::int AS responded,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.invoice_id = i.id AND e.type = 'page_viewed'))::int AS viewed
    FROM invoices i WHERE i.status <> 'draft'`);

  const promises = await one<{ resolved: number; kept: number; pending: number }>(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'paid' OR promise_date < ${IST_DATE('now()')})::int AS resolved,
      COUNT(*) FILTER (WHERE status = 'paid' AND ${IST_DATE('paid_at')} <= promise_date)::int AS kept,
      COUNT(*) FILTER (WHERE status <> 'paid' AND promise_date >= ${IST_DATE('now()')})::int AS pending
    FROM invoices WHERE promise_date IS NOT NULL AND status <> 'cancelled'`);

  const dso = await one<{ avg_days: number | null; n: number }>(`
    SELECT AVG(${IST_DATE('paid_at')} - due_date)::float AS avg_days, COUNT(*)::int AS n
    FROM invoices WHERE status = 'paid' AND paid_at IS NOT NULL`);

  const edits = await one<{ claude_total: number; edited: number }>(`
    SELECT COUNT(*)::int AS claude_total,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.invoice_id = i.id AND e.type = 'invoice_edited'))::int AS edited
    FROM invoices i WHERE i.source = 'claude'`);

  const sources = await one<{ claude: number; web: number }>(`
    SELECT COUNT(*) FILTER (WHERE source = 'claude')::int AS claude, COUNT(*) FILTER (WHERE source = 'web')::int AS web FROM invoices`);

  const activity = await one<{ nudges: number; summaries: number; views: number }>(`
    SELECT COUNT(*) FILTER (WHERE type = 'nudge_saved')::int AS nudges,
           COUNT(*) FILTER (WHERE type = 'summary_requested')::int AS summaries,
           COUNT(*) FILTER (WHERE type = 'page_viewed')::int AS views
    FROM events WHERE created_at > now() - interval '30 days'`);

  return { northStar: northStar!, activation: activation!, ttfl: ttfl!, response: response!, promises: promises!, dso: dso!, edits: edits!, sources: sources!, activity: activity! };
}
