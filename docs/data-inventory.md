# Data inventory

Every input, output and table in `Crowdaxe_CRS.xlsm` (Workbook 1.1), with the field name proposed for the web app and engine. The "Cell" column is the `RatingInputs` key the importer maps from (`Sheet!Cell`, values encoded `S:` text, `N:` number, `D:` date `yyyy-mm-dd`, `B:` boolean, `E:` empty).

Visibility rules (from the wizard, `clsWizardCtl.RuleVisible`): **All** = always shown; **SS** = module has a sub-sector set; **B5** = module B5 only; **REN** = module PF-REN only; **PF** = Project finance track only; **Corp** = Corporate track only.

---

## 1. Rating inputs

### 1.1 Deal (wizard step "Deal")

| Field (engine) | Label | Type / allowed values | Required (check 1) | Visible | Cell |
|---|---|---|---|---|---|
| dealId | Deal ID | text `CX-yyyy-nnn`, automatic | yes | All | Scorecard!C6 |
| borrowerName | Borrower | text | yes | All | C7 |
| regNo | Company registration number | text (lookup key) | yes | All | C8 |
| ratingType | Rating type | New, Review (`lst_RatingType`) | yes | All | C9 |
| moduleCode | Sector module (B0) | B1, B2, B3, B4, B5, B6, B7C, PF-RE, PF-SCH, PF-IND, PF-LOG, PF-REN | yes | All | C10 |
| b0UnderConstruction | Asset under construction or under two years of operation? | Yes/No | no | All | C12 |
| b0GenerationAsset | Generation asset (solar, hydro, biomass, mini-grid)? | Yes/No | no | All | C13 |
| facilityType | Facility type | Term loan, Working capital line, Trade finance, Inventory finance, Receivables finance, Asset finance, Project finance (`lst_FacilityType`) | yes | All | C15 |
| amount | Facility amount (US$) | number > 0 | yes | All | C16 |
| eadInput | Exposure at default, if different (US$) | number, optional | no | All | C17 |
| tenorMonths | Tenor (months) | number | yes | All | C19 |
| ratingDate | Rating date | date (set on save today, D-03) | yes | All | C20 |
| analystName | Analyst | text (web app: the user) | yes | All | C21 |
| reviewerName | Reviewer ("Not used") | text | no | hidden | C22 |
| statementsBasis | Financial statements basis | "USD, restated at actual conversion rates", "IAS 29 (ZiG, inflation-adjusted)" | yes | All | C23 |
| accountsType | Accounts type | "Audited USD accounts or fully reconciled bank records", "Management accounts only, partly reconciled", "Largely cash business; key figures unverified" (`lst_Accounts`; position sets the expected information-quality overlay 0/1/2) | yes | All | C24 |
| subSector | Sub-sector | sub-sector names of the module's set | no (factor needs it) | SS | C25 |
| offtakerGrade | Offtaker or anchor grade | 1 to 10, or "Ungraded international buyer" (`lst_Offtaker`) | no | All | C26 |
| offtakerType | Renewables offtaker | B7P sub-sector names | no | REN | C27 |
| stressedLtv | Stressed LTV, value −25% | decimal (0.85 = 85%) | no | B5 | C28 |
| sponsorRegNo | Sponsor registration number | text | no | PF | C29 |
| ko3RepaymentsBeforeCash | Repayments fall due before the cash cycle produces cash? | Yes/No | yes | All | C30 |
| proceedsControlled | Repayment proceeds controlled by Crowdaxe? | Yes/No (no effect, D-06) | no | not in wizard | C31 |
| completionCertified | PF: completion certified? | Yes/No | no | PF | C32 |
| completionGuarantorGrade | PF: completion guarantor's grade | 1 to 10 | no | PF | C33 |
| bankPerformanceBond | PF: bank performance bond covering completion? | Yes/No | no | PF | C34 |

### 1.2 Financials (wizard step "Financials"; used on the Corporate track)

| Field | Label | Cell |
|---|---|---|
| revenue[y-2], revenue[y-1], revenue[y] | Revenue (US$), two years ago / last year / latest year | Financials!C6, D6, E6 |
| ebitda[y-2], ebitda[y-1], ebitda[y] | EBITDA (US$) | C7, D7, E7 |
| existingDebt | Existing total debt, before this facility | E10 |
| cash | Cash and bank balances | E11 |
| currentAssets | Current assets | E12 |
| currentLiabilities | Current liabilities | E13 |
| totalEquity | Total equity | E14 |
| propertyValue | Property market value (real estate only) | E15 |
| forecastRevenue | Forecast revenue (blank = latest year) | E18 |
| forecastEbitda | Forecast EBITDA (blank = latest year) | E19 |
| tax | Tax to be paid | E20 |
| maintenanceCapex | Maintenance capital expenditure | E21 |
| workingCapitalIncrease | Increase in working capital | E22 |
| annualInterest | Annual interest, including this facility | E23 |
| annualDebtService | Annual debt service (interest plus principal), including this facility | E24 |
| revenueVerified | Revenue verified through bank statements, latest year | E27 |
| ownersCash | Owners' cash put into the business | E28 |
| totalFundingNeed | Total funding need | E29 |
| zigRevenueShare | Share of revenue received in ZiG (decimal) | E30 |
| variableCostShare | Variable costs as a share of revenue (decimal) | E31 |

All numbers in US$ unless a share. All optional; the metrics they feed are listed in `methodology-spec.md` section 4.

### 1.3 Factors (wizard steps for the pillars)

One entry per factor row (key `Set|Ord`, for example `B1|7`). Cells: rows 38 to 67 in grid order (module factors, then CORE).

| Field | Meaning | Cell |
|---|---|---|
| metric | number typed for a Numeric factor (overrides the Financials auto value) | G |
| score | analyst score 1 to 5: required for Descriptor; optional override on Numeric/SubSector/Offtaker | J |
| notApplicable | "Yes" (optional factors only) | K |
| evidence | evidence (descriptor) or reason (override) | N |

The importer must map grid row → factor key using the module saved with the rating (row 38 + i − 1 = i-th factor of the module set, then CORE).

### 1.4 Sector questions (step "History & flags")

Per question (key `Module|Ord`), rows 71 to 82: `answer` Yes/No/N/A (G), `explanation` (N).

### 1.5 Stress shocks (step "Financials")

Per shock (key `Module|Ord`), rows 86 to 93: `apply` Yes/No (G), `valueUsed` number (H, optional), `reason` (N).

### 1.6 Overlays (step "Overlays")

Per overlay 1 to 5, rows 109 to 113: `notches` whole number 0 to max (E), `reason` (N).

### 1.7 Deal History (step "History & flags")

| Field | Cell |
|---|---|
| characterJustification (when Character is above the suggestion) | Scorecard!N129 |
| historySnapshot (new): counts by status, blacklist status, as-of date, source event IDs | not in workbook (D-01) |

### 1.8 Structure and collateral (step "Structure")

| Field | Type | Cell |
|---|---|---|
| structureName | from structures of the track | Scorecard!C141 |
| notchesApplied | whole number within the structure's min to max | C143 |
| structureReason | text (partial uplift, ungraded offtaker) | C146 |
| collateral[i].type | from the module's haircut set | Collateral!C9:C23 |
| collateral[i].value | US$ | D |
| collateral[i].haircut | decimal, optional (blank = midpoint) | G |
| collateral[i].crossBorderNoTracking | Yes/No (B4 add-on) | H |
| collateral[i].note | text, required when the haircut is not the midpoint | L |

### 1.9 Override and pricing (step "Result")

| Field | Cell |
|---|---|
| obligorOverrideGrade (1 to 10, blank = model) | Scorecard!C136 |
| facilityOverrideGrade (1 to 10, blank = model) | C153 |
| overrideReason | C158 |
| icApproverName (web app: approving user) | C159 |
| icApprovalDate | C160 |
| proposedAllInYield (decimal, optional) | C170 |

---

## 2. Outputs (engine result)

| Output | Type | Workbook |
|---|---|---|
| track, suggestedTrack, trackCheckText, moduleName | text | C11, C14, D14, D10 |
| ead | number | C18 |
| financialMetrics: SCALEX, PROPVAL, MARGIN, PFDEBT, LEV, ICR, CR, DE, CASHM, LTV, DY, RESM, VERIF, MEANS, FCREV, FCEBITDA, CFADS, DSCRB, SHOCKS, DSCRS | number or null | Financials!H6:H25 |
| factors[]: key, pillar, name, weight, effectiveWeight, measure, metricUsed, metricSource (typed/Financials), band, bandText, calculatedScore, scoreUsed, weighted, meaning, status, modifiers applied | per row | Scorecard!B:BV 38-67 |
| questions[]: kind, text, flagAnswer, status | per row | rows 71-82 |
| shocks[]: name, size, type, valueUsed, cost, status | per row | rows 86-93 |
| pillars: P1, P2 before rules, P2, CAMP, PF1..PF5 (score, weight sum, applies, rule note) | | C96:E104, F98 |
| blendedScore, gradeScore | number | C105, C106 |
| overlays[]: name, max, descriptor, status; overlayTotal; scoreAfterOverlays | | rows 109-115 |
| history: reg looked up, counts[7], summary, adjustment, characterFlag, characterStatus | | C118:C129, P129 |
| obligorScore, gradeBeforeHistory, obligorModel, obligorFinal, obligorOverrideStatus | | C132:C138 |
| structure: min, max, notchesUsed, notchingText, selfLiquidating, conditions | | C141:C147, S141:S146 |
| facility path: beforeLimits, afterUpliftFloor, afterOfftakerCap, afterConstructionCap, facilityModel, facilityFinal, facilityOverrideStatus | | C148:C155 |
| overrideApplied, overrideBlocked, overrideRateText | | modOverride, C161 |
| collateral[]: rangeText, suggested, haircutUsed, recoverable, status; totals; lgdFormula; lgd; lgdBasis; coverText | | Collateral!D25:D30 |
| pd, elPct, elUsd, minYield (number or "Pricing inputs not set"), pricingStatus | | C164:C171 |
| knockouts: KO1, KO2, KO3 (Knockout/Clear), KO4, KO5 (Decline/Clear), KO6 (Knockout/Warning/Clear) | | C174:C176, Knockouts!F9:F10, Blacklist!C5 |
| recommendation, reviewCycle, nextReviewDate | | C177:C179 |
| checks[13]: status, detail; summary; counts | | Checks!D4:E20 |
| summary panel strings (facility grade label, PD text, loss line, next review line, grade-score line, Deal History line) | | Scorecard!H6:J27 |

---

## 3. Stored records (workbook tables → database)

| Sheet / table | Columns | Rows today | Web app table |
|---|---|---|---|
| Ratings (`tblRatings`) | Rating ID, Deal ID, Borrower, Reg number, Module, Track, Rating type, Rating date, Analyst, Reviewer, Blended score, Obligor model, Obligor final, Facility model, Facility final, PD, LGD, EAD USD, EL USD, Recommendation, Overridden, Deal History on, Methodology version, Status (Draft/Final), Saved at | 7 (all Final) | `ratings` |
| RatingInputs (`tblRatingInputs`) | Rating ID, Key (`Sheet!Cell`), Value (encoded) | 574 | `rating_inputs` (structured, section 1) |
| Pipeline Register (`tblPipeline`) | Deal ID, Borrower, Sector module ("B1 - …"), Track, Facility, Amount USD, Obligor grade, Facility grade, PD, LGD, EL USD, Recommendation, Stage, Analyst, Reviewer, Rating date, Next review, Methodology version, PDF path | 6 | `deals` (stage) + view over latest Final rating |
| Override Log (`tblOverrideLog`) | Date, Deal, Rating ID, Grade (Obligor/Facility), Model grade, Final grade, Notches moved, Reason, Approved by, Approval date, Analyst | 1 | `overrides` |
| Deal Activity (`tblActivity`) | Entry ID, Reg number, Borrower, Deal ID, Event, Event date, Due or maturity date, Amount due USD, Amount paid USD, Days late, Notes, Entered on, Entered by | 26 | `deal_activity` |
| Deal History (`tblDealHistory`) | Reg number, Borrower name, Deal ID, Facility type, Amount USD, Disbursement date, Maturity date, Status, Max DPD, Notes | 5 (all derived) | derived view + `manual_history_records` (D-33) |
| Blacklist (`tblBlacklist`) | Reg number, Borrower, Status (Active/Lifted), Blacklisted on, Reason, Lifted on, Updated | 1 | derived view |
| Changelog | Version, Date, Change | 1 | `changelog` (import as history) |
| ErrorLog (hidden) | Timestamp, Procedure, Error number, Description, User | 91 | not imported (Excel build errors only) |
| TestCases (hidden) | Case, Kind, Key, Value, Tolerance; results | 29 cases, 102 checks | engine test fixtures |

Companies are not a table in the workbook. They are derived from registration numbers on Ratings, Deal Activity and Deal History (3 today: 3187/2011, 6642/2016, 2259/2013).

---

## 4. Methodology tables (become parameter set 1.1)

| Table | Columns | Rows |
|---|---|---|
| Parameters (scalars) | Name, Value, Unit (pct, num, x, text), Methodology ref, Note; PROPOSED flagged in the ref | 52 |
| Rating scale (`gr_*`) | Grade, Description, CX scale, Annual PD, Appetite, Review months, Review cycle | 10 |
| Zimbabwe overlays (`ov_*`) | Ord, Overlay, Max notches, descriptors for 0, 1, 2 notches | 5 |
| Structures (`st_*`) | Code, Track, Structure, Min notch, Max notch, Self-liquidating eligible, Offtake, Methodology, Conditions | 10 |
| Modules (`md_*`) | Code, Module, Track, Factor set, Sub-sector set, Haircut set, Methodology | 12 |
| Factors (`fac_*`) | Set, Ord, Key, Pillar, Profile, Factor, Weight, Measure, Unit, Type, Dir, Scale, NB, b1-b4, f1-f4, TopCut, BotCut, Neg, Judge, Group, Optional, TrackOnly, Role, Link, T1-T5, Ref, Auto | 132 (sets B1 12, B2 13, B3 12, B4 13, B5 11, B6 12, B7C 14, PC 17, B7P 20, CORE 8) |
| Sub-sectors (`ss_*`) | Set, Ord, Key, Sub-sector, Score low, Score high (1-10 grades), Special (ANCHORGRADE, GRADEPLUS1) | 44 (B1 6, B2 7, B3 7, B4 6, B5 7, B6 5, B7P 6) |
| Collateral haircuts (`hc_*`) | Set, Ord, Key, Collateral, Haircut low, Haircut high, Cross-border add-on, Methodology; module rows marked "(linked)" are formulas pointing at the CORE row | 112 (CORE 9; 65 linked copies) |
| Sector questions (`qt_*`) | Code, Ord, Key, Kind (Red flag/Condition/Modifier), Question, Flag answer, Target factor, Modifier (Add/Min/Set), Value, Methodology | 57 |
| Stress shocks (`sh_*`) | Code, Ord, Key, Shock, Size, Methodology, Costed as (Volume/Price/Cost/Delay/FX/Info), Default value | 65 |
| Lists (static) | lst_YesNo, lst_YesNoNA, lst_RatingType, lst_FacilityType, lst_Statements, lst_Accounts, lst_ShockStatus (unused), lst_Band5 and lst_Band3 (unused), lst_HistStatus, lst_Stage, lst_None, lst_Offtaker | 13 lists |
| Lists (dependent, named formulas) | lst_Module, lst_SubSector (by module's sub-sector set), lst_Collateral (by haircut set), lst_Structure (by track), lst_OfftakerType (B7P sub-sectors) | derived |
| Deal Activity event types | 10 event names | 10 |
| Versions | Method_Version 1.1, CRS_Version 1.1, Guide_Version "Colour & Brand Guide v1.1" | – |

The order of `lst_HistStatus` and `lst_Accounts` carries meaning (history counts, information-quality notches); the web app will store an explicit code and sort order for each list item rather than rely on position.

---

## 5. Personal and confidential data (for `data-protection.md`)

Borrower company name, registration number, sponsor registration number, financial statements, collateral descriptions, repayment events and amounts, blacklist reasons, analyst and approver names, free-text evidence (which may mention directors or owners by name), Screening Note PDFs. No director table exists in the workbook; directors appear only in free text.
