CREATE TABLE IF NOT EXISTS businesses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  domain       TEXT UNIQUE,
  city         TEXT,
  country      TEXT,
  category     TEXT,
  lat          REAL,
  lon          REAL,
  osm_id       TEXT,
  gmaps_url    TEXT,
  phone        TEXT,
  address      TEXT,
  created_at   INTEGER DEFAULT (unixepoch()),
  updated_at   INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_businesses_domain ON businesses(domain);
CREATE INDEX IF NOT EXISTS idx_businesses_city_category ON businesses(city, category);

CREATE VIRTUAL TABLE IF NOT EXISTS businesses_fts USING fts5(
  name, city, category, content='businesses', content_rowid='id'
);

CREATE TABLE IF NOT EXISTS audits (
  id              TEXT PRIMARY KEY,
  business_id     INTEGER REFERENCES businesses(id),
  status          TEXT NOT NULL DEFAULT 'pending',
  foundation_score INTEGER,
  weakness_score   INTEGER,
  summary_json    TEXT,
  full_json       TEXT,
  r2_snapshot_key TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  completed_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_audits_business_recent ON audits(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_modules (
  audit_id     TEXT REFERENCES audits(id),
  module       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  data_json    TEXT,
  error        TEXT,
  duration_ms  INTEGER,
  PRIMARY KEY (audit_id, module)
);

CREATE TABLE IF NOT EXISTS queries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vertical     TEXT NOT NULL,
  geo          TEXT NOT NULL,
  query        TEXT NOT NULL,
  query_type   TEXT,
  UNIQUE(vertical, geo, query)
);

CREATE TABLE IF NOT EXISTS citations (
  audit_id     TEXT REFERENCES audits(id),
  query_id     INTEGER REFERENCES queries(id),
  engine       TEXT NOT NULL,
  cited        INTEGER NOT NULL DEFAULT 0,
  cited_competitors TEXT,
  source       TEXT NOT NULL DEFAULT 'predicted',
  raw_response TEXT,
  PRIMARY KEY (audit_id, query_id, engine)
);

CREATE TABLE IF NOT EXISTS chat_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id     TEXT REFERENCES audits(id),
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(audit_id, session_id, created_at);
