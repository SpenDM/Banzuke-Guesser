-- One prediction per user per round. `basho_id` is the tournament being predicted (the one whose
-- banzuke the guess is scored against), `user_id` the browser token, `placements` the JSON list
-- of {slot, key, rikishi_id, name}. Apply once:
--   npx wrangler d1 execute banzuke-guesser --remote --file functions/schema.sql
CREATE TABLE IF NOT EXISTS submissions (
  basho_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  shikona      TEXT NOT NULL,
  placements   TEXT NOT NULL,
  ip           TEXT,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (basho_id, user_id),
  UNIQUE (basho_id, shikona COLLATE NOCASE)
);
