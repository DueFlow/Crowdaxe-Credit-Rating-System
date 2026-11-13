# Proposed architecture, database schema and phase plan

Phase 0 proposal for approval. Free-plan figures were checked on 13 November 2026 on the providers' own pages (sources at the end); they change, and each phase will re-check them.

---

## 1. Summary

* **Monorepo** (pnpm workspaces): `packages/engine` (pure TypeScript calculation engine), `apps/web` (Next.js App Router, server actions), `packages/db` (Prisma schema, migrations, seed), `tools/import` (workbook importer), `tools/oracle` (Phase 0 LibreOffice harness used to generate parity fixtures; dev only).
* **Stack as you proposed**, with four adjustments explained in section 2: database sessions behind Auth.js; storage through the S3 protocol so it is not tied to Supabase; Supabase region chosen to sit next to the app's functions; and an explicit plan for Netlify's credit limit.
* **Hosting:** Netlify Free for the app, Supabase Free for PostgreSQL and the private PDF bucket, GitHub Actions for keep-alive, nightly encrypted backups and CI. Docker and `docker-compose.yml` for any server later.
* **Key design decisions:** the engine is a pure function `rate(inputs, parameterSet, historySnapshot) → result`; every rating stores its inputs, history snapshot, full result and parameter set version, so a Final rating never changes; parameter sets are versioned as a whole and activated by IC approval.

---

## 2. Technology: what I keep and what I would change

| Your requirement | Proposal | Why |
|---|---|---|
| Next.js App Router, TypeScript, server actions | Keep. Next.js 15, React 19, strict TS. | – |
| PostgreSQL on Supabase via Prisma, portable | Keep. Plain Prisma + PostgreSQL only. No Supabase client in the data path. | – |
| Auth.js with email/password + optional Entra ID | Keep, with **database-backed sessions**: Auth.js's Credentials provider only supports JWT sessions, so I would issue a short-lived JWT that carries a session ID checked against a `sessions` table on every request. That gives server-side session timeout, "sign out everywhere", deactivation that takes effect immediately, and login history. Passwords hashed with argon2id (`@node-rs/argon2`, prebuilt binaries, works on Netlify). TOTP with `otplib`. | Revocation and timeout are needed for a credit tool; pure JWT cannot revoke. |
| Tailwind, shadcn/ui, react-hook-form + zod, TanStack Table, Recharts | Keep. The same zod schemas validate inputs in forms, server actions and the engine. | – |
| `@react-pdf/renderer` for the Screening Note | Keep. Renders in a Node function in about 0.3 to 1 s, well inside Netlify's 60 s limit and 1 GB memory. Avenir Next is only embedded if you have a web-embedding licence; otherwise Nunito Sans (open licence). | – |
| Pure TS engine with decimal.js where rounding matters | Keep, with one precision rule: arithmetic in IEEE doubles exactly as Excel does it, and Excel's `ROUND` replicated with decimal.js on the 15-significant-digit value (methodology-spec 1.3). Doing all arithmetic in decimal.js would **not** match Excel in the last digit before rounding. | Parity. |
| Supabase Storage, private bucket, signed URLs | Keep, but accessed through Supabase's **S3-compatible endpoint** with the AWS S3 SDK behind a small `FileStore` interface. Moving later to Azure Blob, Cloudflare R2 or MinIO is a config change. Signed URLs valid for 5 minutes, issued only after a permission check. | Portability, as you asked. |
| RLS on every table, or close the database to Supabase's public APIs | **Both:** disable the Data API (PostgREST) and GraphQL for the project, so tables are not reachable through Supabase's public endpoints at all; enable RLS with no policies on every table as a second lock (denies the `anon` and `authenticated` roles). The app connects as a dedicated least-privilege role `crs_app` (DML only on application tables, no DDL); migrations run as a separate `crs_migrator` role through `DIRECT_URL`. RLS is not used for application permissions; those are enforced in server code (section 6). | Simplest secure model; keeps the code plain PostgreSQL. |
| Free host that allows business use | **Netlify Free** (section 3). | Business use allowed, enough runtime. |

---

## 3. Hosting options checked

| Option | Business use on free plan | Limits that matter | Verdict |
|---|---|---|---|
| **Netlify Free** | Netlify's Terms of Use and Self-Serve Subscription Agreement contain no personal or non-commercial restriction (checked the November 2026 agreement). | 300 credits a month: production deploy 15 credits, 20 credits per GB bandwidth, 2 credits per 10,000 requests, 10 credits per GB-hour of functions. Functions: 60 s synchronous limit, 1 GB memory. **When credits run out, all sites are paused** until the next month. Function region fixed at US East (Ohio) on Free; region choice needs Pro. | **Recommended.** Our load (a handful of analysts) uses a few credits a day. The real constraint is ~20 production deploys a month: I will deploy to production only from tagged releases, use free deploy previews for testing, and show credits used on System health with an 80% warning. |
| Cloudflare Workers Free (OpenNext) | Allowed. | **10 ms CPU per request**, 3 MiB compressed Worker size (Free). Argon2 password hashing, PDF rendering and a full rating calculation each need more than 10 ms of CPU; a Next.js app with Prisma and react-pdf will not fit in 3 MiB. | Rejected for Free. Fine on the $5 paid plan later. |
| Oracle Cloud Always Free (Docker on a VM) | Allowed. | Ampere A1 allowance was halved in 2026 to 2 OCPU / 12 GB; capacity is often unavailable; idle instances can be reclaimed; Crowdaxe would run OS patching, TLS and monitoring itself; needs a card on file to sign up. | Fallback only. The Dockerfile keeps this open. |
| Vercel Hobby | Not allowed (personal, non-commercial only). | – | Excluded, as you said. |

### Database region

Supabase has **no African region**. The nearest to Harare are Frankfurt (`eu-central-1`), London (`eu-west-2`) and Mumbai (`ap-south-1`). However, on Netlify Free every server function runs in **Ohio**, and each page makes several database queries; a Frankfurt database would add about 90 to 100 ms per query (several hundred ms per page), while an Ohio database (`us-east-2`) adds about 1 ms. A user in Harare pays the trans-Atlantic distance once per page either way.

**Recommendation:** Supabase `us-east-2` (Ohio) while on Netlify Free; when Crowdaxe upgrades to Netlify Pro, move both functions and database to Frankfurt or London together (documented in `upgrade-guide.md`). **Decision needed:** this puts data in the United States; Legal & Compliance should look at it against the Cyber and Data Protection Act's cross-border transfer rules (it is listed in `data-protection.md`). If you prefer Europe now, I will use Frankfurt and accept slower pages.

### Email

Resend Free: 3,000 emails a month, **100 a day**, 1 domain-verified sender. Brevo Free: similar daily limit with Brevo branding in the footer. Crowdaxe's Microsoft 365 through Microsoft Graph (`Mail.Send` with an app registration limited to one mailbox) costs nothing extra and keeps mail inside your tenant, but needs your M365 admin to create the app registration. **Decision needed** (you asked me to ask): my recommendation is Microsoft 365 if your admin can do the app registration, otherwise Resend. Both sit behind one `Mailer` interface.

---

## 4. Repository layout

```
crowdaxe-crs/
  apps/web/                 Next.js app (UI, server actions, route handlers, auth, PDF)
  packages/engine/          pure TS engine: types, parameter-set schema, calculation, checks, Excel rounding, tests
  packages/db/              Prisma schema, migrations, seed (sample data, clearly marked), repositories
  tools/import/             workbook importer (dry run + reconciliation report)
  tools/oracle/             LibreOffice parity harness (Phase 0/1 only, not deployed)
  ops/                      backup, restore and prune scripts; GitHub Actions workflows in .github/workflows
  docs/                     specifications, guides
  Dockerfile, docker-compose.yml, .env.example
```

---

## 5. Calculation engine (`packages/engine`)

```ts
rate(input: RatingInput, params: ParameterSet, ctx: RatingContext): RatingResult
// RatingContext = { historySnapshot: { regNo, counts by status, blacklist: 'Active'|'Lifted'|null }, today?: Date }
```

* `RatingInput`: the structured inputs of `data-inventory.md` section 1 (zod schema, versioned `schemaVersion`).
* `ParameterSet`: every scalar parameter and methodology table of `data-inventory.md` section 4, plus today's hard-coded constants as parameters (D-07). Validated by zod (weights sum to 1 per pillar and per blend, monotonic boundaries, grade table complete, and so on).
* `RatingResult`: every output in `data-inventory.md` section 2, including statuses and display strings, so the UI, the PDF and the exports never re-implement a rule.
* Also exported: `deriveDealHistory(events, asOf)`, `deriveBlacklist(events, asOf)`, `overrideRate(ratings, today, params)`, `nextDealId`, Excel helpers (`excelRound`, `edate`, Excel serial date conversion).
* No I/O, no dates from the clock unless passed in, no database or UI imports. Runs in the browser for the live summary panel and on the server for saving (the server result is the one stored).

**Parity tests (Vitest):**

1. All 102 TestCases expectations, case by case.
2. All 7 saved ratings, run from their `RatingInputs` with history rebuilt as at the rating date, asserting blended score, obligor model and final, facility model and final, PD, LGD, EAD, EL and recommendation (proved feasible in Phase 0: 7 of 7 match).
3. Golden fixtures generated by the LibreOffice oracle: a few hundred randomised and boundary input sets per module (interpolation at and around every boundary, N/A combinations, every modifier, every knockout and check), compared field by field. LibreOffice matched all 102 workbook checks, so it is a sound independent oracle.
4. Property tests (fast-check): grade rounding (.5 to weaker), two-decimal half-up, caps and floors, re-weighting sums to 1.
5. Coverage target over 95% for the engine.

---

## 6. Users, roles and permissions

Roles: Analyst, Reviewer, IC Approver, Admin, Viewer (a user can hold several). Every server action and route handler calls `authorize(user, permission, resource)`; the UI hides what the user cannot do but is never the control.

| Permission | Analyst | Reviewer | IC Approver | Admin | Viewer |
|---|---|---|---|---|---|
| View deals, ratings, pipeline, dashboards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit companies, deals, draft ratings, deal activity | ✓ | | | | |
| Submit / save Final (no errors) | ✓ (own) | | | | |
| Return or mark reviewed (if reviewer step on) | | ✓ (not own) | | | |
| Approve overrides above limit; approve/decline Final (if IC step on) | | | ✓ (not own) | | |
| Export Screening Note, Excel exports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit draft parameter sets, mark PROPOSED | | | | ✓ | |
| Approve/activate parameter sets | | | ✓ | | |
| Users, roles, switches, branding, audit log, self-test, system health | | | | ✓ | |

Segregation: nobody approves their own override or their own rating; an Admin cannot activate a parameter set they edited without an IC Approver. Accounts: invite by email, reset password, deactivate (never delete), password policy (12+ characters, breach-list check with k-anonymity optional), idle timeout 30 minutes and absolute 12 hours (configurable), lockout after 5 failed attempts for 15 minutes, login rate limit per IP and per account (stored in the database, no Redis), optional TOTP (can be made mandatory for Admin and IC Approver), Entra ID SSO switchable by environment variable and Admin switch.

---

## 7. Parameter sets and approval

* A **parameter set** is the whole methodology: scalars plus every table. Status: Draft → Proposed → Approved → Active (with effective date) → Retired. Exactly one Active set.
* An Admin creates a Draft by cloning any set, edits it through forms (no spreadsheets), and can mark individual rows PROPOSED (methodology status, as on the Parameters sheet today). The set is validated by the engine's zod schema before it can be proposed.
* An IC Approver approves it and sets the effective date; activation is a single transaction. Rollback = activate an earlier set (it becomes a new activation record; nothing is deleted).
* **Impact preview** before activation: re-run the latest Final rating of every deal under the proposed set with each rating's stored history snapshot and show changes to grades, PD, EL and recommendation.
* **Diff** between any two sets, row by row, per table.
* Ratings store `parameter_set_id`; a Final rating keeps its stored result forever. Draft ratings re-calculate under the Active set when opened (with a notice if the set changed since the draft was started).

---

## 8. Database schema (PostgreSQL via Prisma)

Conventions: UUID primary keys; human IDs (`CX-2026-001`, `R-20260112-101422`, `A-…`) as unique text columns; `created_at/by`, `updated_at/by` on mutable tables; money as `numeric(18,2)`, rates and scores as `numeric(12,6)` or exact text where the engine needs the double (stored results keep the engine's JSON); soft delete only where noted. All tables have RLS enabled with no policies (section 2).

### 8.1 Identity and audit

| Table | Key columns |
|---|---|
| `users` | id, email (unique, citext), name, password_hash, is_active, totp_secret (encrypted), totp_enabled, failed_logins, locked_until, last_login_at, entra_oid |
| `roles` | code (ANALYST, REVIEWER, IC_APPROVER, ADMIN, VIEWER), name |
| `user_roles` | user_id, role_code, granted_by, granted_at |
| `sessions` | id, user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at |
| `login_events` | user_id (nullable), email_tried, ip, success, reason, at |
| `invitations` / `password_resets` | token_hash, user_id/email, expires_at, used_at |
| `audit_log` | id, at, user_id, action, entity_type, entity_id, before (jsonb), after (jsonb), ip, request_id |

### 8.2 Methodology (versioned)

| Table | Key columns |
|---|---|
| `parameter_sets` | id, version (e.g. "1.1"), method_version, status, effective_date, cloned_from_id, created_by, proposed_at/by, approved_at/by, activated_at/by, notes |
| `parameters` | set_id, name, value_num, value_text, unit, methodology_ref, note, is_proposed, sort |
| `rating_scale` | set_id, grade, description, cx_scale, pd, appetite, review_months, review_cycle |
| `overlays` | set_id, ord, name, max_notches, descriptor_0, descriptor_1, descriptor_2 |
| `structures` | set_id, code, track, name, min_notch, max_notch, self_liquidating, offtake, methodology_ref, conditions, is_proposed |
| `modules` | set_id, code, name, track, factor_set, subsector_set, haircut_set, methodology_ref, sort |
| `factors` | set_id, set_code, ord, key, pillar, profile, name, weight, measure, unit, type, direction, scale, nb, b1..b4, f1..f4, neg, group_code, optional, track_only, role, link, ref, auto_code, legacy_top_cut, legacy_bot_cut, legacy_judge |
| `factor_descriptors` | set_id, factor_key, band (1..5), text |
| `sub_sectors` | set_id, set_code, ord, name, grade_low, grade_high, special |
| `collateral_haircuts` | set_id, set_code, ord, name, haircut_low, haircut_high, cross_border_addon, methodology_ref, linked_core_ord (for "(linked)" rows) |
| `sector_questions` | set_id, module_code, ord, kind, question, flag_answer, target_factor_key, modifier_type, modifier_value, methodology_ref, is_proposed |
| `stress_shocks` | set_id, module_code, ord, name, size_text, methodology_ref, cost_type, default_value |
| `lists` / `list_items` | set_id, list_code; code, label, sort, is_active |
| `settings` | key, value (switches not part of methodology: reviewer step, IC sign-off, SSO, session timeouts, branding texts, footer) |

About 600 rows per parameter set: negligible space.

### 8.3 Business data

| Table | Key columns |
|---|---|
| `companies` | id, reg_no (unique), reg_no_key (normalised, unique; D-34), name, sector_module, contacts (jsonb), notes |
| `deals` | id, deal_id (unique, `CX-yyyy-nnn`), company_id, sponsor_company_id, facility_type, amount, tenor_months, module_code, track, stage, stage_changed_at/by |
| `ratings` | id, rating_id (unique), deal_id, company_id, rating_type, status (Draft/Submitted/Reviewed/Final/Superseded), analyst_id, reviewer_id, ic_approver_id, rating_date, finalised_at, superseded_by_id, parameter_set_id, method_version, workbook_version, input_schema_version; denormalised outputs: module, track, blended_score, obligor_model, obligor_final, facility_model, facility_final, pd, lgd, ead, el_usd, el_pct, recommendation, overridden, history_enabled, next_review_date, checks_errors, checks_warnings, knockouts (text[]) |
| `rating_inputs` | rating_id (1:1), inputs (jsonb, validated by the engine's zod schema), history_snapshot (jsonb), updated_at, revision |
| `rating_results` | rating_id (1:1), result (jsonb, full engine output), engine_version, computed_at |
| `rating_checks` | rating_id, check_no, status, detail (copied from the result for filtering and the dashboard) |
| `overrides` | id, rating_id, grade_type (Obligor/Facility), model_grade, final_grade, notches, reason, requested_by/at, approval_status (Pending/Approved/Declined/Not required), approver_id, approver_name_text (imported), approved_at, comment |
| `rating_comments` | id, rating_id, author_id, body, kind (comment/return/approval), created_at |
| `deal_activity` | id, entry_id (unique), company_id, reg_no, deal_id (nullable), event_type, event_date, due_date, amount_due, amount_paid, days_late, notes, entered_at, entered_by_id, entered_by_text, deleted_at/by (soft delete, audited) |
| `manual_history_records` | id, company_id, deal_ref, facility_type, amount, disbursement_date, maturity_date, status, max_dpd, notes (D-33) |
| `deal_history` (derived) | derived on read from `deal_activity` + `manual_history_records` as of today by the engine's `deriveDealHistory` (no cache: with live days past due a cache would be stale daily; Phase 2 decision) |
| `blacklist` (view) | derived the same way |
| `screening_notes` | id, rating_id, storage_key, file_name, bytes, sha256, generated_by, generated_at |
| `import_runs` | id, source_file_sha256, started_at, mode (dry-run/apply), report (jsonb) |
| `system_status` | key (last_backup, last_storage_backup, last_keepalive), value, at |
| `changelog` | version, date, change |

**Why JSONB for rating inputs and results (you asked me to justify):** the inputs differ by module and track (12 to 20 factors, 0 to 9 questions, 0 to 8 shocks, any number of collateral lines), and the factor list itself changes between parameter sets. Typed tables would need about eight child tables per rating and still store keys that are only meaningful inside a given parameter set. A single validated JSON document per rating (about 8 to 15 KB) is exactly what the engine consumes, is replayable, compact for the free tier (tens of thousands of ratings fit in well under 100 MB), and is validated by the same zod schema on every write. Everything you report on (grades, PD, EL, recommendation, checks, overrides, dates, people) is denormalised into typed, indexed columns, so dashboards and exports never query inside JSON.

---

## 9. Main flows (server)

* **Autosave draft:** debounced server action; zod-validate, store inputs, recompute result with the Active set and live history, store the result (draft results are disposable).
* **Final:** in one transaction: lock the rating row; re-validate; take the history snapshot; compute with the rating's parameter set; refuse if any Error check, any blocked override, or a pending IC approval; write status, denormalised outputs, result, checks, Override Log rows; mark the deal's previous Final as Superseded; update deal stage rules; audit entry.
* **Deal Activity write:** insert/edit/soft-delete the event, re-derive that deal's history and that company's blacklist in the same transaction, audit.
* **Screening Note:** render PDF from the stored result → upload to the private bucket → `screening_notes` row → return a 5-minute signed URL.

---

## 10. Operations on the free tier

* **Keep-alive:** `/api/health` runs `select 1` and returns version and time; a GitHub Actions workflow calls it every 2 days (cron `0 6 */2 * *`), and on failure also connects directly with `psql` and opens a GitHub issue. Last ping time shown on System health.
* **Backups:** nightly GitHub Actions job: `pg_dump --format=custom` with the matching PostgreSQL client version → encrypt with `age` (public key in the repo, private key held offline by Crowdaxe and as a GitHub secret only for restore tests) → upload as a release asset to a private `crowdaxe-crs-backups` repository (or OneDrive/SharePoint through rclone, optional) → prune to 30 daily and 12 monthly → write `last_backup` to `system_status`. Weekly: storage bucket synced through the S3 endpoint, tarred, encrypted, uploaded the same way. On failure, or if the last success is older than 48 hours (checked by a separate daily job), email the Admins. GitHub Actions minutes: about 3 minutes a night, well within a private repository's free allowance.
* **Restore:** `ops/restore.sh` (download, decrypt, `pg_restore` into a target database, run smoke queries, print row counts) and a step-by-step guide; tested in Phase 7 by restoring into a fresh local database and running the reconciliation report.
* **System health panel:** database size (`pg_database_size`), storage used (sum of object sizes) against 500 MB / 1 GB with an 80% warning, last backup, last storage backup, last keep-alive, Netlify credits used (Netlify API, if a read token is configured), app and engine version, active parameter set.

---

## 11. Data migration (Phase 2)

`tools/import` reads the `.xlsm` with `exceljs` (values and formulas), so it re-runs on later workbook versions:

1. Parameter set 1.1 (Active) from Parameters, Modules (resolving "(linked)" haircut formulas to `linked_core_ord`), Lists, rating scale, overlays, structures; PROPOSED flags from the methodology column.
2. Companies from distinct registration numbers (Ratings, Deal Activity, Deal History, Blacklist).
3. Deals from Ratings and the Pipeline Register (stage, PDF path ignored).
4. Deal Activity events; verify that the derived Deal History and Blacklist reproduce the sheets as at their "updated" dates (Phase 0 harness already does this for all 5 rows).
5. Ratings and RatingInputs: decode `S:`/`N:`/`D:`/`B:`/`E:`; map `Sheet!Cell` keys to the structured fields (grid rows mapped to factor, question and shock keys using the rating's module); reconstruct the history snapshot as at the rating date; run the engine and assert the stored outputs match before writing.
6. Override Log rows linked to their ratings; Changelog.
7. Excel serial dates and datetimes converted with the 1900 date system (serial 46042 = 20 January 2026).

`--dry-run` writes nothing and produces the reconciliation report (per table: rows in source, rows to insert, totals of amounts and EL, mismatches). Idempotent on a clean database; on a re-run it upserts by natural keys.

---

## 12. Phase plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | This analysis (`methodology-spec.md`, `data-inventory.md`, `workflow-spec.md`, `discrepancies.md`, this document) | **Your approval and the decisions listed below** |
| 1 | `packages/engine` with full parity suite; oracle-generated golden fixtures | 102/102 TestCases, 7/7 saved ratings, golden fixtures, ≥95% coverage. Test report to you. Stop for approval |
| 2 | Prisma schema and migrations, seed, importer with dry run and reconciliation | Import of the workbook reconciles to zero differences |
| 3 | Authentication, users and roles, permissions, audit log | Permission integration tests per role |
| 4 | Rating wizard, live summary, checks, knockouts, save/Final, reopen, duplicate, compare, override approval | Integration tests of save flow; E2E full rating to Final |
| 5 | Dashboard, Pipeline, Deal Activity, Companies, Override Log, search, exports, Screening Note PDF | Screening Note matches the workbook's content on all 7 imported ratings |
| 6 | Admin: parameters and methodology editors, versioning and approval, diff, impact preview, switches, audit viewer, self-test runner | E2E admin change through approval |
| 7 | Hardening and deployment: E2E suite, security review, performance check, Netlify + Supabase deployment, keep-alive, backups and tested restore, Dockerfile, deployment guide, `upgrade-guide.md`, `data-protection.md` | Restore proven into a fresh database |
| 8 | README, admin guide, analyst guide, methodology-to-code map | – |

---

## 13. Decisions I need from you before Phase 1

1. Approve the architecture, including the four adjustments in section 2.
2. Supabase region: `us-east-2` (recommended on Netlify Free) or Frankfurt/London (section 3).
3. Email: Microsoft 365 via Graph (needs your M365 admin) or Resend Free (section 3).
4. The decisions marked in `discrepancies.md` (the table at its top), above all D-01, D-02, D-05 and D-51.
5. GitHub: which organisation/repository should I push to? This repository currently exists only in my session's workspace (commits are local). A second private repository will hold the encrypted backups.
6. Fonts and logo: do you hold a web/PDF embedding licence for Avenir Next? If not I will use Nunito Sans. Logo file when ready (placeholder until then).

---

## Sources (checked 13 November 2026)

* Supabase pricing (Free: 500 MB database, 1 GB storage, 5 GB egress, 2 active projects, pause after 1 week of inactivity, no automatic backups): https://supabase.com/pricing
* Supabase regions (no African region): https://supabase.com/docs/guides/platform/regions
* Netlify credits and pausing: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
* Netlify function limits (60 s synchronous) and region selection (Pro and Enterprise): https://docs.netlify.com/build/functions/configuration/
* Netlify function memory (1 GB default): https://docs.netlify.com/build/functions/usage-and-billing/
* Netlify Terms of Use and Self-Serve Subscription Agreement (no non-commercial restriction found): https://www.netlify.com/legal/terms-of-use/ and https://www.netlify.com/legal/self-serve-subscription-agreement/
* Cloudflare Workers limits (Free: 10 ms CPU, 128 MB): https://developers.cloudflare.com/workers/platform/limits/ ; OpenNext Worker size on Free (3 MiB): https://opennext.js.org/cloudflare/troubleshooting
* Vercel Hobby (personal, non-commercial only): https://vercel.com/docs/plans/hobby
* Oracle Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm ; A1 allowance reduction reported by InfoQ: https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
* Resend pricing (Free: 3,000 a month, 100 a day): https://resend.com/pricing
