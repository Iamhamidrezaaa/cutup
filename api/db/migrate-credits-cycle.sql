-- Billing-cycle tracking for processing credits (minutes_used column = credits used)
ALTER TABLE usage ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMPTZ;
