-- Duely v1 schema. Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  business_name  TEXT NOT NULL,
  upi_id         TEXT,
  mcp_token      TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_number     TEXT NOT NULL,
  client_name        TEXT NOT NULL,
  client_email       TEXT,
  client_phone       TEXT,
  amount_paise       BIGINT NOT NULL CHECK (amount_paise > 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  issue_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date           DATE NOT NULL,
  line_items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('draft','sent','viewed','promised','paid','disputed','cancelled')),
  promise_date       DATE,
  paid_amount_paise  BIGINT,
  paid_reference     TEXT,
  paid_at            TIMESTAMPTZ,
  pay_token          TEXT NOT NULL UNIQUE,
  source             TEXT NOT NULL CHECK (source IN ('claude','web')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS invoices_user_status_idx ON invoices (user_id, status);

CREATE TABLE IF NOT EXISTS nudges (
  id          BIGSERIAL PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  tone        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nudges_invoice_idx ON nudges (invoice_id);

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id  BIGINT REFERENCES invoices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('invoice_created','invoice_edited','page_viewed','promise_made',
                'marked_paid','issue_raised','nudge_saved','summary_requested','mcp_connected')),
  source      TEXT NOT NULL CHECK (source IN ('claude','web','client','system')),
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_user_type_idx ON events (user_id, type);
CREATE INDEX IF NOT EXISTS events_invoice_idx ON events (invoice_id);
