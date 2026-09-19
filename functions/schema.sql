-- Apply once:
--   npx wrangler d1 execute banzuke-guesser --remote --file functions/schema.sql
-- (A database created before the users table existed: run functions/migrate-users.sql instead.)

-- One row per registered user. `user_id` is the browser token (see getToken() in
-- public/js/storage.js) or, once signed in, `fb:<Firebase uid>`; a shikona belongs to one user
-- across every round.
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  shikona       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  provider      TEXT,            -- Firebase sign-in provider (google.com, password, …) or NULL
  registered_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- One prediction per user per round. `basho_id` is the tournament being predicted (the one whose
-- banzuke the guess is scored against), `placements` the JSON list of {slot, key, rikishi_id, name}.
-- `shikona` mirrors users.shikona (kept in step on rename) so the leaderboard needs no join.
CREATE TABLE IF NOT EXISTS submissions (
  basho_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  shikona      TEXT NOT NULL,
  placements   TEXT NOT NULL,
  ip           TEXT,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (basho_id, user_id)
);
