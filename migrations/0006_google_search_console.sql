CREATE TABLE IF NOT EXISTS google_search_console_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token_ciphertext TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
