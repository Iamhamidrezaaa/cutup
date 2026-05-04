-- Run once on existing DBs after switching app default currency to EUR.
-- New installs: schema.sql already uses DEFAULT 'EUR' on payments.currency.

ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'EUR';

UPDATE payments SET currency = 'EUR' WHERE UPPER(TRIM(currency)) = 'USD';
