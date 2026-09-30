-- One-off migration for a database created before submissions had a makushita column (Sept 2026):
--   npx wrangler d1 execute banzuke-guesser --remote --file functions/migrate-makushita.sql
-- Adds the optional prediction of the top of Makushita (see schema.sql). Existing rows keep NULL:
-- none saved. Apply it BEFORE deploying the code that uses it, which reads the column.
ALTER TABLE submissions ADD COLUMN makushita TEXT;
