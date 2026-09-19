-- One-off migration for a database created before the users table (schema.sql of Sept 2026):
--   npx wrangler d1 execute banzuke-guesser --remote --file functions/migrate-users.sql
-- 1. Creates users, registering every token that has submitted under the shikona of its latest
--    submission. Where two tokens used the same shikona in different rounds, the more recently
--    active one keeps it (INSERT OR IGNORE); the other is unregistered and picks a new one.
-- 2. Rebuilds submissions without UNIQUE (basho_id, shikona): uniqueness now lives in users.
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  shikona       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  provider      TEXT,
  registered_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT OR IGNORE INTO users (user_id, shikona, provider, registered_at, updated_at)
  SELECT user_id, shikona, NULL, MAX(submitted_at), MAX(submitted_at)
  FROM submissions GROUP BY user_id ORDER BY MAX(submitted_at) DESC;

CREATE TABLE submissions_new (
  basho_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  shikona      TEXT NOT NULL,
  placements   TEXT NOT NULL,
  ip           TEXT,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (basho_id, user_id)
);
INSERT INTO submissions_new SELECT basho_id, user_id, shikona, placements, ip, submitted_at FROM submissions;
DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;
