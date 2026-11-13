# Database access model

| Role                                        | Used by                                                         | Can                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` (Supabase) or the database owner | `prisma migrate deploy` (`DIRECT_URL`), backups, the import CLI | everything                                                                                                                        |
| `crs_app`                                   | the web application (`DATABASE_URL`)                            | read and write data in application tables; insert-only on `audit_log` and `login_events`; nothing on `_prisma_migrations`; no DDL |
| `anon`, `authenticated` (Supabase)          | nothing                                                         | nothing: every table has Row Level Security with a single policy for `crs_app`                                                    |

Set-up on a new database (Supabase or any PostgreSQL):

1. Run the migrations with the owner's direct connection: `DIRECT_URL=… DATABASE_URL=… pnpm --filter @crowdaxe/db migrate:deploy`.
2. Run `roles.sql` (with a new password) to let `crs_app` log in.
3. Point the app's `DATABASE_URL` at `crs_app` (Supabase: the pooled connection string on port 6543 with `?pgbouncer=true&connection_limit=1`, user `crs_app.<project-ref>`).
4. Supabase only: Project Settings → Data API → switch off "Enable Data API" (the tables would show nothing anyway, because of RLS).
5. Load the methodology: `crs-import --file Crowdaxe_CRS.xlsm --methodology-only --apply` and the reference data: `pnpm --filter @crowdaxe/db seed -- --reference-only`.

Every new table must enable RLS and create the `crs_app` policy in its migration; `packages/db/test/security.test.ts` fails otherwise.
