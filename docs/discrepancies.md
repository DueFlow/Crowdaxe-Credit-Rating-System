# Discrepancies, ambiguities and apparent defects in the workbook

Workbook 1.1 / Methodology 1.1. Nothing below has been "fixed". For each item: what the workbook does today, why it matters, my recommendation, and whether I need a decision from you before Phase 1.

Impact levels:

* **High**: changes ratings, or blocks exact parity, or is a control gap.
* **Medium**: edge cases that could change a rating, or workflow behaviour the web app must choose.
* **Low**: labels, dead code, wording.

Default if you do not decide: the engine reproduces the workbook exactly (that is the parity requirement), and any change is a parameter or switch that is off until approved.

---

## Summary of decisions I need

| # | Question | My recommendation |
|---|---|---|
| D-01 | Snapshot Deal History counts and blacklist status into each rating | Yes (required for parity and auditability) |
| D-02 | Days past due on unpaid instalments: frozen at last recalculation (workbook) or live (always today)? | Live, computed on read; snapshot at save |
| D-03 | Rating date: overwritten on every save (workbook), or set when the rating becomes Final? | Set at Final; editable on drafts |
| D-04 | Drafts: a new Rating ID per save (workbook), or one draft record autosaved? | One record; Rating ID assigned at creation |
| D-05 | PROPOSED parameters are live today (Deal History adjustment, LGD cap, S6, B6 modifier, year start). Keep them live in set 1.1? | Import exactly as today, flagged PROPOSED, so parity holds; IC to confirm |
| D-06 | "Repayment proceeds controlled by Crowdaxe" is asked but never used | Keep as a recorded input; ask IC whether KO2's self-liquidating test should require it |
| D-13 | Two "Min" modifiers on the same factor are summed (score can fall below 1) | Engine: keep workbook behaviour in 1.1; propose "most restrictive wins" in 1.2 |
| D-19 | Review ratings skip the KO4/KO5 decline rules | Keep; confirm intended |
| D-20 | Deal History counts the deal being rated (Review ratings) | Keep; confirm intended |
| D-23 | Project finance: KO6 blacklist checks only the sponsor, not the borrower SPV | Check both in the web app, behind a switch defaulting to workbook behaviour |
| D-33 | Facilities from before the CRS (manual Deal History rows) | Allow "opening balance" Deal History records, clearly flagged |
| D-51 | Are the three companies and seven ratings in the workbook real or sample data? | Tell me; it decides whether they go to production |

---

## High

### D-01 Deal History and Blacklist are not saved with a rating, so saved ratings drift

**Workbook:** the Deal History adjustment, the character review flag and KO6 read the live Deal History and Blacklist tables. `RatingInputs` stores only input cells. Reopening or re-running a rating uses today's history.
**Evidence:** re-running the 7 saved ratings from `RatingInputs` against the current sheets: 4 reproduce, 3 do not (R-20260112-101422 obligor 5 → 4; R-20260203-140251 obligor 6 → 7, facility 5 → 6, decision changes; R-20260216-114007 now "Decline (blacklisted)"). Rebuilding Deal History and Blacklist from Deal Activity as at each rating date reproduces all 7 exactly.
**Recommendation:** the engine takes the history counts and blacklist status as explicit inputs; the app snapshots them at every save (with the source events' IDs). Parity tests rebuild history as at the rating date. Re-running a rating (see `workflow-spec.md`) offers both "as saved" and "with today's history".
**Decision:** please confirm.

### D-02 Days past due depend on when the recalculation was run

**Workbook:** for an unpaid missed instalment, DPD = (date `RecalculateDeal` runs) − due date. The sheet only changes when someone adds an event or runs `RecalculateActivity`. CX-2026-003 shows 158 DPD (recalculated 30 Oct); today it would be 172. CX-2026-005 shows 1 DPD (4 Nov); today 10. A deal crossing 90 DPD only becomes "Defaulted" when someone touches it.
**Recommendation:** derive Deal History on read with "today" (or a given as-of date), so status is always current and arrears roll into Defaulted automatically after 90 days; snapshot at rating save (D-01). This changes what Deal History shows between recalculations, not the rule.
**Decision:** live (recommended) or frozen-until-event like the workbook?

### D-05 PROPOSED values are already switched on

**Workbook:** these are marked PROPOSED (awaiting IC approval) but are active: `Hist_Enabled = Yes` and all `Hist_*` values (s7.2 addendum); `LGD_CapAtUnsecured = Yes` (item 22); structure S6 distributor finance (item 18); B6 modifier "enrolment above 95% but no waiting list" (item 8); `Ovr_YearStartMonth` (item 33); `Hist_LookbackYears` (item 40, blank). Every saved rating used `Deal History on = Yes`.
**Recommendation:** import parameter set 1.1 exactly as is (so parity holds), with each PROPOSED row flagged. The Admin approval flow will let the IC approve them formally. The app will show a "contains PROPOSED rules" badge on ratings that used them.
**Decision:** confirm, or tell me which to switch off (that would be set 1.1a, and parity would be measured against 1.1).

### D-06 "Controlled proceeds" is captured but has no effect

**Workbook:** Scorecard C31 "Repayment proceeds controlled by Crowdaxe (warehouse sale or controlled collection account)?" is an input (saved on 4 of 7 ratings) but no formula reads it. "Self-liquidating" (which exempts a facility from KO2) comes only from the structure (S1 and S2 are flagged self-liquidating), whether or not proceeds are controlled. The wizard does not show the field.
**Recommendation:** keep it as a recorded input so imported ratings keep their answers; do not change KO2. Ask the IC whether self-liquidating should require "Yes" here (that would be a 1.2 change).
**Decision:** needed.

### D-13 Modifiers of the same type are added together

**Workbook:** for each factor, the values of all "Yes" modifiers of each type are summed (`SUMIFS`). B6 has two `Min` modifiers on Enrolment strength (B6|2): "falling >10%" (Min 9) and "above 95%, no waiting list" (Min 3, PROPOSED). If both are answered Yes, the cap becomes grade 12 → score 0.11, below the 1 to 5 scale. Two `Set` modifiers would likewise add.
**Recommendation:** in 1.1 reproduce exactly, but have the engine raise a data error when a factor's capped score falls outside 1 to 5, so it cannot reach a Final rating. Propose "most restrictive wins" for 1.2.
**Decision:** confirm.

### D-23 Project finance: the blacklist is checked against the sponsor only

**Workbook:** `sc_HistReg` is the sponsor's registration number on the PF track, and KO6 uses the same key. A blacklisted SPV borrower would pass KO6 if the sponsor is clean.
**Recommendation:** in the web app, check the borrower and (on PF) the sponsor, behind a switch `KO6_CheckBorrowerOnPF` that defaults to the workbook behaviour until you approve.
**Decision:** needed.

### D-25 IC approval of overrides is self-declared

**Workbook:** typing any name and date in "IC approver" and "IC approval date" unblocks an override above 1 notch. Nothing checks who the approver is or that the date is not before the rating.
**Recommendation:** in the web app the analyst requests approval; only a user with the IC Approver role can approve, and the app records the approver's account and timestamp. Imported overrides keep their typed name.
**Decision:** none (this is what your brief asks for); noted because behaviour changes.

---

## Medium

### D-03 Rating date is reset to "today" on every save

`SaveRating` writes `Date` into the rating date before saving, so a draft re-saved next week moves the rating date and therefore the next review date and the history lookback. **Recommendation:** rating date defaults to today, is editable while Draft, and is fixed when the rating becomes Final. **Decision:** needed.

### D-04 Every save creates a new Rating ID

Drafts are never replaced: five draft saves leave five rows. Nothing marks an older Final of the same deal as superseded. **Recommendation:** one rating record per rating, autosaved; the Rating ID (same `R-yyyymmdd-hhnnss` format) assigned at creation; a new Final for the same deal marks the previous Final "Superseded" (your brief). **Decision:** confirm.

### D-10 Optional factor weights and N/A

Weight of an N/A optional factor is shared within its group only. Today every optional factor has a group (B7C|7 in WCE, B7P|13 in RES), so pillars sum to 100%. An optional factor without a group, marked N/A, would leave its pillar below 100% and make check 5 an Error, even though the pillar score itself re-normalises. A group with every member N/A divides by zero. **Recommendation:** Admin validation: an optional factor must belong to a group with at least one non-optional member. Engine: treat a zero-weight group as an error, not a crash.

### D-11 f-flags only change the band text, not the score

The interpolated score passes through the anchor at each boundary whatever the f-flag says. The f-flag only decides which band descriptor is shown for a value exactly on a boundary. That is consistent (the line is continuous) but the Modules header says "f = 1 when the boundary value belongs to the stronger band", which an admin might read as affecting the score. **Recommendation:** keep; explain this in the Admin help text.

### D-12 Boundary validation

Equal or out-of-order boundaries cause division by zero or nonsense scores; the workbook has no check. **Recommendation:** Admin validation: boundaries strictly decreasing for Dir H, strictly increasing for Dir L.

### D-14 Negative overlay notches

Cell validation allows 0 to 2, but the formula accepts any number, so a pasted −1 would reduce the overlay total. **Recommendation:** the engine and forms reject negatives and values above the overlay's maximum (the workbook flags above-maximum as a data error but still caps it).

### D-17 Deal History rules: gaps a reader may not expect

(a) "Repaid late, 1-30 DPD" neither earns a credit nor blocks one, and does not count toward the on-time minimum. (b) Restructured and Defaulted block the credit and raise the character review flag, but carry no score penalty; only 31-90 DPD and live arrears are penalised (+0.5). (c) "Live, current" earns nothing. (d) The penalty is the same for one or several bad facilities. All are PROPOSED (s7.2). **Recommendation:** reproduce exactly; raise with the IC with the addendum.

### D-19 Review ratings ignore the decline thresholds

For rating type Review, after the hard knockouts the recommendation is "Existing exposure: <appetite of the facility grade>", without applying KO4 (obligor ≥ 8) or KO5 (facility ≥ 7). This is probably intended (an existing exposure is monitored, not declined), but the Knockouts sheet still shows "Decline" for KO4/KO5 on a Review. **Recommendation:** keep; show KO4/KO5 on Review ratings as "Not applied (existing exposure)".

### D-20 A Review rating counts the deal itself in Deal History

R-20261105-091233 (Review of CX-2026-005) counts CX-2026-005's own "Live, in arrears" row, which adds the +0.5 penalty. Arguably right for a review (the arrears are real), but it double counts if the arrears are also reflected in factor scores. **Recommendation:** keep; confirm.

### D-21 Deleting an event does not remove its Deal History row

`UpsertHistory` only inserts or updates. If all events of a deal are deleted, the Deal History row stays. **Recommendation:** in the web app Deal History is derived (D-02), so this cannot happen.

### D-22 Two rule values live outside Parameters

The KO6 switch (`bl_Knockout`) is a cell on the Blacklist sheet and `Txt_KO6` is a hard-coded defined name. **Recommendation:** move both into the parameter set (`KO6_Enabled`, `Txt_KO6`) with today's values.

### D-26 Override rate definition

Counts Final ratings (New and Review, including any later superseded) with rating date on or after the year start, with no end date; "overridden" is per rating, not per grade. **Recommendation:** keep the definition; exclude Superseded ratings only if you say so.

### D-28 Below-minimum-yield warning is not a data check

`C171` warns when the proposed yield is below the minimum yield, but no data check or knockout picks it up, so it does not appear in the checks list or on the Screening Note. **Recommendation:** show it in the result panel and on the Screening Note; no change to the checks.

### D-33 Manual Deal History records

The workbook also has `AddHistoryRecord` (`frmHistoryEntry`, "Add a previous deal"), which writes a Deal History row with no Deal Activity behind it, for facilities from before the CRS. Your brief derives Deal History entirely from Deal Activity. Today all 5 rows are derived. **Recommendation:** allow an "opening balance" record (company, deal, dates, status, max DPD, notes) flagged as manual, shown alongside derived rows. **Decision:** needed.

### D-34 Registration numbers are matched as typed

Lookups are exact (case-insensitive) on the text, so "3187/2011" and "3187 / 2011" are different companies. **Recommendation:** store a normalised key (trimmed, upper case, spaces removed) and show the original.

### D-38 KO2 applies only on the Corporate track

A project with base DSCR below 1.00x is not knocked out (its DSCR still scores low). The Knockouts sheet text does not say so. **Recommendation:** keep; state it in the UI.

### D-46 Collateral cover uses gross value

The "collateral covers the amount requested" test compares total **value** (before haircuts) with the amount requested, so items with a 100% haircut (land under offer letter, standing crops, personal guarantees) count toward cover while adding nothing to recovery. It also compares with the amount, not EAD. **Recommendation:** keep in 1.1; show recoverable value beside it.

### D-49 Pipeline stage never moves on

Stages are only "Pipeline Deals" and "Live Investment"; CX-2026-001 is repaid but still "Live Investment". **Recommendation:** add stages "Closed (repaid)", "Declined" and "Written off" as list values (Admin-editable), suggested automatically from Deal Activity, changed by a user.

### D-51 Are the workbook's deals real?

The workbook holds three companies, seven Final ratings and 26 Deal Activity events with names and registration numbers, and an analyst name. Your brief says "never invent data" and to use sample data only in development. **Decision:** are these real records to import into production, or test data? If real, the parity fixtures built from them will contain personal and company data and must stay in a private repository (they would anyway).

---

## Low

### D-07 Methodology constants written as literals in formulas

Interpolation anchors (4.5/3.5/2.5/1.5 and 4/2), the top of the grade scale (`10`), tolerances (0.005, 0.000001, 0.00001), "85%" in the B5 cap message, "10%"/"75%" in the LGD basis text. **Recommendation:** make each a parameter with today's value (your rule: no methodology value in code).

### D-08 Stale labels and names

* Parameters header says "Methodology v1.0"; Modules says "Transcribed from Methodology v1.0"; the Home form's Parameters message says v1.0. `Method_Version` is 1.1.
* Scorecard instruction: "Scores run 1 to 10, lower is stronger" (v1.0; factor scores are now 1 to 5, higher stronger).
* `KO_DSCRMin` note: "scores Pillar 2 at 10" (v1.0; now Pillar 2 = 1). B5 LTV shock text: "caps Pillar 2 at 8" (now 1.89).
* Defined names `Altman_C0`, `Altman_WC`, `Altman_RE`, `Altman_EBIT`, `Altman_EQ`, `Altman_Distress`, `Altman_Safe` point at the `Hist_*` cells; `sc_AltmanZone`/`sc_AltmanNote` point outside the used range. Altman was removed in Phase 3c.
* Aliases `KO_CharMin` = `KO_CharScore`, `RE_P2_Floor` = `RE_P2_Cap` (v1.0 "floor" is now a cap).
* `modChecks` header says "fifteen data checks" (there are 13); Knockouts KO4/KO5 texts hard-code "8" and "7"; `Scorecard!B22` "Not used (one analyst screens the deal)" is the Reviewer field.

**Recommendation:** none of these affect results. The web app generates labels from parameters, and the importer ignores the stale names.

### D-09 Columns no formula uses

`TopCut`, `BotCut` and `Judge` on the factor table (v1.0 suggestion ranges), the 1 to 10 band ranges calculated for numeric factors (`AR`/`AS`, only used for sub-sector/offtaker rows), lists `lst_Band5`, `lst_Band3` and `lst_ShockStatus`, and `modScoring.ScoreInBand` (reads columns that now hold other data). **Recommendation:** import TopCut/BotCut/Judge as read-only legacy fields so nothing is lost; do not use them.

### D-15 Check 5 detail text

With no module chosen, check 5 is Error but its detail says "All pillar weights sum to 100%". **Recommendation:** show "No module chosen".

### D-16 Factor "Meaning" text skips the two-decimal step

The meaning of a factor score uses `INT(gradeScore + 0.5)` without `ROUND(…, 2)` first, unlike the obligor grade. A score at an exact .5 boundary affected by floating-point noise could show the neighbouring description. Display only. **Recommendation:** reproduce exactly (it is visible on the Screening Note).

### D-18 Screening Note leaves out KO6

The Screening Note's knockout line lists KO1 to KO3 only; a blacklisted company shows the decline text but not "KO6". **Recommendation:** list KO1 to KO6.

### D-24 Code defects with no effect on results

`modUtil.WriteValue` contains a stray line label `6`; `ScoreInBand` (D-09); `Rerun` compares the Ratings row by column positions (correct today, fragile). Noted only.

### D-27 Reviewer field

The Reviewer is captured but labelled "Not used". Your brief makes review an optional workflow step; the importer will map it to the rating's reviewer if present (it is blank in all 7 ratings).

### D-36 Delay shock costed as a full-year loss

A collection delay of d days is costed as `forecast revenue × d / 365` and deducted from annual cash flow. That treats a one-off working-capital delay as a recurring cost. It is the methodology's choice (s5.3), so it is reproduced; flagged for the IC only.

### D-52 "Entered by" on Deal Activity

The workbook writes `Application.UserName` (the PC's user name). The importer keeps the text; new entries record the signed-in user.

---

## Brief versus workbook

* The brief lists modules "B1 to B7C, PF-RE, PF-SCH, PF-IND". The workbook also has **PF-LOG** (logistics hub) and **PF-REN** (renewable energy plant, factor set B7P). All 12 will be imported.
* The brief describes Pipeline stages, rating statuses Submitted/Reviewed/Superseded, an IC sign-off step and a reviewer step that the workbook does not have. These are new workflow features and do not change results.
* The brief puts the blacklist knockout switch in Admin "Switches"; the workbook keeps it on the Blacklist sheet (D-22).
* The brief says "Override Log … above 15% triggers a methodology review": matches (`Ovr_RateTrigger`).
* Everything else in the brief's sheet table matches the workbook (13 checks, 102 self-test checks all passing, KO1 to KO6, 15 collateral lines, ~280 names: there are 318 including aliases and stale names).
