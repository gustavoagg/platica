-- ═══════════════════════════════════════════════════════════
-- PLATICA — Supabase Database Setup
-- Run this in your Supabase SQL Editor (https://supabase.com)
-- ═══════════════════════════════════════════════════════════

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'admin')),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Transactions table (unified, with type-specific columns)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('zelle', 'uruguay', 'transfer')),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT,

  -- ── Zelle fields ──
  account_id UUID REFERENCES accounts(id),
  direction TEXT CHECK (direction IN ('income', 'expense')),
  amount NUMERIC,           -- USD amount (always positive)
  commission NUMERIC DEFAULT 0,  -- USD flat commission

  -- ── Uruguay fields (2-Step model) ──
  usd_amount NUMERIC,           -- USD amount transferred
  itau_rate NUMERIC,            -- ITAU official USD -> UYU rate
  binance_usdt_rate NUMERIC,    -- Binance UYU -> USDT rate
  rate_diff NUMERIC,            -- Binance rate - ITAU rate
  commission_usd NUMERIC,       -- Extra commission USD: (rate_diff / itau_rate) * usd_amount
  total_uy_deducted NUMERIC,    -- usd_amount + commission_usd
  usdt_amount NUMERIC,          -- Resulting USDT
  step1_date TIMESTAMPTZ,       -- Step 1 date
  
  -- Step 2 (USDT -> Bs, optional on creation)
  usdt_p2p_rate NUMERIC,        -- P2P rate (Bs per USDT)
  bs_amount NUMERIC,            -- Final Bs amount: usdt_amount * usdt_p2p_rate
  step2_date TIMESTAMPTZ,       -- Step 2 date
  step2_completed BOOLEAN DEFAULT FALSE,

  -- ── Transfer fields ──
  from_account_id UUID REFERENCES accounts(id),
  to_account_id UUID REFERENCES accounts(id),
  transfer_amount NUMERIC,  -- USD being transferred
  commission_from NUMERIC,  -- % commission on origin side
  commission_to NUMERIC,    -- % commission on destination side
  amount_deducted NUMERIC,  -- Total deducted from origin
  net_received NUMERIC,     -- Net amount received at destination

  -- ── Audit ──
  created_by TEXT NOT NULL,
  modified_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations for existing deployments
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS itau_rate NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS binance_usdt_rate NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rate_diff NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS commission_usd NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_uy_deducted NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS step1_date TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS usdt_p2p_rate NUMERIC;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS step2_date TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS step2_completed BOOLEAN DEFAULT FALSE;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- 5. Disable RLS
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- INITIAL DATA
-- ═══════════════════════════════════════════════════════════

INSERT INTO users (username, password, role, display_name) VALUES
  ('oswaldo', 'pirata', 'viewer', 'Oswaldo'),
  ('sonia', 'negrita', 'admin', 'Sonia'),
  ('gus', 'gonzalez', 'admin', 'Gus')
ON CONFLICT (username) DO NOTHING;

INSERT INTO accounts (name, currency, initial_balance) VALUES
  ('Zelle', 'USD', 10000),
  ('Uruguay', 'USD', 0)
ON CONFLICT (name) DO NOTHING;

-- Trigger for auto updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
