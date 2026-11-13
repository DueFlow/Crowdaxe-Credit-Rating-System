-- Crowdaxe CRS: database login for the application (least privilege).
-- Run once per database, as the database owner (Supabase: SQL editor, role "postgres"), AFTER the first
-- `prisma migrate deploy` (migration 0002 creates the crs_app role without a login).
--
-- Replace the password with a long random value (for example: openssl rand -base64 32) and keep it only in
-- the hosting provider's environment variables (DATABASE_URL). Never commit it.

ALTER ROLE crs_app WITH LOGIN PASSWORD 'REPLACE-WITH-A-LONG-RANDOM-PASSWORD' NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Check: crs_app holds data privileges only.
SELECT rolname, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = 'crs_app';
