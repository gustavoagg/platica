-- ═══════════════════════════════════════════════════════════
-- PLATICA — Supabase Database Setup
-- Run this in your Supabase SQL Editor (https://supabase.com)
-- ═══════════════════════════════════════════════════════════

-- 1. Users table (simple auth, no Supabase Auth)
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

  -- ── Uruguay fields ──
  usd_amount NUMERIC,       -- USD amount to withdraw
  exchange_rate NUMERIC,     -- USD → UYU official rate
  uyu_amount NUMERIC,       -- Calculated: usd_amount * exchange_rate
  binance_commission NUMERIC,-- Binance fee (percentage)
  usdt_amount NUMERIC,      -- USDT after Binance fee
  p2p_commission NUMERIC,   -- P2P fee (percentage)
  bs_amount NUMERIC,        -- Final Bs amount

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

-- 4. Index for fast chronological queries
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- 5. Disable RLS (security is basic, handled at app level)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- INITIAL DATA
-- ═══════════════════════════════════════════════════════════

-- Users
INSERT INTO users (username, password, role, display_name) VALUES
  ('oswaldo', 'pirata', 'viewer', 'Oswaldo'),
  ('sonia', 'negrita', 'admin', 'Sonia'),
  ('gus', 'gonzalez', 'admin', 'Gus')
ON CONFLICT (username) DO NOTHING;

-- Accounts
INSERT INTO accounts (name, currency, initial_balance) VALUES
  ('Zelle', 'USD', 10000),
  ('Uruguay', 'USD', 0)
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- HELPER FUNCTION: Auto-update updated_at timestamp
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
