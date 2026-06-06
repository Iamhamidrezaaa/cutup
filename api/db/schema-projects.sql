-- Cutup Projects + export history (PostgreSQL)
-- Applied by migrate.mjs after schema.sql

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  source_url TEXT,
  source_filename TEXT,
  platform VARCHAR(32),
  language VARCHAR(32),
  thumbnail_url TEXT,
  transcript_status VARCHAR(32) NOT NULL DEFAULT 'none',
  export_status VARCHAR(32) NOT NULL DEFAULT 'none',
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  workspace_snapshot JSONB,
  search_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ,
  CONSTRAINT projects_transcript_status_check
    CHECK (transcript_status IN ('none', 'in_progress', 'ready')),
  CONSTRAINT projects_export_status_check
    CHECK (export_status IN ('none', 'in_progress', 'exported', 'failed')),
  CONSTRAINT projects_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON projects(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_user_lifecycle_updated
  ON projects(user_id, lifecycle_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_user_source_url
  ON projects(user_id, source_url);

CREATE INDEX IF NOT EXISTS idx_projects_search_text
  ON projects USING gin (to_tsvector('simple', COALESCE(search_text, '')));

ALTER TABLE saved_outputs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_project
  ON saved_outputs(project_id, type);

CREATE TABLE IF NOT EXISTS project_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  render_job_id VARCHAR(96) NOT NULL,
  preset_id VARCHAR(64),
  preset_name TEXT,
  quality VARCHAR(16),
  caption_mode VARCHAR(16),
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  source_url TEXT,
  output_filename TEXT,
  file_size_bytes BIGINT,
  video_duration_sec DOUBLE PRECISION,
  render_duration_sec DOUBLE PRECISION,
  resolution TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_exports_status_check
    CHECK (status IN ('queued', 'rendering', 'completed', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_exports_render_job
  ON project_exports(render_job_id);

CREATE INDEX IF NOT EXISTS idx_project_exports_user_created
  ON project_exports(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_exports_project_created
  ON project_exports(project_id, created_at DESC);
