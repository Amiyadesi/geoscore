CREATE TABLE IF NOT EXISTS domain_overrides (
  domain      TEXT PRIMARY KEY,
  vertical    TEXT,
  location    TEXT,
  confidence  INTEGER DEFAULT 1,
  source      TEXT DEFAULT 'user',
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT NOT NULL,
  module          TEXT NOT NULL,
  field           TEXT NOT NULL,
  reported_value  TEXT,
  correct_value   TEXT,
  created_at      INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_feedback_domain ON feedback(domain);
CREATE INDEX IF NOT EXISTS idx_feedback_module ON feedback(module, created_at);

CREATE TABLE IF NOT EXISTS learning_patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_type    TEXT NOT NULL,
  trigger_signal  TEXT,
  correction      TEXT,
  example_domains TEXT,
  confidence      INTEGER DEFAULT 1,
  applied         INTEGER DEFAULT 0,
  created_at      INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS accuracy_metrics (
  week        TEXT NOT NULL,
  module      TEXT NOT NULL,
  total       INTEGER DEFAULT 0,
  corrections INTEGER DEFAULT 0,
  PRIMARY KEY (week, module)
);
