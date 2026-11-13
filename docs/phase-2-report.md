# Phase 2 report: database and migration

Date: 13 November 2026.

## Built

| Part | Contents |
|---|---|
| `packages/db/prisma/schema.prisma` | 36 tables: identity and audit (users, roles, sessions, login events, invitations, password resets, audit log), versioned methodology (parameter sets and their 12 tables), business data (companies, deals, ratings, rating inputs, results and checks, overrides, comments, Deal Activity, opening-balance history, Screening Notes), housekeeping (import runs, system status, settings, changelog). |
| Migration `0001_init` | The schema. |
| Migration `0002_controls_and_security` | One Active parameter set (unique index); a parameter set's tables can change only while it is a Draft; Final and Superseded ratings, their inputs, results and checks cannot be changed or deleted (only Final → Superseded); value checks; least-privilege role `crs_app` (data only; insert-only audit log and login history; no access to the migration history); Row Level Security on every table with one policy for `crs_app`. |
| `packages/db/src` | Parameter sets ↔ engine documents (exact round trip, content hash, activation); live Deal History snapshot (Deal Activity + opening-balance records, D-01/D-02/D-33); workbook loader with dry run and reconciliation report; exact-precision writes for rating documents; seed. |
| `tools/import` | Workbook reader (exceljs) and the `crs-import` CLI. |
| `ops/sql` | `roles.sql` and the database access guide for Supabase. |
| `docker-compose.yml`, `.env.example` | Development database; every variable documented. |
| CI | New job with a PostgreSQL 16 service runs the database and importer tests. |

## Tested

| Suite | Tests | Result |
|---|---|---|
| Parameter sets: round trip of set 1.1 is identical to the engine document; hash; draft-only edits; single Active set; invalid sets refused | 4 | pass |
| Loader: dry run writes nothing; apply; all 7 stored ratings re-run from the database to their exact stored result; live Deal History equals the stored snapshot; opening-balance records; re-run changes nothing; Final ratings frozen; same version with different rules refused; new version imported as Proposed; a non-reproducing rating or a wrong Override Log row stops the import; Deal History or Blacklist rows not explained by Deal Activity are reported; methodology-only import | 12 | pass |
| Security: RLS and the `crs_app` policy on all 36 tables; app role can read and write data; cannot change the schema, read migration history, or update/delete the audit log; a role without the policy (like Supabase `anon`) sees no rows and cannot insert even with table grants | 4 | pass |
| Seed: reference data idempotent; development seed marked SEED | 2 | pass |
| Importer: reads the workbook identically to the Phase 1 extraction (parameter set, ratings, activity, history, blacklist) and reads the Pipeline Register, Override Log and Changelog; refuses a wrong workbook or a changed layout | 6 | pass (4 need the workbook: skipped in CI) |
| Engine (unchanged) | 1,268 | pass |

Import of Workbook 1.1: 3 companies, 6 deals, 26 events, 7 ratings, 91 checks, 1 override, 1 changelog row; all totals (EL, EAD, amounts paid and due, grades) match; all 7 ratings reproduce; 1 rating Superseded (CX-2026-005, the October New rating, by the November Review). Re-run: everything unchanged. Database size after import: 10 MB (most of it PostgreSQL's own catalogue).

## Decisions taken in this phase (for your information)

1. **Prisma 6.19**, not 7: Prisma 6's pooled `DATABASE_URL` plus `DIRECT_URL` model is exactly the Supabase set-up in your brief; Prisma 7 changes it. Upgrading later is a contained change.
2. **Exact numbers in stored ratings.** Prisma's JSON write path rounds to 15 significant digits. A stored result would then differ in the last bit from a re-run, so rating documents are written with plain SQL (`ratingDocuments.ts`); a test proves every stored rating re-runs to an identical result.
3. **Deal History is derived on read, not cached** (architecture section 8.3 mentioned a cache table). With live days past due (D-02) a cache would be stale the next day; deriving from a company's events takes milliseconds.
4. **Production imports the methodology only** (`--methodology-only`), because the workbook's companies are test data. Development uses them as seed data, marked `SEED`.
5. Sort columns on the methodology tables keep the workbook's row order, so Admin screens and documents show tables in the familiar order.

## Outstanding

* Users and authentication: tables exist; the logic is Phase 3.
* The repository is **public** (see below).
