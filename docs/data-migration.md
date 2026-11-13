# Data migration: importing the workbook

`tools/import` loads `Crowdaxe_CRS.xlsm` into the database. It can run against any later version of the workbook with the same layout (each sheet's header row is checked first).

## What is imported

| Workbook | Database | Notes |
|---|---|---|
| Parameters, Modules, Lists, rating scale, overlays, structures | `parameter_sets` 1.1 and its tables | Becomes **Active** if no set is active; a later methodology version is imported as **Proposed** for IC approval. Same version with different rules is refused. |
| Registration numbers on Ratings, Deal Activity, Deal History, Blacklist | `companies` | Matched on the normalised registration number. |
| Ratings rows, Pipeline Register | `deals` | Stage from the Pipeline Register. |
| Deal Activity | `deal_activity` | Deal History and the Blacklist are not copied: they are derived from the events, and the importer checks that the derivation reproduces the sheets. |
| Ratings + RatingInputs | `ratings`, `rating_inputs`, `rating_results`, `rating_checks` | Every rating is re-run through the engine with Deal History as at its rating date and only imported if it reproduces the saved results. The history snapshot is stored with it. Older Final ratings of a deal become Superseded. |
| Override Log | `overrides` | Checked against the rating's model and final grades. |
| Changelog | `changelog` | |
| ErrorLog, TestCases, Screening Note, Home | not imported | TestCases are the engine's test suite. |

Dates: Excel serial dates and date cells become ISO dates; date-times ("Saved at", "Entered on") are read as Harare time (UTC+2).

## Commands

```bash
# Dry run (default): everything is written and checked inside a transaction that is then rolled back
pnpm --filter @crowdaxe/import import -- --file /path/to/Crowdaxe_CRS.xlsm

# Import
pnpm --filter @crowdaxe/import import -- --file /path/to/Crowdaxe_CRS.xlsm --apply

# Production: methodology only (the workbook's companies and ratings are test data)
pnpm --filter @crowdaxe/import import -- --file /path/to/Crowdaxe_CRS.xlsm --methodology-only --apply
```

The CLI uses `DATABASE_URL` (use the owner's direct connection for imports), writes `import-report.md` and `import-report.json` (`--report` to change), and exits with code 1 if anything does not reconcile; nothing is written in that case. Re-running an import changes nothing (every row is reported "unchanged").

The development seed (`pnpm --filter @crowdaxe/db seed`) loads the same test records from `packages/db/fixtures/workbook-extract-1.1.json`, marked `source = SEED`, without needing the workbook.

## Example: import of Workbook 1.1 into an empty database (13 November 2026)

| | |
|---|---|
| Result | Imported |
| Mode | Apply |
| Scope | Methodology and records |
| Source | Crowdaxe_CRS.xlsm (SHA-256 abf352c17550fa88…) |
| Workbook / methodology | 1.1 / 1.1 |
| Parameter set | 1.1: created, status ACTIVE |
| Run | 2026-11-13T11:57:25.189Z to 2026-11-13T11:57:25.603Z |

### Tables

| Table | Source rows | Inserted | Unchanged | Updated | Refused | In database |
|---|---:|---:|---:|---:|---:|---:|
| companies | 3 | 3 | 0 | 0 | 0 | 3 |
| deals | 6 | 6 | 0 | 0 | 0 | 6 |
| deal_activity | 26 | 26 | 0 | 0 | 0 | 26 |
| ratings | 7 | 7 | 0 | 0 | 0 | 7 |
| rating_inputs | 7 | 7 | 0 | 0 | 0 | 7 |
| rating_results | 7 | 7 | 0 | 0 | 0 | 7 |
| rating_checks | 91 | 91 | 0 | 0 | 0 | 91 |
| overrides | 1 | 1 | 0 | 0 | 0 | 1 |
| changelog | 1 | 1 | 0 | 0 | 0 | 1 |

### Totals (source against database)

| Total | Source | Database | Match |
|---|---:|---:|---|
| Ratings: EL US$ | 63,278.75 | 63,278.75 | Yes |
| Ratings: EAD US$ | 465,000 | 465,000 | Yes |
| Ratings: facility grades (sum) | 40 | 40 | Yes |
| Deal Activity: amount paid US$ | 483,400 | 483,400 | Yes |
| Deal Activity: amount due US$ | 270,200 | 270,200 | Yes |

### Checks

| Check | Passed | Detail |
|---|---|---|
| Parameter set validates | Yes | 65 parameters, 12 modules, 132 factors, 44 sub-sectors, 112 haircuts, 57 questions, 65 shocks; 13 rows marked PROPOSED |
| Deal History sheet = derived from Deal Activity | Yes | 5 of 5 rows reproduced |
| Blacklist sheet = derived from Deal Activity | Yes | 1 of 1 entries reproduced (1 active today) |
| Saved ratings reproduce through the engine (history as at rating date) | Yes | 7 of 7 reproduce exactly |
| Every overridden rating has an Override Log row | Yes | 1 overridden rating(s), all logged |
| Pipeline Register agrees with each deal’s latest Final rating | Yes | 6 register row(s) agree |

### Warnings

- 1 older Final rating(s) marked Superseded by a later Final rating of the same deal (D-04).
