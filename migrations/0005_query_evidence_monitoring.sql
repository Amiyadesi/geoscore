PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS monitor_projects (
  id TEXT PRIMARY KEY,
  root_domain TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  context_json TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  token_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  baseline_json TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verify_hash TEXT,
  email_verify_expires_at INTEGER,
  schedule TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule = 'weekly'),
  last_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (audit_id) REFERENCES audits(id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_projects_schedule
  ON monitor_projects(schedule, last_run_at);

CREATE TABLE IF NOT EXISTS monitor_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
  query TEXT NOT NULL,
  intent TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(project_id, position),
  UNIQUE(project_id, query),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monitor_queries_project
  ON monitor_queries(project_id, position);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('default', 'byok', 'weekly')),
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'error')),
  score_version TEXT,
  factual_score INTEGER,
  factual_coverage REAL,
  factual_confidence REAL,
  baseline_action TEXT,
  score_delta INTEGER,
  snapshot_id TEXT,
  error_code TEXT,
  alert_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (
    alert_status IN ('not_requested', 'baseline', 'suppressed', 'no_change', 'pending', 'sent', 'not_configured', 'failed')
  ),
  alert_error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_project_created
  ON monitor_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  answer_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monitor_snapshots_project_created
  ON monitor_snapshots(project_id, created_at DESC);
