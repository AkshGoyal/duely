import { query } from '../db';

export type EventType =
  | 'invoice_created' | 'invoice_edited' | 'page_viewed' | 'promise_made' | 'marked_paid'
  | 'issue_raised' | 'nudge_saved' | 'summary_requested' | 'mcp_connected';
export type Source = 'claude' | 'web' | 'client' | 'system';

export interface EventRow {
  id: number;
  invoice_id: number | null;
  type: EventType;
  source: Source;
  meta: Record<string, unknown>;
  created_at: Date;
}

export async function logEvent(
  userId: number,
  invoiceId: number | null,
  type: EventType,
  source: Source,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await query(
    'INSERT INTO events (user_id, invoice_id, type, source, meta) VALUES ($1, $2, $3, $4, $5)',
    [userId, invoiceId, type, source, JSON.stringify(meta)],
  );
}

/** Records `mcp_connected` once per user, on the first successful tool call. */
export async function markMcpConnected(userId: number, tool: string): Promise<void> {
  await query(
    `INSERT INTO events (user_id, type, source, meta)
     SELECT $1, 'mcp_connected', 'claude', $2::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE user_id = $1 AND type = 'mcp_connected')`,
    [userId, JSON.stringify({ first_tool: tool })],
  );
}

export async function invoiceTimeline(invoiceId: number): Promise<EventRow[]> {
  return query<EventRow>(
    'SELECT id, invoice_id, type, source, meta, created_at FROM events WHERE invoice_id = $1 ORDER BY created_at, id',
    [invoiceId],
  );
}
