# Workflow specification

What each form and VBA routine in `Crowdaxe_CRS.xlsm` does, written as user stories, with how the web app will provide it. "Today" describes the workbook; "Web app" is the proposal. Rules that change results are in `methodology-spec.md`; open questions are in `discrepancies.md` (D-nn).

The workbook's VBA (about 19,000 lines in 47 components) splits into: business logic (`modRating`, `modScoring`, `modParams`, `modChecks`, `modKnockouts`, `modOverride`, `modHistory`, `modActivity`, `modOutputs`, `modSelfTest`, `clsDeal`, `modUtil`, about 3,000 lines), form controllers (`clsWizardCtl`, `clsOverrideCtl`, `clsHistoryCtl`, `clsActivityCtl`, `clsSummaryCtl`, `clsHomeCtl`, `clsField`, `clsButton` and helpers), and workbook builders (`modSetupLayout1`, `modSetupLayout2`, `modSetup`, `modFormBuilder`, `modArt`, `modTheme`, `modImportAll`, about 11,000 lines) that create the sheets, formulas, styles and forms. The builders have no runtime role and are not ported; their content (layout, formulas, test data) was read as the source of the spec.

---

## 1. Home (`frmHome`, `clsHomeCtl`, `modNav`)

**Today:** a full-screen home form with buttons: New rating, Continue (current deal), Open a saved rating, Deal summary, Deal activity, Deal History, Pipeline Register, Override Log, Parameters (shows a message that rules are controlled by the IC), Self-test, Show/Hide information sheets, Help. The Home sheet shows the version line and the disclaimer.

* As an analyst, I open the CRS and see the version, methodology version and disclaimer, and the main actions.
* As an analyst, I can continue the deal currently on the Scorecard where I left off.

**Web app:** sign-in, then a Home/Dashboard page (section 9) with the same actions, the disclaimer and versions in the footer. "Continue" becomes "My drafts".

---

## 2. Rating wizard (`frmRating`, `clsWizardCtl`, `clsField`)

**Today:** nine steps: Deal, History & flags, Financials, Pillar 1 (PF: PF1-PF2), Pillar 2 (PF: PF3-PF5), Pillar 3 (PF: Sponsor CAMPARI), Overlays, Structure, Result. Every field writes straight to a sheet cell; the sheet formulas calculate; the form reads results back. A strip on every step shows the four hard stops (KO1, KO2, KO3, KO6) and the checks summary, red when a hard stop fires.

### 2.1 Deal step

* As an analyst starting a new rating, I get the next Deal ID (`CX-<year>-nnn`), rating type New and today's date filled in.
* As an analyst, when I type an existing Deal ID, its latest saved rating opens (message: "Opened deal … Changes you save become a new rating of the same deal").
* As an analyst, when I type a registration number seen before, the borrower name fills in (latest name from Deal History, then Ratings), and I see previous Crowdaxe deals and earlier CRS ratings for that number.
* As an analyst, I choose the module and see its track and whether my B0 answers agree.
* As an analyst, I only see fields that apply: sub-sector if the module has a sub-sector list; renewables offtaker for PF-REN; stressed LTV for B5; sponsor registration number and completion fields for Project finance (visibility rules in `data-inventory.md`). Required fields show "Required"; invalid ones "Check".

**Web app:** same fields and rules. Company lookup by registration number with type-ahead; a red banner the moment a blacklisted registration number is entered (borrower and, on PF, sponsor; D-23). Choosing a module reloads sub-sector, collateral and structure lists.

### 2.2 History & flags step

* As an analyst, I see Deal History for the registration number (sponsor on PF): counts by the seven statuses, summary, score adjustment (or "switched off"), earlier CRS ratings, and the character review flag; if Character is above the suggestion I must write a justification.
* As an analyst, I can add a previous Crowdaxe deal (`frmHistoryEntry` → `modHistory.AddHistoryRecord`: registration number, borrower, Deal ID, facility type, amount, disbursement and maturity dates, status, max DPD, notes; registration number and a valid status required).
* As an analyst, I answer the module's red flags, conditions and modifiers (Yes/No/N/A) and explain every flagged answer.

**Web app:** same; "Add a previous deal" becomes an opening-balance history record (D-33) for users with the Analyst role. The history shown is live; the snapshot is taken at save (D-01).

### 2.3 Financials step

* As an analyst on the Corporate track, I enter three years of revenue and EBITDA, the latest balance sheet, the 12-month forecast and other information, and see the calculated metrics with their codes, base DSCR and stressed DSCR.
* As an analyst, I tick each stress shock that applies, can change its value with a reason, and see its US$ cost; I must give a reason for any shock I do not apply.
* As an analyst on Project finance, I am told these figures are not used and I enter DSCRs on the factor step.

### 2.4 Factor steps (`modScoring`)

* As an analyst, for each numeric factor I type the figure or pick a band from a drop-down (the band picks a representative value: the midpoint between boundaries, or a quarter of a band beyond the end boundaries), see the band descriptor and the interpolated score, and may override the score with a reason.
* As an analyst, for each descriptor factor I pick 5 to 1 from the descriptors and record evidence.
* As an analyst, I see sub-sector and offtaker factors scored from the Deal step.
* As an analyst, I can mark an optional factor N/A and see the effective weights adjust.
* As an analyst, I can "accept suggestions" on a step: every blank score on that step is filled with its calculated score (`AcceptSuggestions`), so every score is explicit before review.
* As an analyst, hovering a factor shows its measure, boundaries and anchors.

**Web app:** same, with a live pillar score per section. The score colour scale (1 to 5, green = 5) is visually distinct from the grade colour scale (1 to 10, green = 1).

### 2.5 Overlays step

* As an analyst, for each of the five Zimbabwe overlays I choose 0 to its maximum from the descriptor list and give a one-line reason for every notch; I see blended score, grade score, capped overlay total and grade score after overlays.

### 2.6 Structure step

* As an analyst, I choose a structure (filtered by track), read its conditions for full uplift, choose notches within its range, give a reason for a partial uplift or an ungraded offtaker, and see "self-liquidating" and the facility grade path (obligor → after notching → uplift floor → offtaker cap → construction cap → facility).
* As an analyst, I enter up to 15 collateral lines from the module's list with value, optional haircut (blank = midpoint), cross-border flag and note, and see the range, recoverable value, status, total recoverable, LGD with its basis, and whether collateral covers the amount.

**Web app:** unlimited collateral lines.

### 2.7 Result step and override (`frmOverride`, `clsOverrideCtl`, `modOverride`)

* As an analyst, I see facility grade (large), description and PD, obligor grade, override statuses, pillar bars, blended score, grade score with overlays, Deal History line, structure line, data checks (errors and warnings listed), the loss line (PD, LGD, EL US$ and %), recommendation, next review, and the disclaimer.
* As an analyst, I can override the final obligor and/or facility grade: reason always; more than 1 notch needs an IC approver name and date. The form shows the model grades, each status ("Blocked: …" or "Override applied: +n") and the year-to-date override rate. Cancel restores the previous override inputs.
* As an analyst, I can export the Screening Note PDF from the Result step.

**Web app:** override above `Ovr_MaxNoApproval` creates an approval request to IC Approvers; the rating cannot become Final until it is approved (D-25). Approval, decline and comments are recorded.

### 2.8 Save (`modRating.SaveRating`)

* As an analyst, I can save a draft at any time (needs Deal ID and Borrower).
* As an analyst, I can save a final rating only when no data check is Error and no override is blocked; the message lists the errors to fix.
* When a final rating is saved: the rating date becomes today, a Rating ID `R-yyyymmdd-hhnnss` is created, a Ratings row and all inputs are written, overrides go to the Override Log, and the Pipeline Register row is created (stage "Pipeline Deals", or "Live Investment" for a Review) or updated (stage and PDF path kept).

**Web app:** Draft autosaves. Status flow: Draft → (Submitted → Reviewed, if the reviewer step is on) → (IC sign-off, if on) → Final; a new Final supersedes the deal's previous Final. Final writes the input snapshot, history snapshot, full result snapshot, parameter set version, Override Log rows and the deal's pipeline fields in one database transaction. Warnings must be acknowledged before Final. D-03 and D-04 decide rating date and Rating ID timing.

### 2.9 Open, re-run, new rating (`LoadRating`, `RerunRating`, `NewRating`)

* As an analyst, I open a saved rating by ID (the ten latest are listed), which reloads all inputs.
* As an analyst, I re-run a saved rating under the current Parameters and see what changed: blended score, obligor grade, facility grade, PD, LGD, EL US$, recommendation (or "No change: the rating reproduces exactly").
* As an analyst, I start a new rating, which clears all inputs after a warning.

**Web app:** open any rating (read-only if Final); "Re-run" against the active parameter set and today's history, with a side-by-side diff; "Duplicate as Review" copies inputs into a new Draft Review rating; compare any two ratings side by side.

---

## 3. Deal Activity (`frmActivity`, `clsActivityCtl`, `modActivity`)

* As an analyst, I record an event (company registration number, borrower, Deal ID, event type, event date, due/maturity date, amount due, amount paid, notes) with the validation in `methodology-spec.md` 13.1; days late is calculated.
* As an analyst, I see the event log for a company or a deal (latest first, up to 300 rows), the deal's status line ("Live, in arrears · max 1 days late · US$ 50,000 disbursed 12 Oct 2026, due 12 Feb 2027") and its last activity.
* After each event, Deal History for that deal and (for blacklist events) the Blacklist are recalculated; `RecalculateActivity` rebuilds everything after manual edits.

**Web app:** same form and log; edit and delete events (with audit), and Deal History and Blacklist are derived automatically (D-02, D-21).

## 4. Deal summary (`frmSummary`, `clsSummaryCtl`, `ExportDealSummary`)

* As an analyst, I see one line per deal: latest Final rating (or latest draft if none), or the Pipeline Register row if the deal has no rating, with repayment status from Deal Activity and blacklist flag.
* I can filter by text and by: Recommend approval, Approval with conditions, Declined, In arrears/restructured/defaulted, Completed (repaid), Blacklisted, No activity recorded; open a deal's rating; open its activity; export to a "Deal Summary" sheet.

**Web app:** this becomes the Pipeline Register / deals list with the same filters, plus Excel/CSV export.

## 5. Pipeline Register and Override Log sheets

* As an analyst, I change a deal's stage between Pipeline Deals and Live Investment on the sheet.
* As anyone, I see the Override Log and the year-to-date override rate against the 15% trigger.

## 6. Screening Note (`modOutputs.ExportScreeningNotePDF`)

* As an analyst, I export a one-page A4 portrait PDF named `CRS_<DealID>_<Borrower>_<yyyymmdd>.pdf`. Content: deal, rating date, rating status and ID; borrower, registration number, module, track, facility, amount, tenor, rating type, analyst; facility grade (number, description, PD, "GRADE n · DESCRIPTION"); obligor grade; pillar bars (scores 1 to 5); blended score and grade-score line; data checks summary; loss line; recommendation; next review; factor table (pillar, factor, effective weight, input, score, meaning, evidence); overlays with reasons; structure; LGD; knockouts; Deal History; override; flagged questions; non-passed checks; "Prepared by" (analyst, date), Signature and Investment Committee blocks; footer "Methodology 1.1 · Workbook 1.1 · Rating ID … · Internal assessment, not a rating by a registered credit rating agency." and "Crowdaxe Capital | Internal", "Page n of n". Empty rows are hidden for printing.
* Exporting also updates the Pipeline Register row with the PDF path.

**Web app:** server-side PDF with the same content and the brand rules; stored in the private bucket, linked to the rating; downloads through short-lived signed URLs.

## 7. Self-test (`modSelfTest`)

* As an admin, I run the self-test: each case is entered on the Scorecard, results compared with expectations (default tolerance 0.000001), results written to TestCases with a "n of m checks passed" line, and the current deal, Parameters and Deal History are restored afterwards.

**Web app:** the same 29 cases run against the engine and a chosen parameter set from Admin, results shown in a table; they also run in CI.

## 8. Parameters, Modules, Lists

* As an admin (today: anyone with the workbook), I change rule values on the Parameters, Modules and Lists sheets; formulas pick them up immediately. PROPOSED rows await IC approval but there is no approval mechanism.

**Web app:** Admin editors with versioned parameter sets and IC approval (architecture section 7).

## 9. Not ported

Workbook builders (`BuildCRS`, `BuildForms`, `BuildActivityForms`, `modSetupLayout1/2`, `modFormBuilder`, `modArt`, `modTheme`, `modImportAll`), Excel window and sheet visibility handling (`ShowInfoSheets`, `HideInfoSheets`, `FullScreenHome`), and the ErrorLog sheet (replaced by server logs and the audit log).
