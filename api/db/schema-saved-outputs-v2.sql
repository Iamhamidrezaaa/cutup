-- Saved Outputs V2 — collections, download counts, library search support

CREATE TABLE IF NOT EXISTS saved_output_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_output_collections_user
  ON saved_output_collections(user_id, lower(name));

ALTER TABLE saved_outputs
  ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES saved_output_collections(id) ON DELETE SET NULL;

ALTER TABLE saved_outputs
  ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_collection
  ON saved_outputs(collection_id) WHERE collection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_user_downloads
  ON saved_outputs(user_id, download_count DESC);

ALTER TABLE project_exports
  ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;
