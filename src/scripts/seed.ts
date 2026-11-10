// npm run seed: resets the DEMO account's invoices to a realistic book of ~10 invoices over the last ~45 days.
// Keeps the demo user's row and MCP token, so an already-connected Claude keeps working.
// Deliberately leaves out "Acme Studios / INV-104": the live demo creates that one from Claude.
import { migrate, pool, tx } from '../db';
import { addDays, todayIST, toPaise } from '../lib/format';
import { newPayToken } from '../lib/tokens';
import type { EventType, Source } from '../services/events';
import type { Status } from '../services/invoices';
import { DEMO_EMAIL, ensureDemoUser } from '../services/users';

const today = todayIST();
const d = (offset: number) => addDays(today, offset); // date string relative to today
/** Timestamp `daysAgo` days back at a given IST hour. */
const at = (daysAgo: number, hour = 11, min = 0) =>
  new Date(`${d(-daysAgo)}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+05:30`);

interface Ev {
  type: EventType;
  source: Source;
  at: Date;
  meta?: Record<string, unknown>;
}
interface SeedNudge {
  channel: 'whatsapp' | 'email';
  tone: string;
  message: string;
  at: Date;
}
interface SeedInvoice {
  num: string;
  client: string;
  phone?: string;
  email?: string;
  amount: number;
  issue: number; // offset from today
  due: number;
  status: Status;
  source: 'claude' | 'web';
  created: Date;
  notes?: string;
  items?: [string, number][];
  promise?: number;
  paid?: { at: Date; amount?: number; ref?: string };
  events: Ev[];
  nudges?: SeedNudge[];
}

const INVOICES: SeedInvoice[] = [
  {
    num: 'INV-087', client: 'Mehta Consulting LLP', phone: '+91 98200 11223', email: 'accounts@mehtaconsulting.in',
    amount: 55000, issue: -79, due: -64, status: 'sent', source: 'claude', created: at(45, 14),
    notes: 'Brand strategy workshop, August', items: [['Workshop facilitation (2 days)', 40000], ['Strategy deck', 15000]],
    events: [
      { type: 'invoice_edited', source: 'web', at: at(45, 16), meta: { changes: { amount_paise: { from: toPaise(50000), to: toPaise(55000) } } } },
    ],
    nudges: [
      { channel: 'whatsapp', tone: 'friendly', at: at(40, 10), message: 'Hi Mr. Mehta, hope all is well! A gentle reminder that INV-087 for ₹55,000 (August strategy workshop) is now overdue. Could you please arrange the payment when convenient? Thank you!' },
      { channel: 'email', tone: 'firm', at: at(25, 10), message: 'Dear Mr. Mehta,\n\nFollowing up on INV-087 for ₹55,000, which is now over seven weeks past its due date. We have not received a response to our earlier reminder.\n\nCould you please confirm a payment date this week? The pay link below has UPI details.\n\nWarm regards,\nPixel & Pine Studio' },
    ],
  },
  {
    num: 'INV-089', client: 'Kaveri Textiles', phone: '+91 94430 55678', amount: 125000, issue: -50, due: -38,
    status: 'disputed', source: 'claude', created: at(43, 15),
    notes: 'Diwali campaign creatives', items: [['Campaign key visual', 60000], ['Social adaptations (12)', 36000], ['Hoarding banners (3)', 29000]],
    events: [
      { type: 'page_viewed', source: 'client', at: at(30, 18) },
      { type: 'issue_raised', source: 'client', at: at(30, 18, 6), meta: { message: 'The 3 hoarding banners were cancelled on our call. Amount should be ₹96,000, not ₹1,25,000.' } },
    ],
    nudges: [
      { channel: 'whatsapp', tone: 'friendly', at: at(31, 11), message: 'Hi Kaveri team! Quick reminder that INV-089 for ₹1,25,000 for the Diwali campaign creatives is now due. Let me know if you need anything from my side. Thanks!' },
    ],
  },
  {
    num: 'INV-090', client: 'Nimbus Labs', phone: '+91 99000 22334', email: 'finance@nimbuslabs.io', amount: 64500,
    issue: -35, due: -20, status: 'paid', source: 'claude', created: at(40, 12), promise: -17,
    notes: 'Website redesign: milestone 2', paid: { at: at(17, 16), ref: '431208765412' },
    events: [
      { type: 'page_viewed', source: 'client', at: at(19, 9) },
      { type: 'promise_made', source: 'client', at: at(19, 9, 3), meta: { promise_date: d(-17) } },
      { type: 'marked_paid', source: 'client', at: at(17, 16), meta: { reference: '431208765412', amount_paise: toPaise(64500) } },
    ],
    nudges: [
      { channel: 'whatsapp', tone: 'firm', at: at(19, 8, 30), message: 'Hi Rohan, INV-090 for ₹64,500 (website milestone 2) was due yesterday. Could you share an expected payment date? Pay link below. Thanks!' },
    ],
  },
  {
    num: 'INV-091', client: 'Orbit Media Works', phone: '+91 97111 45670', amount: 90000, issue: -30, due: -15,
    status: 'promised', source: 'claude', created: at(30, 11), promise: 3, notes: 'Video edit: product launch series (3 films)',
    events: [
      { type: 'page_viewed', source: 'client', at: at(6, 20) },
      { type: 'promise_made', source: 'client', at: at(6, 20, 4), meta: { promise_date: d(3) } },
    ],
    nudges: [
      { channel: 'whatsapp', tone: 'friendly', at: at(7, 10), message: 'Hi Ananya! Hope the launch went well. A reminder that INV-091 for ₹90,000 for the launch films is past due. Could you let me know when it can be processed? Thank you!' },
    ],
  },
  {
    num: 'INV-092', client: 'Bluefin Foods Pvt Ltd', phone: '+91 98450 67890', email: 'ap@bluefinfoods.in', amount: 42000,
    issue: -26, due: -12, status: 'promised', source: 'claude', created: at(26, 14), promise: -4,
    notes: 'Packaging design: snack range', items: [['Packaging design (3 SKUs)', 36000], ['Print-ready files', 6000]],
    events: [
      { type: 'page_viewed', source: 'client', at: at(9, 13) },
      { type: 'promise_made', source: 'client', at: at(9, 13, 2), meta: { promise_date: d(-4) } },
    ],
    nudges: [
      { channel: 'whatsapp', tone: 'friendly', at: at(10, 11), message: 'Hi Vikram, a gentle reminder that INV-092 for ₹42,000 (snack packaging) is now past due. Could you please process it this week? Thanks so much!' },
    ],
  },
  {
    num: 'INV-093', client: 'Sharma & Sons Hardware', phone: '+91 93123 98765', amount: 18000, issue: -20, due: -5,
    status: 'paid', source: 'web', created: at(20, 17), notes: 'Shop signage + visiting cards',
    paid: { at: at(7, 12), ref: 'NEFT N2849173' },
    events: [{ type: 'marked_paid', source: 'web', at: at(7, 12), meta: { reference: 'NEFT N2849173', amount_paise: toPaise(18000) } }],
  },
  {
    num: 'INV-094', client: 'Patel Design Co', phone: '+91 90040 33445', amount: 36000, issue: -16, due: -6,
    status: 'viewed', source: 'claude', created: at(16, 10), notes: 'Illustrations for annual report',
    events: [{ type: 'page_viewed', source: 'client', at: at(2, 21) }],
    nudges: [
      { channel: 'whatsapp', tone: 'friendly', at: at(3, 10), message: 'Hi Nisha! Just a friendly nudge that INV-094 for ₹36,000 (annual report illustrations) is a few days past due. Pay link below whenever convenient. Thanks!' },
    ],
  },
  {
    num: 'INV-095', client: 'Greenleaf Organics', phone: '+91 98765 12000', email: 'hello@greenleaf.co.in', amount: 27500,
    issue: -5, due: 9, status: 'sent', source: 'claude', created: at(5, 15), notes: 'Monthly social media retainer, November',
    events: [],
  },
  {
    num: 'INV-096', client: 'Lotus Events', amount: 15000, issue: 0, due: 20, status: 'draft', source: 'web', created: at(1, 18),
    notes: 'Wedding invite suite (draft, awaiting final count)', events: [],
  },
  {
    num: 'INV-088', client: 'Zenith Apps', amount: 8000, issue: -45, due: -30, status: 'cancelled', source: 'web', created: at(45, 9),
    notes: 'App icon set (project dropped)',
    events: [{ type: 'invoice_edited', source: 'web', at: at(33, 10), meta: { changes: { status: { from: 'sent', to: 'cancelled' } } } }],
  },
];

async function main() {
  await migrate();
  const demo = await ensureDemoUser();
  const signup = at(45, 8, 30);

  await tx(async (c) => {
    await c.query('DELETE FROM invoices WHERE user_id = $1', [demo.id]); // cascades to nudges + invoice events
    await c.query('DELETE FROM events WHERE user_id = $1', [demo.id]);
    await c.query('UPDATE users SET created_at = $2 WHERE id = $1', [demo.id, signup]);

    const ev = (invoiceId: number | null, type: EventType, source: Source, when: Date, meta: Record<string, unknown> = {}) =>
      c.query('INSERT INTO events (user_id, invoice_id, type, source, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        demo.id, invoiceId, type, source, JSON.stringify(meta), when,
      ]);

    await ev(null, 'mcp_connected', 'claude', at(45, 11), { first_tool: 'create_invoice' });

    for (const s of INVOICES) {
      const amount = toPaise(s.amount);
      const { rows } = await c.query(
        `INSERT INTO invoices (user_id, invoice_number, client_name, client_email, client_phone, amount_paise, issue_date, due_date,
           line_items, notes, status, promise_date, paid_amount_paise, paid_reference, paid_at, pay_token, source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING id`,
        [
          demo.id, s.num, s.client, s.email ?? null, s.phone ?? null, amount, d(s.issue), d(s.due),
          JSON.stringify((s.items ?? []).map(([description, a]) => ({ description, amount_paise: toPaise(a) }))),
          s.notes ?? null, s.status, s.promise !== undefined ? d(s.promise) : null,
          s.paid ? toPaise(s.paid.amount ?? s.amount) : null, s.paid?.ref ?? null, s.paid?.at ?? null,
          newPayToken(), s.source, s.created,
        ],
      );
      const id = rows[0].id as number;
      await ev(id, 'invoice_created', s.source, s.created, { invoice_number: s.num, amount_paise: amount });
      for (const n of s.nudges ?? []) {
        const nr = await c.query('INSERT INTO nudges (invoice_id, channel, tone, message, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
          id, n.channel, n.tone, n.message, n.at,
        ]);
        await ev(id, 'nudge_saved', 'claude', n.at, { nudge_id: nr.rows[0].id, channel: n.channel, tone: n.tone });
      }
      for (const e of s.events) await ev(id, e.type, e.source, e.at, e.meta);
    }

    for (const daysAgo of [21, 9, 2]) await ev(null, 'summary_requested', 'claude', at(daysAgo, 9, 15), { priority_count: 4 });
  });

  console.log(`Seeded ${INVOICES.length} invoices for ${DEMO_EMAIL} (connector token unchanged).`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('Seed failed:', e.message);
  await pool.end();
  process.exit(1);
});
