# Crowdaxe CRS: methodology specification

Source: `Crowdaxe_CRS.xlsm`, Workbook 1.1, Methodology 1.1, last self-test 3 November 2026 (102 of 102 passed).
Status: Phase 0 extraction for approval. This document describes what the workbook **does today**, formula by formula. Where the workbook looks wrong or ambiguous, the behaviour is still described exactly as it is, and the point is logged in `discrepancies.md` (cited as **D-nn**). Nothing here is a methodology change.

How this was verified: every formula on the Scorecard, Financials, Collateral, Knockouts, Checks, Blacklist and Override Log sheets was read from the file (not from cached values), and the workbook was recalculated independently in LibreOffice through a script (`tools/oracle/`). That recalculation passes all 102 workbook self-test checks, and it reproduces all 7 saved ratings exactly once Deal History and Blacklist are rebuilt as they stood on each rating date (see section 13).

Conventions used below:

* `Name` in code font is a workbook defined name (parameter or table column). The value in brackets is the current Methodology 1.1 value.
* "blank" means an empty cell or the empty string `""`. Excel treats them the same in these formulas.
* `ROUND` means Excel's `ROUND`: half away from zero, applied after Excel's own 15-significant-digit representation. Section 1.3 says how the engine replicates it.
* Cell references (for example `Scorecard!C105`) are given so each rule can be traced back to the workbook.

---

## 1. Scales, rounding and numeric conventions

### 1.1 Two scales that run in opposite directions

| Quantity | Range | Strongest | Parameter |
|---|---|---|---|
| Factor score, pillar score, blended score | 1 to 5 | 5 | `Scale_Max` (5), `Scale_Min` (1) |
| Grade score, obligor grade, facility grade | 1 to 10 | 1 | grade table rows 1 to 10 |

Conversion from a 1 to 5 score `s` to the 1 to 10 grade score:

```
gradeScore(s) = 1 + (Scale_Max − s) × Grade_Factor            Grade_Factor = 2.25
```

Inverse, used to turn a 1 to 10 grade (or a grade number from a modifier or sub-sector table) into a 1 to 5 score:

```
scoreOfGrade(g) = 1 + (10 − g) / Grade_Factor
```

Note: the `10` in the inverse, and the `10` used as the top of the grade scale throughout, are written as literals in the formulas. The engine will take them from the length of the rating-scale table (see **D-07**).

### 1.2 Grade rounding: nearest whole grade, .5 to the weaker grade

Wherever a grade score becomes a whole grade:

```
grade(x) = clamp(1, 10, INT(ROUND(x, 2) + 0.5))
```

* `ROUND(x, 2)` first removes floating-point noise (for example 4.609999999999999 becomes 4.61).
* `INT(... + 0.5)` rounds half up, so x.50 goes to the higher grade number, which is the weaker grade. Self-tests T05A (6.50 → 7), T05B (6.43 → 6) and T05C (5.52 → 6).
* Grade scores are never negative, so INT and FLOOR agree.

The same rule is used for the "Meaning" text of a factor score (`Scorecard!O38`): `gr_Desc[clamp(1,10,INT(1 + (Scale_Max − L) × Grade_Factor + 0.5))]`. That one has **no** inner `ROUND(…,2)` (see **D-16**).

### 1.3 Two-decimal rounding of scores

| Value | Formula | Cell |
|---|---|---|
| Factor calculated score | `ROUND(v, 2)` | `I38:I67` |
| Pillar score | `ROUND(ROUND(v, 9), 2)` | `C96:C104` |
| Blended score | `ROUND(ROUND(v, 9), 2)` | `C105` |
| Grade score | `ROUND(ROUND(v, 9), 2)` | `C106` |

The inner `ROUND(…, 9)` strips floating-point error before the half-up rounding to two decimals. So, for example, 2.995000000000001 and 2.994999999999999 both become 3.00.

**Engine rule (replicating Excel):** compute in IEEE doubles, exactly as Excel does, and implement `excelRound(x, n)` as: take `x` to 15 significant digits (Excel's internal representation), convert to `Decimal`, then round half away from zero to `n` places with decimal.js. `ROUND(ROUND(x,9),2)` is implemented literally as two calls. Grade-score-after-overlays and the Deal History adjustment are plain double additions that are **not** rounded (`C115`, `C133`); the `ROUND(…,2)` in the grade rule absorbs the noise.

Numbers shown in text (`TEXT(x, "#,##0")`, `"0.00"`, `"0.0%"` …) follow the same rule: Excel takes the value to 15 significant digits before rounding for display, so 1,799,155.4999999998 is shown as 1,799,156. The engine does the same (Phase 1 found that LibreOffice does not; see `phase-1-report.md`).

### 1.4 Blank versus zero

Many formulas test `ISNUMBER` or `= ""`. The engine models every optional numeric input as `number | null` and every text input as `string | null`. `N(x)` in Excel turns blank into 0; the spec states where that happens.

---

## 2. Calculation order (dependency graph)

1. Module lookup → track, factor set, sub-sector set, haircut set (section 3).
2. Financials → calculated metrics, base and stressed DSCR (section 4). Stressed DSCR needs the shock costs (section 7).
3. Sector questions (red flags, conditions, modifiers) → factor modifiers (section 6).
4. Factor grid → band, interpolated score, modifiers, calculated score, score used, effective weights, statuses (section 5).
5. Pillar scores → hard rules on Pillar 2 (KO2, B5 stressed LTV) → blend → grade score (section 8).
6. Overlays → grade score after overlays (section 9).
7. Deal History counts → adjustment → obligor model grade (sections 10, 11).
8. Obligor override → final obligor grade (section 14).
9. Structure notching → uplift floor → offtaker cap → construction cap → facility model grade (section 12).
10. Facility override → final facility grade (section 14).
11. Collateral → LGD (section 15). EAD (section 3).
12. PD, EL, minimum yield (section 16).
13. Knockouts, Blacklist (KO6), recommendation, review cycle, next review date (sections 17, 18).
14. Data checks (section 19).

KO2 depends on the base DSCR (step 2/4) and the structure's self-liquidating flag (step 9), and it feeds back into Pillar 2 (step 5). There is no circularity: self-liquidating comes from the structure choice, not from any grade.

---

## 3. Deal set-up and module lookup

Inputs are listed in `data-inventory.md`. Derived values:

| Output | Rule | Cell |
|---|---|---|
| Module name | `md_Name` for `sc_Module` | `D10` |
| Track | `md_Track` for `sc_Module` ("Corporate" or "Project finance"; blank if no module) | `C11` |
| Factor set | `md_FacSet` | `S6` |
| Sub-sector set | `md_SSSet` (blank for PF-RE, PF-SCH, PF-IND, PF-LOG) | `S7` |
| Haircut (collateral) set | `md_HCSet` | `S8` |
| Suggested track (B0) | "Project finance" if B0 asset-under-construction = Yes **or** B0 generation-asset = Yes, otherwise "Corporate" | `C14` |
| Track check text | blank if no module; "Matches the module track" if suggested = track; otherwise "Check: B0 suggests …" | `D14` |
| EAD used | `sc_EADInput` if it is a number, otherwise `sc_Amount` | `C18` |

The track always comes from the module. The B0 answers never change it; they only produce data check 2 (section 19).

Number of grid rows: `nFac` = count of factors in the module's factor set; `nCore` = count of factors in set `CORE` (only if a module is chosen); `nQ` = number of questions for the module code; `nShock` = number of shocks for the module code. The workbook's grids have fixed capacity (30 factor rows, 12 question rows, 8 shock rows, 15 collateral rows). The largest current module uses 28 factor rows (B7P 20 + CORE 8), 9 questions (B3) and 8 shocks (PF-REN). The engine has no fixed capacity.

Factor rows are ordered: the module's factors in `fac_Ord` order, then the CORE factors in order. A factor row's key is `"<set>|<ord>"`, for example `B1|7` or `CORE|2`.

---

## 4. Financials (Corporate track)

Inputs (US$): revenue and EBITDA for up to three years (two years ago, last year, latest year); latest-year balance sheet; next-12-month figures; other information. Calculated metrics (`Financials!H6:H25`, codes in column J):

| Code | Metric | Formula (E = latest year column) |
|---|---|---|
| SCALEX | Revenue ÷ amount requested | if `N(E6) > 0` and `N(sc_Amount) > 0`: `E6 / sc_Amount`, else blank |
| PROPVAL | Property market value | if `N(fin_PropVal) > 0`: `fin_PropVal`, else blank |
| MARGIN | Average EBITDA margin over the years with revenue > 0 | for each year with `N(rev) > 0`: `N(EBITDA)/rev`; average over those years; blank if no year has revenue |
| PFDEBT | Total debt including this facility | `N(fin_Debt) + N(sc_EAD)` (always a number, can be 0) |
| LEV | Leverage | blank if latest EBITDA is not a number; **−1** if EBITDA ≤ 0; else `PFDEBT / EBITDA` |
| ICR | Interest cover | blank if EBITDA not a number or `N(interest) = 0`; else `EBITDA / interest` |
| CR | Current ratio | blank if CA not a number or `N(CL) = 0`; else `CA / CL` |
| DE | Debt to equity | blank if equity not a number; **−1** if equity ≤ 0; else `PFDEBT / equity` |
| CASHM | Cash in months of operating cost | blank if cash not a number or `N(rev) − N(EBITDA) ≤ 0`; else `cash / ((rev − EBITDA)/12)` |
| LTV | Loan to value | if `N(propVal) > 0`: `PFDEBT / propVal`, else blank |
| DY | Debt yield | blank if EBITDA not a number or `PFDEBT ≤ 0`; else `EBITDA / PFDEBT` |
| RESM | Cash reserve in months of debt service | blank if cash not a number or `N(DS) = 0`; else `cash / (DS/12)` |
| VERIF | Share of revenue verified by bank statements | blank if verified not a number or `N(rev) = 0`; else `MIN(1, verified / rev)` |
| MEANS | Owners' cash ÷ total funding need | blank if owners' cash not a number or `N(need) = 0`; else `ownerCash / need` |
| FCREV | Forecast revenue used | forecast revenue input if a number, else `N(E6)` |
| FCEBITDA | Forecast EBITDA used | forecast EBITDA input if a number, else `N(E7)` |
| CFADS | Cash available for debt service | `FCEBITDA − N(tax) − N(maintenance capex) − N(increase in working capital)` |
| DSCRB | Base-case DSCR | blank if `N(DS) = 0` or (latest EBITDA not a number **and** forecast EBITDA not a number); else `CFADS / DS` |
| SHOCKS | Cost of ticked stress shocks | `Σ shock cost` (section 7) |
| DSCRS | Stressed DSCR | blank if DSCRB blank; else `(CFADS − SHOCKS) / DS` |

Two helper inputs feed the shocks: ZiG share of revenue (`fin_ZiG` = `N(input)`) and variable cost share (`fin_VarCost` = `N(input)`).

"−1" is a sentinel meaning "negative EBITDA or negative equity". It is scored by the factor's `Neg` flag (section 5.3).

**Auto-fill into factors (Corporate track only).** A factor with an `Auto` code takes the metric with that code **only when the track is Corporate** and the analyst has not typed a number into the factor's metric cell (`AX`, `AY`). A number typed on the factor always wins. On the Project finance track, Financials is ignored and the analyst types metrics on the factors directly.

---

## 5. Factor scoring

### 5.1 Factor definition fields (Modules sheet, `fac_*`)

| Field | Meaning | Used by v1.1 formulas? |
|---|---|---|
| Set, Ord, Key | factor set, order, key `Set|Ord` | yes |
| Pillar | P1, P2, CAMP (Corporate) or PF1 to PF5, CAMP (Project finance) | yes |
| Profile | sub-heading (Business, Financial, Coverage …) | display only |
| Factor, Measure, Unit | names and unit (`x`, `%`, `USD`, `years`, `days`, `months`) | display (unit also formats text) |
| Weight | weight within its pillar | yes |
| Type | `Numeric`, `Descriptor`, `SubSector`, `Offtaker`, `Link` | yes |
| Dir | `H` = higher is better, `L` = lower is better | yes |
| Scale | 5 or 3 (number of bands) | yes (descriptor list, legacy band ranges) |
| NB | number of band boundaries (4 or 2) | yes |
| b1 to b4 | band boundaries, strongest first | yes |
| f1 to f4 | f-flag per boundary: 1 = a value equal to the boundary belongs to the **stronger** band | yes (band label only) |
| TopCut, BotCut | v1.0 open-band suggestion cut-offs | **no** (D-09) |
| Neg | 1 = a negative metric (sentinel −1) scores the weakest | yes |
| Judge | v1.0 judgement range | **no** (D-09) |
| Group | weight-sharing group for optional factors (`WCE`, `RES`) | yes |
| Optional | 1 = analyst may mark N/A | yes |
| TrackOnly | factor applies only on this track (CORE|1 is Corporate only) | yes |
| Role | `BASEDSCR` (feeds KO2) or `CHAR` (feeds KO1) | yes |
| Link | `CAMP`: factor score is the CAMPARI pillar score | yes |
| T1 to T5 | band descriptors, strongest first | yes |
| Ref | methodology reference | display |
| Auto | Financials metric code | yes |

### 5.2 Applicability and effective weights

For each factor row:

```
applies = (TrackOnly is blank or TrackOnly = track) AND NOT (Optional = 1 AND analyst N/A = "Yes")
groupKey = (Group blank) ? factorKey : Pillar + "|" + Group
effectiveWeight = applies
    ? Weight × Σ(Weight of all rows with this groupKey) / Σ(Weight × applies of rows with this groupKey)
    : 0
```

So an optional factor marked N/A gives its weight to the other factors in its group, in proportion to their weights. A factor with no group keeps its own weight (its group is itself). Pillar scores divide by the sum of effective weights (5.7), so any lost weight is re-normalised anyway, but data check 5 (section 19) reports an error if a pillar's effective weights do not sum to 100% (within 0.000001). Today every optional factor has a group, so check 5 passes (see **D-10**).

If every member of a group is N/A, the formula divides by zero (`#DIV/0!`). No current group can reach that state through the wizard; the engine will treat it as weight 0 and raise a data error (**D-10**).

### 5.3 Numeric factors: band and interpolated score

Let `x` be the metric used: the number typed on the factor, else the Financials auto value (Corporate track), else blank.

**Band index** (drives only the "Methodology band" descriptor text shown beside the score, `Scorecard!H38`):

```
if x blank → no band
if Dir = L and x < 0:  band = (Neg = 1) ? NB + 1 : no band
for H:  band = 1 + Σ_{k=1..NB} ( [x < b_k] + [x = b_k] × (1 − f_k) )
for L:  band = 1 + Σ_{k=1..NB} ( [x > b_k] + [x = b_k] × (1 − f_k) )
```

`[…]` is 1 if true, else 0. The f-flag decides which band a value **exactly on** a boundary belongs to: `f_k = 1` puts it in the stronger band, `f_k = 0` in the weaker. The band text shown is `T_band` (T1 strongest … T5 weakest; three-band factors use T1 to T3).

**Interpolated score** (`BQ38`). Transform so that higher is always better: `h = x`, `c_k = b_k` for Dir H; `h = −x`, `c_k = −b_k` for Dir L. Anchors:

| NB | anchor at c1 | c2 | c3 | c4 |
|---|---|---|---|---|
| 4 | 4.5 | 3.5 | 2.5 | 1.5 |
| 2 | 4.0 | 2.0 | – | – |

```
if Dir = L and x < 0:   score = (Neg = 1) ? Scale_Min : blank
NB = 4:
  h ≥ c1:        MIN(Scale_Max, 4.5 + (h − c1)/(c1 − c2) × 1)
  c2 ≤ h < c1:   3.5 + (h − c2)/(c1 − c2) × 1
  c3 ≤ h < c2:   2.5 + (h − c3)/(c2 − c3) × 1
  c4 ≤ h < c3:   1.5 + (h − c4)/(c3 − c4) × 1
  h < c4:        MAX(Scale_Min, 1.5 − (c4 − h)/(c3 − c4) × 1)
NB = 2 (three-band factors):
  h ≥ c1:        MIN(Scale_Max, 4 + (h − c1)/(c1 − c2) × 2)
  c2 ≤ h < c1:   2 + (h − c2)/(c1 − c2) × 2
  h < c2:        MAX(Scale_Min, 2 − (c2 − h)/(c1 − c2) × 2)
```

Points to note:

* The score is a straight line through the anchors, so a boundary value gets the anchor value regardless of its f-flag. The f-flags affect only the band text (**D-11**).
* Above the top boundary the line continues with the slope of the top band and is capped at 5; below the bottom boundary it continues with the slope of the bottom band and is floored at 1. Self-tests E1 to E3.
* A Dir H metric below zero is simply extrapolated and floored at 1 (Neg only matters for Dir L).
* Equal adjacent boundaries divide by zero. Admin validation will require strictly monotonic boundaries (**D-12**).
* The anchors (4.5, 3.5, 2.5, 1.5 and 4, 2) are literals in the formula. The engine will store them as parameters `Interp_Anchors_NB4` and `Interp_Anchors_NB2` with today's values (**D-07**).

### 5.4 Sub-sector and offtaker factors

A `SubSector` factor uses the sub-sector picked on the Deal step; an `Offtaker` factor uses the renewables offtaker type. Each table row gives a grade range `Lo` to `Hi` on the 1 to 10 scale. Special rows:

* `ANCHORGRADE` (B3 payables finance on an anchor graded 1 to 4): `Lo = Hi = offtaker/anchor grade` if that grade is a number, else blank.
* `GRADEPLUS1` (B7P graded corporate offtaker): `Lo = Hi = MIN(10, offtaker grade + 1)` if a number, else blank.

Score:

```
base = ( scoreOfGrade(Hi) + scoreOfGrade(Lo) ) / 2          // midpoint of the converted range
```

Band text shown: `"<scoreOfGrade(Hi) to 2 dp> to <scoreOfGrade(Lo) to 2 dp>"`.

The sub-sector key is `SSSet|sub-sector name`; the offtaker key is always `B7P|offtaker type`. Note B7C uses sub-sector set B3 (nearest row, methodology item 14).

### 5.5 Modifiers from sector questions

Each sector question may target a factor key with a modifier type and value (section 6). For each factor, summing over questions **answered "Yes"** that target it:

```
add = Σ value of "Add" modifiers         → shift = −add / Grade_Factor       (grade points made weaker)
min = Σ value of "Min" modifiers         → cap   = scoreOfGrade(min) if min > 0     ("no better than grade min")
set = Σ value of "Set" modifiers         → fixed = scoreOfGrade(set) if set > 0     ("score set to grade set")
```

Calculated score (`I38`), for applicable Numeric, SubSector and Offtaker factors with a base score:

```
calculated = ROUND( fixed if set > 0
                    else MIN(cap or Scale_Max, MAX(Scale_Min, base + shift)), 2 )
```

Notes: the floor at `Scale_Min` is applied before the `Min` cap, and a `Set` value skips both bounds. Values are summed, not combined, so two `Min` modifiers on the same factor add their grade numbers (**D-13**: B6 has two Min modifiers on enrolment, 9 and 3; if both are Yes the cap is grade 12, a score of 0.11, below the 1 to 5 scale). Self-tests E4 (4.75 without the modifier) and E5 (2.33 with "no backup power", Min 7).

Descriptor factors have no calculated score; modifiers targeting a descriptor factor would have no effect. No current modifier targets one.

### 5.6 Score used, statuses and evidence

```
scoreUsed (L) = blank if not applicable
              = sc_CAMP (the CAMPARI pillar score) if Link = CAMP
              = analyst score (J) if entered, else calculated score (I)
```

The analyst may enter J on Numeric, SubSector and Offtaker factors to override the calculated score (validated as a decimal 1 to 5) and must enter it on Descriptor factors (whole number 1 to 5; the wizard offers "5 – T1 … 1 – T5", and on three-band descriptors "5 – T1, 4 – between, 3 – T2, 2 – between, 1 – T3").

Status (`P38`), first match wins:

1. no factor → blank
2. not applicable → "N/A"
3. score used blank → "Score required"
4. linked → "OK (linked)"
5. Descriptor and score not a whole number in 1..5 → "Whole number 1-5 required"
6. calculated score and analyst score both present and `|J − I| > 0.005` → "Override: reason required" if evidence/reason (N) blank, else "Override (reason given)"
7. no calculated score (i.e. Descriptor, or Numeric with no metric scored from an analyst entry) and evidence blank → "Evidence required"
8. otherwise "OK"

So a Numeric factor scored from its metric needs no evidence; a Descriptor factor always needs evidence; any departure from a calculated score needs a reason. A Numeric factor with no metric but an analyst score is treated like a descriptor (evidence required).

Meaning text (`O38`): `gr_Desc[grade(gradeScore(scoreUsed))]` without the 2-dp pre-round (1.2).

### 5.7 Pillar scores

For each pillar code P (P1, P2, PF1 … PF5) using only rows with that pillar:

```
missing = any applicable, non-linked row with blank score used
W       = Σ effectiveWeight
linkW   = Σ effectiveWeight of linked rows (Link = CAMP)
blank if missing, or W = 0, or (linkW > 0 and CAMPARI pillar is blank)
pillar  = ROUND(ROUND( (Σ effectiveWeight × scoreUsed over non-linked rows + linkW × CAMP) / W , 9), 2)
```

The CAMPARI pillar (`C99`) is computed the same way over rows with pillar `CAMP` (no linked rows inside it). On the Corporate track it is Pillar 3; on the Project finance track it is the sponsor CAMPARI that feeds the PF5 `Link` factor. The CORE factors (Character, Ability, Means, Purpose, Amount, Repayment, Insurance) are loaded for every module. CORE|1 "Cash flow quality" is a P2 factor limited to the Corporate track.

### 5.8 Linked roles

* `sc_Char` = score used on the row with Role `CHAR` (CORE|2 Character). Feeds KO1 and the Deal History character review.
* `sc_BaseDSCR` = metric used (`AY`, not the score) on the row with Role `BASEDSCR`, blank if none. Feeds KO2.

---

## 6. Sector questions (red flags, conditions, modifiers)

Each module has questions with: kind (Red flag, Condition, Modifier), question text, flag answer (`Yes` for red flags and modifiers, `No` for conditions), optional target factor key, modifier type (`Add`, `Min`, `Set`) and value, methodology reference. Allowed answers: Yes, No, N/A.

Status (`P71`):

* blank answer → "Answer required"
* answer = flag answer → "Explanation required" if explanation blank, else "Modifier applied (explained)" for kind Modifier, "Flagged (explained)" otherwise
* any other answer (including N/A) → "OK"

Modifiers apply when the answer is literally "Yes" (section 5.5), regardless of the explanation. Questions never stop a rating by themselves.

---

## 7. Stress shocks

Each module has shocks with: shock name, size text, methodology reference, costing type (`Volume`, `Price`, `Cost`, `Delay`, `FX`, `Info`) and default value. Analyst inputs: Apply (Yes/No), value used (optional), reason.

```
valueUsed = analyst value if a number, else default value
cost = 0 if not "Yes" or track ≠ Corporate
Volume: FCREV × valueUsed × (1 − fin_VarCost)
Price:  FCREV × valueUsed
Cost:   MAX(0, FCREV − FCEBITDA) × valueUsed
Delay:  FCREV × valueUsed / 365            (valueUsed in days)
FX:     FCREV × fin_ZiG × valueUsed
Info:   0
```

Status (`P86`): blank Apply → "Answer required"; "No" with no reason → "Reason required (not applied)"; value typed and `|value − default| > 0.000001` with no reason → "Reason required (value changed)"; Info type → "OK (not costed: describe its effect)"; else "OK". Shocks are only costed on the Corporate track; on Project finance the analyst enters the stressed DSCR on the PF1 factor.

---

## 8. Pillar 2 hard rules, blend and grade score

### 8.1 Pillar 2 after hard rules (Corporate only, `C98`)

```
if track ≠ Corporate → blank
else if KO2 = Knockout → KO2_P2Score (1)
else if Pillar 2 before rules is blank → blank
else if module = B5 and stressed LTV is a number and stressed LTV > RE_StressLTV_Trigger (0.85)
     → MIN(P2, RE_P2_Cap (1.89))
else P2
```

KO2 forces Pillar 2 to 1 even though the recommendation will be a decline (self-test T03A). The B5 cap is described in the parameter note as "v1.0 grade 8 converted" (scoreOfGrade(8) = 1.89).

### 8.2 Blend (`C105`)

```
Corporate:       blank if P1, P2 (after rules) or CAMP is blank
                 ROUND(ROUND(Wt_P1×P1 + Wt_P2×P2 + Wt_P3×CAMP, 9), 2)       weights 0.45 / 0.30 / 0.25
Project finance: blank if any of PF1..PF5 is blank
                 ROUND(ROUND(Wt_PF1×PF1 + … + Wt_PF5×PF5, 9), 2)             weights 0.35 / 0.20 / 0.15 / 0.15 / 0.15
```

### 8.3 Grade score (`C106`)

```
gradeScore = ROUND(ROUND(1 + (Scale_Max − blended) × Grade_Factor, 9), 2)
```

Worked example (self-test T01, the s9.4 worked example): P1 3.00, P2 2.95, CAMP 3.00 → blended 2.99 → grade score 5.52.

---

## 9. Zimbabwe overlays

Five overlays, each with a maximum number of notches and descriptors for 0, 1 and 2 notches: Currency mismatch (max 2), Information quality (2), Government and parastatal exposure (1), Climate and location (1), Policy and regulatory exposure (1).

```
overlayTotal = MIN(Overlay_Cap (3), Σ_i MIN(notches_i, max_i))      blank notches count as 0
afterOverlays = gradeScore + overlayTotal                            (no rounding)
```

Each notch makes the grade one step weaker. Status per overlay: blank → "OK"; `notches > max` → "Error: above maximum"; `notches > 0` with no reason → "Reason required"; else "OK". The cell validation limits notches to whole numbers 0 to 2; the formula itself would accept a negative number and reduce the total (**D-14**; the engine will reject negatives).

Self-test T04: 2 + 2 notches → total capped at 3; 5.52 → 8.52.

---

## 10. Deal History adjustment (PROPOSED s7.2)

### 10.1 Which company

```
historyReg = track = Project finance ? sponsor registration number : borrower registration number
```

Lookup is by exact registration number (Excel `COUNTIFS` is case-insensitive). Names are never used.

### 10.2 Counts

For each of the seven statuses in `lst_HistStatus` order (Repaid on time; Repaid late, max DPD 1-30; Repaid late, 31-90; Restructured; Defaulted; Live, current; Live, in arrears):

```
count_s = number of Deal History rows with reg = historyReg and status = s
        − (if Hist_LookbackYears is a number) number of those rows with maturity < EDATE(ratingDate, −12 × Hist_LookbackYears)
```

`Hist_LookbackYears` is blank today, so all history counts. Rows with a blank maturity are never excluded. The current deal's own Deal History row is counted too (relevant for Review ratings; **D-20**).

Summary text: "No registration number", "No previous Crowdaxe deals", or the non-zero counts joined with "; " (for example "1 repaid late (31-90 DPD); 1 live, in arrears").

### 10.3 Adjustment (added to the grade score after overlays)

```
if Hist_Enabled ≠ "Yes" → 0
penalty = (count[Repaid late 31-90] + count[Live, in arrears] > 0) ? Hist_Penalty (+0.5) : 0
credit  = (count[31-90] + count[arrears] + count[Restructured] + count[Defaulted] > 0) ? 0
        : count[Repaid on time] ≥ Hist_Credit2_Min (3) ? Hist_Credit2 (−0.5)
        : count[Repaid on time] ≥ Hist_Credit1_Min (1) ? Hist_Credit1 (−0.25)
        : 0
adjustment = penalty + credit
```

Consequences worth noting (all in **D-17**): late 1-30 DPD neither earns nor blocks a credit; Restructured and Defaulted block the credit but carry no score penalty; "Live, current" earns nothing.

### 10.4 Character review flag

If `Hist_Enabled = "Yes"` and Restructured + Defaulted > 0: flag text "Character should be `Hist_CharacterSuggest` (2) or lower", with " (current n)" appended when the Character score is a number above 2. Status: if Character is a number above 2, "Justification required" until the analyst writes a justification, then "Character above suggestion (explained)"; otherwise "OK". It is a check (12), not an automatic change to the Character score.

---

## 11. Obligor grade

```
scoreAfterOverlays   = afterOverlays                          (C132)
obligorScore         = scoreAfterOverlays + adjustment       (C133)
gradeBeforeHistory   = grade(scoreAfterOverlays)             (C134)
obligorModel = adjustment < 0
    ? MAX( grade(obligorScore), MIN(gradeBeforeHistory, Hist_BestGrade (3)) )
    : grade(obligorScore)                                     (C135)
```

So a history credit can never take the obligor grade better than 3, unless it was already better than 3 before the credit. A penalty is not limited. Self-tests T11A to T11D.

---

## 12. Structure notching and facility grade

### 12.1 Structure table

Each structure has: code, track, name, min notch, max notch, self-liquidating eligible (0/1), offtake (0/1), methodology reference, conditions for full uplift. The structure list offered is filtered by track. Current rows: S1 Warehouse receipt finance (0 to +3, self-liquidating), S2 Offtake and pre-export finance (0 to +3, self-liquidating, offtake), S3 Receivables finance (0 to +2), S4 Corporate general security (0 to +1), S5 Unsecured or subordinated (−2 to −1), S6 Distributor finance with anchor support (0 to +2, PROPOSED), P1 Full security package (+2), P2 Partial (+1), P3 Project assets only (0), P4 Subordinated (−2).

### 12.2 Notches used

```
notchesUsed = no structure ? 0 : clamp(min, max, N(notches entered))       (C144)
selfLiquidating = structure's self-liquidating flag = 1 ? "Yes" : "No"     (C147)
```

A positive notch makes the facility grade stronger (smaller number). Notches entered outside the range are clamped for the calculation and raise data check 10 as an error.

### 12.3 Facility grade path

```
beforeLimits = finalObligor − notchesUsed                                              (C148)
upliftFloor  = notchesUsed > 0 ? MAX(beforeLimits, MIN(finalObligor, Uplift_BestGrade (3))) : beforeLimits   (C149)
offtakerCap  = (structure.offtake = 1 and offtaker grade is a number) ? MAX(upliftFloor, offtakerGrade) : upliftFloor   (C150)
constructionCap = (track = Project finance and completion certified ≠ "Yes"
                   and NOT (bank bond = "Yes" or (guarantor grade is a number and guarantor grade ≤ Construct_GuarantorBest (4))))
                  ? MAX(offtakerCap, Construct_CapGrade (5)) : offtakerCap                  (C151)
facilityModel = clamp(1, 10, constructionCap)                                            (C152)
```

The facility grade starts from the **final** obligor grade (after any obligor override). Uplift cannot take the facility better than grade 3, or better than the obligor if the obligor is already better than 3. Self-tests T06 (obligor 4, +3 → 3), T07 (offtaker grade 5 caps at 5), T09A/T09B (construction cap).

---

## 13. Deal Activity → Deal History and Blacklist

Deal History and Blacklist are derived from Deal Activity events (`modActivity`). The rating engine itself only reads the derived counts and blacklist status. Those are time-dependent, so **the web app must snapshot them with each rating** (the workbook does not; this is why 3 of the 7 saved ratings no longer reproduce from the current sheets, while all 7 reproduce when history is rebuilt as at the rating date; **D-01**).

### 13.1 Event types and entry rules

Disbursement, Payment received, Payment missed, Restructured, Default, Repaid in full (transaction completed), Written off, Blacklisted, Blacklist lifted, Note.

Validation when adding an event: registration number required; event required; event date required and not later than tomorrow; Deal ID required except for Blacklisted, Blacklist lifted and Note; due date required for Payment received and Payment missed; amount paid required for Payment received and Disbursement; notes required for Blacklisted and Blacklist lifted; if the Deal ID already belongs to another registration number, refuse. Borrower name is filled from the latest known name for the registration number if blank.

```
daysLate = (event is Payment received or Payment missed) ? MAX(0, eventDate − dueDate) : blank
entryId  = "A-" + yyyymmdd-hhnnss + "-" + (row count + 1)
```

### 13.2 Per-deal status (RecalculateDeal), evaluated on date `today`

Over all events for the Deal ID (case-insensitive):

* Disbursement: disbursement date = earliest event date; maturity = due date of the last disbursement row that has one; amount = Σ amount paid.
* Payment received: maxDPD = MAX(maxDPD, days late).
* Payment missed: it is **cured** if any Payment received on the same deal has event date ≥ the missed event date and (either due date is blank or the due dates are equal). If not cured: in arrears, and `dpd = today − (due date, or event date if no due date)`, maxDPD = MAX(maxDPD, dpd). If cured: maxDPD = MAX(maxDPD, its stored days late).
* Restructured → restructured flag; Default or Written off → default flag; Repaid in full → repaid flag.
* If the deal has only notes or blacklist events, no Deal History row is written.

Status:

```
default flag or maxDPD > 90          → Defaulted               (s3.1: >90 DPD is a default)
else restructured flag               → Restructured
else repaid flag: maxDPD = 0         → Repaid on time
                  maxDPD ≤ 30        → Repaid late, max DPD 1-30
                  else               → Repaid late, 31-90
else in arrears                      → Live, in arrears
else                                 → Live, current
```

The row is upserted by Deal ID (registration number, name, facility type from the Pipeline Register if blank, amount, dates, status, max DPD, note "From Deal Activity, updated dd mmm yyyy"). Rows are never deleted when events are deleted (**D-21**). Because `today` is the recalculation date, an unpaid instalment's DPD keeps growing in reality but only changes on the sheet when a recalculation runs (**D-02**).

Verified: running this logic with each deal's "updated" date reproduces all five stored Deal History rows exactly (for example CX-2026-003, Defaulted, max DPD 158, recalculated 30 October 2026).

### 13.3 Blacklist (RecalculateBlacklist)

For a registration number, take the latest Blacklisted or Blacklist lifted event by event date (on a tie, the later row wins). Status Active if the latest is Blacklisted (since = its date, reason = its notes), Lifted if the latest is Blacklist lifted (lifted on = its date).

KO6 result (`Blacklist!C5`):

```
historyReg blank                       → Clear
no Active row for historyReg           → Clear
bl_Knockout = "No"                     → Warning
else                                   → Knockout
```

`bl_Knockout` (the KO6 switch) sits on the Blacklist sheet, not on Parameters (**D-22**). On Project finance the check uses the **sponsor's** registration number, not the borrower's (**D-23**).

---

## 14. Overrides (s10.2)

Inputs: final obligor grade (optional), final facility grade (optional), one shared reason, IC approver name, IC approval date.

For the obligor (and identically for the facility, comparing to the facility model):

```
if model blank → final blank
if input blank or input = model → final = model, status "No override"
else if reason blank → final = model, status "Blocked: written reason required"
else if |input − model| > Ovr_MaxNoApproval (1) and (approver blank or approval date blank)
     → final = model, status "Blocked: more than 1 notch needs IC approval"
else final = input, status "Override applied: +n (grade number)"   (n = input − model, signed)
```

The facility model grade is computed from the **final** obligor grade, so an obligor override moves the facility model too. "Overridden" on the Ratings row = either final grade differs from its model. A final save is refused while either status starts "Blocked". On final save one Override Log row is written per grade that moved: date, Deal ID, Rating ID, grade type (Obligor/Facility), model, final, notches moved (`final − model`, so positive = weaker), reason, approver, approval date, analyst.

Override rate (Override Log):

```
yearStart = DATE(YEAR(today) − (MONTH(today) < Ovr_YearStartMonth ? 1 : 0), Ovr_YearStartMonth, 1)
finals     = count of Ratings with rating date ≥ yearStart and status Final
overridden = count of those with Overridden = Yes
rate = finals = 0 ? 0 : overridden / finals
warning if rate > Ovr_RateTrigger (15%)
text "14.3% (1 of 7 ratings this year)" (+ " - above the 15% trigger")
```

---

## 15. Collateral and LGD (s8.2)

Per collateral line: collateral type (from the module's haircut set), value (US$), optional haircut, cross-border-no-tracking flag (B4), note.

```
key = HCSet + "|" + collateral name;  lo, hi, add-on from the haircut table (add-on only if cross-border = Yes)
range text = MIN(1, lo + addOn) [– MIN(1, hi + addOn)]
suggested  = MIN(1, (lo + hi)/2 + addOn)
haircutUsed = analyst haircut if a number, else suggested
recoverable = (collateral chosen and value and haircut are numbers) ? value × (1 − haircutUsed) : 0
status: "Error: not in this module's list" | "Value required"
      | "Out of range" (haircut outside [MIN(1,lo+add) − 0.00001, MIN(1,hi+add) + 0.00001])
      | "Note required" (analyst haircut differs from suggested by > 0.00001 and no note) | "OK"
```

Totals and LGD:

```
totalValue  = Σ value;  totalRecoverable = Σ recoverable
lgdFormula  = EAD not a number or EAD ≤ 0 ? blank : MAX(LGD_Floor (10%), 1 − totalRecoverable / EAD)
lgdUsed     = lgdFormula blank ? blank
            : totalRecoverable ≤ 0 ? LGD_Unsecured (75%)
            : LGD_CapAtUnsecured = "Yes" ? MIN(LGD_Unsecured, lgdFormula) : lgdFormula
basis text  = "Unsecured: no recoverable collateral" | "Floor for secured facilities (10%)"
            | "Capped at the unsecured LGD (75%)" | "Recoverable value against exposure"
cover text  = amount 0/blank ? blank : totalValue < amount ? "Warning: total collateral US$ … is below the amount requested US$ …" : "OK: collateral of US$ … covers the amount requested"
```

Module haircut tables contain rows "(linked)" to the CORE defaults: those cells are formulas pointing at the CORE row, so a change to a CORE haircut flows into every module copy.

---

## 16. PD, EL and pricing (s9.2)

```
PD        = gr_PD[final facility grade]                     (grade 10 → 100%)
EAD       = sc_EADInput if a number else sc_Amount
EL %      = PD × LGD           (blank if either is blank)
EL US$    = EL % × EAD
MinYield  = any of Price_CostOfFunds, Price_OperatingCost, Price_TargetMargin not a number
              → text "Pricing inputs not set"
            else Price_CostOfFunds + EL % + Price_OperatingCost + Price_TargetMargin (blank if EL % blank)
Pricing status: "Warning: pricing inputs not set" | proposed yield blank → "OK"
              | proposed yield < MinYield → "Warning: below minimum yield, IC approval needed" | "OK"
```

The three pricing parameters are blank today, so every rating shows "Pricing inputs not set" and check 13 is a warning.

---

## 17. Knockouts

| ID | Test | Effect |
|---|---|---|
| KO1 | Character score (`sc_Char`) is a number and ≤ `KO_CharScore` (1) | Knockout; recommendation `Txt_KO1` |
| KO2 | Track = Corporate, base DSCR is a number, base DSCR < `KO_DSCRMin` (1.00) and self-liquidating ≠ "Yes" | Knockout; Pillar 2 forced to `KO2_P2Score`; recommendation `Txt_KO2` |
| KO3 | Analyst answered "Yes" to repayments before cash | Knockout; recommendation `Txt_KO3` ("Not rated …") |
| KO4 | Final obligor grade ≥ `Dec_ObligorDecline` (8) | "Decline" on the Knockouts sheet; drives the decision |
| KO5 | Final facility grade ≥ `Dec_FacilityDecline` (7) | "Decline" on the Knockouts sheet; drives the decision |
| KO6 | Active blacklist entry for the history registration number, switch on | Knockout; recommendation `Txt_KO6` (the text is held in a defined name, not on Parameters; **D-22**) |

Grades, PD and EL are still calculated when a knockout fires.

---

## 18. Recommendation, review cycle and next review

Recommendation (`C177`), first match wins:

1. KO6 = Knockout → `Txt_KO6`
2. KO1 → `Txt_KO1`
3. KO2 → `Txt_KO2`
4. KO3 → `Txt_KO3`
5. final obligor or final facility grade not a number → "Incomplete: scores missing"
6. rating type = Review → "Existing exposure: " + `gr_Appetite[final facility grade]` (**D-19**: KO4/KO5 declines are not applied to Review ratings)
7. final obligor ≥ `Dec_ObligorDecline` (8) → `Txt_Decline`
8. final facility ≥ `Dec_FacilityDecline` (7) → `Txt_Decline`
9. final facility = `Dec_FacilityConditions` (6) → `Txt_Conditions`
10. otherwise `Txt_Approve`

Review cycle = `gr_Cycle[final facility grade]`. Next review date = `EDATE(rating date, gr_Months[final facility grade])` (EDATE: same day number n months later, clipped to month end). Both blank if the facility grade or rating date is missing. Current cycles: grades 1 to 5 annual (12 months), 6 to 8 quarterly (3), 9 monthly watchlist (1), 10 quarterly recovery (3).

The rating date is overwritten with the save date on every save (`SaveRating`), so next review is always counted from the save date (**D-03**).

---

## 19. Data checks (13)

Status is Passed, Warning or Error. A rating cannot be saved as Final while any check is Error. Summary: "n of `Checks_Total` (13) data checks passed"; counts "w warning(s), e error(s)".

| # | Check | Error | Warning | Passed detail |
|---|---|---|---|---|
| 1 | Required deal fields complete | any blank: Deal ID, Borrower, Reg no, Rating type, Module, Facility type, Amount (number), Tenor, Rating date (date), Analyst, Statements basis, Accounts type, KO3 answer ("n required deal field(s) blank") | – | "All required deal fields entered" |
| 2 | Track consistent with B0 | no module ("No module chosen") | suggested track ≠ module track ("B0 answers suggest X; module is Y") | "Module track matches B0" |
| 3 | Factor scores present; every override has a reason | any factor status "Score required", "Override: reason required" or "Whole number 1-5 required" | any "Override (reason given)" | "n missing, n override(s) without a reason, n override(s) with a reason" |
| 4 | Evidence for descriptor-based scores | any "Evidence required" | – | "n score(s) without evidence" |
| 5 | Weights sum to 100% in every pillar | no module, or any applicable pillar (P1, P2, P2-before-rules, CAMP on Corporate; PF1-PF5, CAMP on PF) whose effective weights differ from 1 by > 0.000001 | – | detail text does not cover the no-module case (**D-15**) |
| 6 | USD, not IAS 29 | statements basis blank, or starts with "IAS 29" | – | "USD restated" |
| 7 | Information quality overlay consistent with accounts type | accounts type blank | information-quality notches ≠ (position of accounts type in `lst_Accounts`) − 1; or position > 1 (consistent but not audited) | "Audited or reconciled" |
| 8 | Overlay notches reasoned and within maximum | any overlay status ≠ "OK" | – | "0 overlay row(s) need attention" |
| 9 | Stress shocks applied or adjusted with a reason | any shock status ending "required" | – | – |
| 10 | Structure notching within limits and reasoned | no structure; or notches entered (a number) ≠ notches used (out of range) | max notch > 0 and notches used < max and no reason (partial uplift); or offtake structure, offtaker grade not a number and no reason | the structure notching text |
| 11 | Collateral complete and covering the amount | any collateral row status ≠ "OK" | no collateral lines while a structure is chosen and its min notch ≥ 0; or cover text is a warning | "n item(s), recoverable US$ …" |
| 12 | Red flags, conditions and Deal History flags answered and explained | any question status ending "required", or character review "Justification required" | any status containing "explained" | – |
| 13 | Pricing inputs set | – | minimum yield not a number | "Minimum yield x.xx%" |

---

## 20. Saving, rating IDs and the Pipeline Register (workflow rules that touch results)

* Draft save: allowed with errors; needs Deal ID and Borrower.
* Final save: refused if any check is Error or any override is Blocked.
* On every save: rating date := today; a new Rating ID `R-yyyymmdd-hhnnss` (suffix `-n` if taken); one Ratings row (status Draft or Final) and all non-empty input cells to RatingInputs. Drafts are not replaced; every save adds a row (**D-04**).
* Final save also writes the Override Log rows and upserts the Pipeline Register row for the Deal ID: a new row starts at stage "Pipeline Deals" (or "Live Investment" for a Review rating); an existing row keeps its stage and PDF path.
* Deal IDs: `CX-<year>-nnn`, next number after the highest used for the current year on Ratings and the Pipeline Register.

Detailed user stories are in `workflow-spec.md`.

---

## 21. Parameter reference (Methodology 1.1)

| Name | Value | Unit | Ref | Status | Used in |
|---|---|---|---|---|---|
| Wt_P1 / Wt_P2 / Wt_P3 | 0.45 / 0.30 / 0.25 | pct | s9.1 | Approved | 8.2 |
| Wt_PF1 … Wt_PF5 | 0.35 / 0.20 / 0.15 / 0.15 / 0.15 | pct | C1 | Approved | 8.2 |
| Overlay_Cap | 3 | num | s7.1 | Approved | 9 |
| KO_CharScore (alias KO_CharMin) | 1 | num | s6.2 | Approved | 17 |
| KO_DSCRMin | 1.00 | x | s5.5 | Approved | 17 |
| KO2_P2Score | 1 | num | s5.5 | Approved | 8.1 |
| RE_StressLTV_Trigger | 0.85 | pct | B5.4 | Approved | 8.1 |
| RE_P2_Cap (alias RE_P2_Floor) | 1.89 | num | B5.4 | Approved | 8.1 |
| Uplift_BestGrade | 3 | num | s8.1 | Approved | 12.3 |
| Construct_CapGrade | 5 | num | C3 | Approved | 12.3 |
| Construct_GuarantorBest | 4 | num | C3 | Approved | 12.3 |
| LGD_Floor | 0.10 | pct | s8.2 | Approved | 15 |
| LGD_Unsecured | 0.75 | pct | s8.2 | Approved | 15 |
| LGD_CapAtUnsecured | Yes | text | item 22 | **PROPOSED** | 15 |
| Dec_ObligorDecline / Dec_FacilityDecline / Dec_FacilityConditions | 8 / 7 / 6 | num | s9.3 | Approved | 18 |
| Txt_Approve, Txt_Conditions, Txt_Decline, Txt_KO1, Txt_KO2, Txt_KO3 | texts | text | s9.3 etc. | Approved | 18 |
| Txt_KO6 | "Decline (knockout: company blacklisted by Crowdaxe)" | text | – | (defined name only) | 18 |
| Price_CostOfFunds / Price_OperatingCost / Price_TargetMargin | blank | pct | s9.2 | – | 16 |
| Ovr_MaxNoApproval | 1 | num | s10.2 | Approved | 14 |
| Ovr_RateTrigger | 0.15 | pct | s10.2 | Approved | 14 |
| Ovr_YearStartMonth | 1 | num | item 33 | **PROPOSED** | 14 |
| Hist_Enabled | Yes | text | s7.2 | **PROPOSED** | 10 |
| Hist_Credit1 / Hist_Credit1_Min | −0.25 / 1 | num | s7.2 | **PROPOSED** | 10 |
| Hist_Credit2 / Hist_Credit2_Min | −0.50 / 3 | num | s7.2 | **PROPOSED** | 10 |
| Hist_Penalty | 0.50 | num | s7.2 | **PROPOSED** | 10 |
| Hist_BestGrade | 3 | num | s7.2 | **PROPOSED** | 11 |
| Hist_CharacterSuggest | 2 | num | s7.2 | **PROPOSED** | 10.4 |
| Hist_LookbackYears | blank | num | item 40 | **PROPOSED** | 10.2 |
| Scale_Max / Scale_Min | 5 / 1 | num | s4.2 | Approved | 1 |
| Grade_Factor | 2.25 | num | s9.1 | Approved | 1 |
| Method_Version / CRS_Version | 1.1 / 1.1 | text | – | – | outputs |
| Guide_Version | Colour & Brand Guide v1.1 | text | – | – | – |
| Output_PDFFolder | blank | text | – | – | not needed in web app |
| Checks_Total | 13 | num | – | – | 19 |
| bl_Knockout (Blacklist sheet) | Yes | text | – | – | 13.3 |

Values that were literals in formulas or outside the Parameters sheet are parameters in set 1.1 from Phase 1 (D-07, D-22, D-23), with the workbook's values: `Interp_NB4_A1`..`A4` (4.5, 3.5, 2.5, 1.5), `Interp_NB2_A1`..`A2` (4, 2), `Tol_ScoreOverride` 0.005, `Tol_Weights` 0.000001, `Tol_ShockValue` 0.000001, `Tol_Haircut` 0.00001, `Overlay_InfoQuality_Ord` 2 (the overlay data check 7 compares with the accounts type), `KO6_Enabled` Yes, `Txt_KO6`, `KO6_CheckBorrowerOnPF` No. The top of the grade scale is the number of rows in the rating scale (10).

Rating scale (grade, description, CX scale, annual PD, appetite, review months, review cycle): 1 Exceptional CX-10 0.25% 12 Annual · 2 Very strong CX-9 0.5% · 3 Strong CX-8 1% · 4 Good CX-7 2% · 5 Satisfactory CX-6 3.5% (grades 1-5 "Eligible", 12 months, Annual) · 6 Adequate CX-5 6% "Eligible with standard conditions" 3 Quarterly · 7 Weak CX-4 10% "Only if facility grade is 6 or better" 3 Quarterly · 8 Very weak CX-3 16% "Decline for new deals" 3 Quarterly · 9 Watchlist CX-2 28% "Existing exposures only; remediation plan" 1 "Monthly (watchlist)" · 10 Default CX-1 100% "Recovery and workout" 3 "Quarterly (recovery and workout)".

Methodology tables (modules, 132 factor rows, 44 sub-sector rows, 112 haircut rows, 57 questions, 65 shocks, 5 overlays, 10 structures, 13 static lists and 3 dependent lists) are inventoried in `data-inventory.md` and will be imported verbatim as parameter set 1.1.

---

## 22. Self-test suite (TestCases sheet)

29 cases, 102 expectations. Kinds: `Title`, `Use` (inherit another case's inputs, then override), `Input` (cell = encoded value), `Param` (temporary parameter value), `History` (temporary Deal History row, fields joined by `~`), `Expect` (cell, expected, tolerance; default 0.000001). Cases: T01 s9.4 worked example; T02 KO1; T03A/B KO2 and self-liquidating; T04 overlay cap; T05A-C grade rounding; T06 uplift; T07 offtaker cap; T08 unsecured LGD; T09A/B construction cap; T10A-C override approval; T11A-D Deal History; E1-E3 interpolation; E4/E5 Min modifier; E6/E7 factor override reasons; E8 Financials metrics and a costed volume shock; E9 collateral cover warning. Every expectation will become a Vitest case keyed by the same case ID and mapped from the cell address to the engine output field.
