-- Cutup Customer Operations Platform V3

-- SLA tracking on support tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_status VARCHAR(20) NULL DEFAULT 'healthy';

CREATE INDEX IF NOT EXISTS idx_support_tickets_sla_status ON support_tickets (sla_status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_sla_due ON support_tickets (sla_due_at);

-- Knowledge Base
CREATE TABLE IF NOT EXISTS help_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL,
  description TEXT NULL,
  icon VARCHAR(32) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS help_articles (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(120) NOT NULL UNIQUE,
  category_slug VARCHAR(64) NOT NULL REFERENCES help_categories(slug) ON UPDATE CASCADE,
  title VARCHAR(200) NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles (category_slug);
CREATE INDEX IF NOT EXISTS idx_help_articles_popular ON help_articles (is_popular) WHERE is_popular = TRUE;
CREATE INDEX IF NOT EXISTS idx_help_articles_updated ON help_articles (updated_at DESC);

-- RBAC foundation
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(96) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  module VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS admin_roles (
  admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_admin ON admin_roles (admin_id);
