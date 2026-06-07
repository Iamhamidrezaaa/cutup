-- Stripe billing period start (renewal / credit reset tracking)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
