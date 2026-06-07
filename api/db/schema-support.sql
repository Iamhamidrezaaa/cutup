-- Cutup Support Center V1

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START 1000;

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGSERIAL PRIMARY KEY,
  ticket_number VARCHAR(32) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_admin_id BIGINT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  first_response_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL,
  sender_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  sender_admin_id BIGINT NULL REFERENCES admins(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  attachments JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_notes (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  admin_id BIGINT NULL REFERENCES admins(id) ON DELETE SET NULL,
  admin_email TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON support_tickets (ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_department ON support_tickets (department);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_notes_ticket ON support_ticket_notes (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket ON support_ticket_events (ticket_id, created_at DESC);
