-- EUR→IRR snapshots (Navasan daily refresh + runtime cache)
CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
  pair VARCHAR(32) PRIMARY KEY DEFAULT 'EUR_IRR',
  rate_irr NUMERIC(20, 4) NOT NULL,
  rate_raw TEXT,
  source VARCHAR(64) NOT NULL,
  navasan_item VARCHAR(64),
  change_24h NUMERIC(14, 4),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_fx_rate_snapshots_fetched
  ON fx_rate_snapshots (fetched_at DESC);
