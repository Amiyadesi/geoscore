PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS site_passes (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  email TEXT,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  stripe_customer_id TEXT,
  price_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reruns_total INTEGER NOT NULL DEFAULT 3,
  reruns_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'refunded')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_site_passes_domain_expires
  ON site_passes(domain, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_passes_session
  ON site_passes(stripe_session_id);
