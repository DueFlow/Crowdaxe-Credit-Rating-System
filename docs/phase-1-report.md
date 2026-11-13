# Phase 1 report: calculation engine

Date: 13 November 2026. Package: `packages/engine` (TypeScript, no database or UI dependencies). Engine version 1.1.0, parameter set 1.1.

## Result

| Suite | What it checks | Tests | Result |
|---|---|---|---|
| Workbook TestCases | All 29 cases of the hidden TestCases sheet, run with the VBA semantics (`Use`, `Param`, `History`), 102 expectations | 30 | **102 of 102 pass** |
| Saved ratings | The 7 Final ratings in the workbook, re-run from `RatingInputs` with Deal History and Blacklist rebuilt from Deal Activity as at each rating date: blended score, obligor model and final, facility model and final, PD, LGD, EAD, EL US$, recommendation, overridden, track | 9 | **7 of 7 reproduce exactly** |
| Golden parity | 1,080 random, boundary-value and complete ratings across all 12 modules, recalculated from the original workbook by LibreOffice; 439 output cells compared per case (about 474,000 comparisons): every factor's weight, band text, score, meaning and status, pillars, blend, overlays, history, obligor and facility path, collateral and LGD, PD, EL, pricing, knockouts, recommendation, review date, all 13 checks with their detail text, Financials metrics | 1,082 | **1,080 of 1,080 match** (1 tolerated formatting difference, below) |
| Deal Activity | Derivation reproduces all 5 stored Deal History rows and the Blacklist; every status rule; entry validation; override rate (14.3%, 1 of 7) | 11 | pass |
| Rating rules | Table-driven and property tests: interpolation at, above and below every anchor; f-flags; monotonic scores within 1 to 5; N/A re-weighting sums to 100% for any combination; every knockout (KO1 to KO6, including the switch and the PF sponsor/borrower option); every data check in each status; recommendation branches; overrides; Deal History credits, penalty, lookback and character flag; modifiers; PF construction cap; B5 LTV cap | 62 | pass |
| Excel helpers | ROUND half away from zero on 15 significant digits (property tests), EDATE, serial dates, every TEXT() format used | 42 | pass |
| Parameter validation | Parameter set 1.1 is valid; 29 kinds of invalid edits are rejected with a plain-English message (weights not summing to 100%, non-monotonic boundaries, missing parameters, orphan modifiers, gaps in numbering …) | 32 | pass |
| **Total** | | **1,268** | **all pass** |

Coverage of `packages/engine/src`: statements 99.95%, branches 97.9%, functions 100%, lines 99.95% (CI fails below 95%).

Lint (ESLint strict TypeScript rules), Prettier and `tsc --strict` pass. CI runs all of it on every push (`.github/workflows/ci.yml`).

## How parity was established

1. **The workbook's own tests.** The TestCases sheet is exported as it is; the test runner applies each case exactly as `modSelfTest` does.
2. **The saved ratings.** Run from their saved inputs. As found in Phase 0 (D-01), three of them only reproduce with the Deal History and Blacklist as they stood on the rating date. The engine's own Deal Activity derivation rebuilds them, so this test also proves the derivation. A second test confirms the drift: with today's history, exactly those three ratings change.
3. **An independent oracle for everything else.** LibreOffice recalculates the original `.xlsm` (it passes the same 102 workbook checks and reproduces the saved ratings, so it agrees with Excel on this workbook). `tools/oracle/generate_golden.py` builds ratings that exercise every module, every factor boundary (exactly on it, 0.0000001 of the span either side, far beyond, mid-band), blanks, invalid entries, overrides with and without approval, modifiers, N/A choices, PROPOSED switches off, pricing on, history and blacklist rows. Batch B adds complete, well-evidenced ratings so that every facility grade from 1 to 10, approvals, conditional approvals and applied overrides are covered.

## One difference between the oracle and Excel (engine follows Excel)

LibreOffice's `TEXT(x, "#,##0")` rounds from the full binary value; Excel rounds from 15 significant digits. For a recoverable value of 1,799,155.4999999998 LibreOffice writes "1,799,155" and Excel "1,799,156". The engine applies Excel's rule everywhere. The golden test accepts a text that differs from the oracle **only** by one in the last digit of a number and lists each case; there is one such case in 1,080 (B0451, data check 11 detail). It is display text only; no grade, PD, EL or decision is affected. If you can, please confirm in Excel: put `=TEXT(1799155.4999999998,"#,##0")` in any cell; the engine expects `1,799,156`.

## Approved decisions implemented in the engine

| Item | Implementation |
|---|---|
| D-01 history snapshot | `rate()` takes a `HistorySnapshot` (Deal History rows and Blacklist status). The app will store it with every rating. |
| D-02 live days past due | `deriveDealHistory(events, asOf)` / `deriveDeal`: unpaid instalments age to `asOf`; a deal passes to Defaulted after 90 days without a new event. Passing the old recalculation date reproduces the workbook exactly (tested). |
| D-05 PROPOSED values live | Imported as they are, flagged `proposed: true` (parameters, structure S6, question B6\|6). |
| D-07 literals become parameters | New parameters with today's values: `Interp_NB4_A1..A4`, `Interp_NB2_A1..A2`, `Tol_ScoreOverride`, `Tol_Weights`, `Tol_ShockValue`, `Tol_Haircut`, `Overlay_InfoQuality_Ord`; grade-scale top = length of the rating scale; message texts built from parameters (85%, 10%, 75%). |
| D-10 / D-12 | Parameter validation: optional factors must sit in a group with a non-optional member; boundaries strictly monotonic; and, as your brief asks, factor weights in every pillar of every module must sum to 100%. |
| D-13 summed modifiers | Workbook behaviour kept; a factor score pushed outside 1 to 5 is reported in `integrityIssues` and blocks a Final rating (`canFinalise`). |
| D-14 negative overlay notches | To be rejected by the form validation (Phase 4); the engine reproduces the workbook formula. |
| D-15 check 5 detail | Shows "No module chosen" when no module is chosen. |
| D-22 KO6 values | `KO6_Enabled` and `Txt_KO6` are parameters. |
| D-23 PF blacklist | New switch `KO6_CheckBorrowerOnPF`, default "No" (workbook behaviour: sponsor only). |
| D-33 opening-balance history | The snapshot accepts any Deal History rows, derived or manual. |
| D-34 registration numbers | Matched ignoring case and spaces (`regNoKey`). |

D-03, D-04, D-25, D-49 and the other workflow items are implemented in later phases.

## Fixtures and their contents

`packages/engine/fixtures/`: `parameter-set-1.1.json` (methodology only), `testcases.json` (sample data), `saved-ratings.json`, `deal-activity.json` and `deal-history.json` (the three companies, seven ratings and events from the workbook, with names and registration numbers), `golden.json.gz` (synthetic data). D-51 is still open: if the workbook's companies are real, these fixtures contain real company data and must stay in a private repository.

## Outstanding

* Display strings used only by the summary panel and Screening Note (for example "GRADE 5 · SATISFACTORY", the loss line) will be added with those screens in Phases 4 and 5 and tested against the workbook's cells the same way.
* The repository is still local to this session: tell me the GitHub organisation and repository name and I will push it (and create the private backups repository in Phase 7).
* D-51 (are the workbook's companies real?) remains open.
