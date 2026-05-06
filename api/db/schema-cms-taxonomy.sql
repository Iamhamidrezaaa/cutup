-- CMS taxonomies (pages + posts) and content links

CREATE TABLE IF NOT EXISTS cms_taxonomies (
  id BIGSERIAL PRIMARY KEY,
  content_type VARCHAR(16) NOT NULL,
  taxonomy_kind VARCHAR(16) NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  parent_id BIGINT REFERENCES cms_taxonomies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_taxonomies_content_type_check CHECK (content_type IN ('pages', 'posts')),
  CONSTRAINT cms_taxonomies_kind_check CHECK (taxonomy_kind IN ('category', 'tag'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_taxonomies_unique_slug
  ON cms_taxonomies (content_type, taxonomy_kind, slug);

CREATE INDEX IF NOT EXISTS idx_cms_taxonomies_parent ON cms_taxonomies (parent_id);

CREATE TABLE IF NOT EXISTS cms_content_taxonomy (
  id BIGSERIAL PRIMARY KEY,
  content_type VARCHAR(16) NOT NULL,
  entity_id BIGINT NOT NULL,
  taxonomy_id BIGINT NOT NULL REFERENCES cms_taxonomies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_content_taxonomy_type_check CHECK (content_type IN ('pages', 'posts'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_content_taxonomy_unique
  ON cms_content_taxonomy (content_type, entity_id, taxonomy_id);

CREATE INDEX IF NOT EXISTS idx_cms_content_taxonomy_tax ON cms_content_taxonomy (taxonomy_id);
