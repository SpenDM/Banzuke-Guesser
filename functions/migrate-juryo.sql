-- One-off migration for a database created before submissions had a juryo column (Sept 2026):
--   npx wrangler d1 execute banzuke-guesser --remote --file functions/migrate-juryo.sql
-- Adds the optional Juryo prediction (see schema.sql). Existing rows keep NULL: no Juryo saved.
-- Safe to apply before the code that uses it is deployed: the old code names its columns.
ALTER TABLE submissions ADD COLUMN juryo TEXT;
