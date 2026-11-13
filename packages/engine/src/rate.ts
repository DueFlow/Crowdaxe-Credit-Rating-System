/**
 * The rating calculation: inputs + parameter set + Deal History snapshot → full result.
 * Each step names the workbook cells it reproduces; methodology-spec.md gives the plain-English rules.
 */
import {
  edate,
  excelInt,
  excelRound,
  excelGeneral,
  fmtFixed,
  fmtPercent,
  fmtSigned0,
  fmtThousands,
  isIsoDate,
} from './excel.js';
import { type HistorySnapshot, type RatingInput, regNoKey } from './inputs.js';
import type { FactorDef, ParameterSet } from './parameters.js';
import type {
  CheckResult,
  CheckStatus,
  CollateralResult,
  FactorResult,
  FinancialMetrics,
  KoResult,
  OverlayResult,
  PillarResult,
  QuestionResult,
  RatingResult,
  ShockResult,
} from './result.js';

export const ENGINE_VERSION = '1.1.0';

// ---------------------------------------------------------------------------------------------
// Small Excel-semantics helpers
// ---------------------------------------------------------------------------------------------

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Excel N(): numbers pass, anything else is 0. */
const N = (x: unknown): number => (isNum(x) ? x : 0);
/** Excel blank test (x = ""). */
const blank = (x: unknown): boolean => x === null || x === undefined || x === '';
/** Excel text equality ("=" on text is case-insensitive). */
const eq = (a: unknown, b: string): boolean =>
  typeof a === 'string' ? a.toLowerCase() === b.toLowerCase() : blank(a) && b === '';
const txt = (x: unknown): string =>
  x === null || x === undefined ? '' : isNum(x) ? excelGeneral(x) : String(x);

/** A metric in the factor's unit, as the workbook writes it (AZ38, Screening Note E24). */
export function metricText(def: FactorDef, x: number): string {
  if (def.scale === 3) return fmtPercent(x, 0);
  if (def.unit === '%') return fmtPercent(x, 1);
  if (def.unit === 'USD') return fmtThousands(x);
  return fmtFixed(x, 2) + (def.unit === 'x' ? 'x' : '');
}

export function rate(input: RatingInput, ps: ParameterSet, history: HistorySnapshot): RatingResult {
  const d = input.deal;
  const scaleMax = ps.num('Scale_Max');
  const scaleMin = ps.num('Scale_Min');
  const gf = ps.num('Grade_Factor');
  const gMax = ps.gradeMax;
  const scoreOfGrade = (g: number) => 1 + (gMax - g) / gf;
  const gradeOf = (x: number) => Math.max(1, Math.min(gMax, excelInt(excelRound(x, 2) + 0.5)));
  const integrityIssues: string[] = [];

  // --- 3. Deal set-up (C11, C14, D14, C18, S6:S8) ---------------------------------------------
  const mod = ps.doc.modules.find((m) => eq(d.moduleCode, m.code));
  const track = mod?.track ?? null;
  const isCorp = track === 'Corporate';
  const isPF = track === 'Project finance';
  const suggestedTrack =
    eq(d.b0UnderConstruction, 'Yes') || eq(d.b0GenerationAsset, 'Yes') ? 'Project finance' : 'Corporate';
  const trackCheckText = blank(d.moduleCode)
    ? null
    : suggestedTrack === (track ?? '')
      ? 'Matches the module track'
      : `Check: B0 suggests ${suggestedTrack}`;
  const ead = isNum(d.eadInput) ? d.eadInput : N(d.amount);

  // Grid rows: module factor set in order, then CORE (only once a module is chosen).
  const facSet = mod?.factorSet ?? null;
  const byOrd = (set: string) => ps.doc.factors.filter((f) => f.set === set).sort((a, b) => a.ord - b.ord);
  const defs: FactorDef[] = facSet ? [...byOrd(facSet), ...byOrd('CORE')] : [];
  const qDefs = mod
    ? ps.doc.questions.filter((q) => q.module === mod.code).sort((a, b) => a.ord - b.ord)
    : [];
  const sDefs = mod ? ps.doc.shocks.filter((s) => s.module === mod.code).sort((a, b) => a.ord - b.ord) : [];

  // --- 6. Sector questions (rows 71-82) ----------------------------------------------------------
  const questions: QuestionResult[] = qDefs.map((q) => {
    const qi = input.questions[q.key];
    const answer = qi?.answer ?? null;
    const explanation = qi?.explanation ?? null;
    let status: string;
    if (blank(answer)) status = 'Answer required';
    else if (eq(answer, q.flagAnswer))
      status = blank(explanation)
        ? 'Explanation required'
        : q.kind === 'Modifier'
          ? 'Modifier applied (explained)'
          : 'Flagged (explained)';
    else status = 'OK';
    return {
      key: q.key,
      kind: q.kind,
      question: q.question,
      flagAnswer: q.flagAnswer,
      answer,
      explanation,
      target: q.target,
      modifierType: q.modifierType,
      modifierValue: N(q.modifierValue),
      status,
    };
  });
  const modifierSum = (key: string, type: string) =>
    questions.reduce(
      (s, q) =>
        q.target === key && eq(q.modifierType, type) && eq(q.answer, 'Yes') ? s + q.modifierValue : s,
      0,
    );

  // --- 4. Financials ---------------------------------------------------------------------------
  const f = input.financials;
  const [rev2, rev1, rev0] = f.revenue;
  const [ebi2, ebi1, ebi0] = f.ebitda;
  const fcRev = isNum(f.forecastRevenue) ? f.forecastRevenue : N(rev0);
  const fcEbitda = isNum(f.forecastEbitda) ? f.forecastEbitda : N(ebi0);
  const zig = N(f.zigRevenueShare);
  const varCost = N(f.variableCostShare);

  // --- 7. Stress shocks (rows 86-93) -------------------------------------------------------------
  const tolShock = ps.num('Tol_ShockValue');
  const shocks: ShockResult[] = sDefs.map((s) => {
    const si = input.shocks[s.key];
    const apply = si?.apply ?? null;
    const valueTyped = si?.valueUsed ?? null;
    const reason = si?.reason ?? null;
    const valueUsed = isNum(valueTyped) ? valueTyped : s.defaultValue;
    let cost = 0;
    if (eq(apply, 'Yes') && isCorp) {
      if (s.costType === 'Volume') cost = fcRev * valueUsed * (1 - varCost);
      else if (s.costType === 'Price') cost = fcRev * valueUsed;
      else if (s.costType === 'Cost') cost = Math.max(0, fcRev - fcEbitda) * valueUsed;
      else if (s.costType === 'Delay') cost = (fcRev * valueUsed) / 365;
      else if (s.costType === 'FX') cost = fcRev * zig * valueUsed;
    }
    let status: string;
    if (blank(apply)) status = 'Answer required';
    else if (eq(apply, 'No') && blank(reason)) status = 'Reason required (not applied)';
    else if (isNum(valueTyped) && Math.abs(valueTyped - s.defaultValue) > tolShock && blank(reason))
      status = 'Reason required (value changed)';
    else if (s.costType === 'Info') status = 'OK (not costed: describe its effect)';
    else status = 'OK';
    return {
      key: s.key,
      name: s.name,
      size: s.size,
      costType: s.costType,
      defaultValue: s.defaultValue,
      valueUsed,
      apply,
      cost,
      status,
    };
  });

  const yearsWithRev = [rev2, rev1, rev0].filter((r) => N(r) > 0).length;
  const pfDebt = N(f.existingDebt) + N(ead);
  const cfads = fcEbitda - N(f.tax) - N(f.maintenanceCapex) - N(f.workingCapitalIncrease);
  const ds = f.annualDebtService;
  const dscrb = N(ds) === 0 || (!isNum(ebi0) && !isNum(f.forecastEbitda)) ? null : cfads / (ds as number);
  const shockCost = shocks.reduce((s, x) => s + x.cost, 0);
  const fin: FinancialMetrics = {
    SCALEX: N(rev0) > 0 && N(d.amount) > 0 ? (rev0 as number) / (d.amount as number) : null,
    PROPVAL: N(f.propertyValue) > 0 ? (f.propertyValue as number) : null,
    MARGIN:
      yearsWithRev === 0
        ? null
        : ((N(rev2) > 0 ? N(ebi2) / (rev2 as number) : 0) +
            (N(rev1) > 0 ? N(ebi1) / (rev1 as number) : 0) +
            (N(rev0) > 0 ? N(ebi0) / (rev0 as number) : 0)) /
          yearsWithRev,
    PFDEBT: pfDebt,
    LEV: !isNum(ebi0) ? null : ebi0 <= 0 ? -1 : pfDebt / ebi0,
    ICR: !isNum(ebi0) || N(f.annualInterest) === 0 ? null : ebi0 / (f.annualInterest as number),
    CR:
      !isNum(f.currentAssets) || N(f.currentLiabilities) === 0
        ? null
        : f.currentAssets / (f.currentLiabilities as number),
    DE: !isNum(f.totalEquity) ? null : f.totalEquity <= 0 ? -1 : pfDebt / f.totalEquity,
    CASHM: !isNum(f.cash) || N(rev0) - N(ebi0) <= 0 ? null : f.cash / ((N(rev0) - N(ebi0)) / 12),
    LTV: N(f.propertyValue) > 0 ? pfDebt / (f.propertyValue as number) : null,
    DY: !isNum(ebi0) || pfDebt <= 0 ? null : ebi0 / pfDebt,
    RESM: !isNum(f.cash) || N(ds) === 0 ? null : f.cash / ((ds as number) / 12),
    VERIF:
      !isNum(f.revenueVerified) || N(rev0) === 0 ? null : Math.min(1, f.revenueVerified / (rev0 as number)),
    MEANS:
      !isNum(f.ownersCash) || N(f.totalFundingNeed) === 0
        ? null
        : f.ownersCash / (f.totalFundingNeed as number),
    FCREV: fcRev,
    FCEBITDA: fcEbitda,
    CFADS: cfads,
    DSCRB: dscrb,
    SHOCKS: shockCost,
    DSCRS: dscrb === null ? null : (cfads - shockCost) / (ds as number),
  };

  // --- 5.4 Sub-sector and offtaker ranges (S13:S18) -------------------------------------------
  const offGrade = isNum(d.offtakerGrade) ? d.offtakerGrade : null;
  const ssSet = mod?.subSectorSet ?? null;
  const ssRow = ps.doc.subSectors.find((s) => s.set === (ssSet ?? '') && eq(d.subSector, s.name));
  const ssRange: [number | null, number | null] = !ssRow
    ? [null, null]
    : ssRow.special === 'ANCHORGRADE'
      ? [offGrade, offGrade]
      : [ssRow.gradeLow ?? 0, ssRow.gradeHigh ?? 0];
  const offRow = ps.doc.subSectors.find((s) => s.set === 'B7P' && eq(d.offtakerType, s.name));
  const offPlus = offGrade === null ? null : Math.min(gMax, offGrade + 1);
  const offRange: [number | null, number | null] = !offRow
    ? [null, null]
    : offRow.special === 'GRADEPLUS1'
      ? [offPlus, offPlus]
      : [offRow.gradeLow ?? 0, offRow.gradeHigh ?? 0];

  // --- 5. Factor grid (rows 38-67) -------------------------------------------------------------
  const autoValue = (code: string | null): number | string | null => {
    if (!code || !isCorp) return null;
    const v = (fin as unknown as Record<string, number | null>)[code];
    return v === undefined ? null : v;
  };
  const anchors4 = [
    ps.num('Interp_NB4_A1'),
    ps.num('Interp_NB4_A2'),
    ps.num('Interp_NB4_A3'),
    ps.num('Interp_NB4_A4'),
  ];
  const anchors2 = [ps.num('Interp_NB2_A1'), ps.num('Interp_NB2_A2')];

  interface Row {
    def: FactorDef;
    applies: boolean;
    groupKey: string;
    metricUsed: number | string | null;
    fromFin: boolean;
    band: number | null;
    bandText: string | null;
    base: number | null;
    add: number;
    min: number;
    set: number;
    calculated: number | null;
    analyst: number | null;
    bg: number | null;
    effW: number;
  }

  const rows: Row[] = defs.map((def) => {
    const fi = input.factors[def.key];
    const applies =
      (def.trackOnly === null || def.trackOnly === track) &&
      !(def.optional && eq(fi?.notApplicable ?? null, 'Yes'));
    const typed = fi?.metric ?? null;
    const auto = autoValue(def.auto);
    const metricUsed = isNum(typed) ? typed : isNum(auto) ? auto : blank(typed) ? null : typed;
    const fromFin = !isNum(typed) && isNum(auto);

    // Band index (AQ) and interpolated score (BQ) for numeric factors
    let band: number | null = null;
    let base: number | null = null;
    let bandText: string | null = null;
    if (def.type === 'Numeric' && isNum(metricUsed)) {
      const x = metricUsed;
      const b = def.bounds;
      if (def.dir === 'L' && x < 0) {
        band = def.neg ? def.nb + 1 : null;
        base = def.neg ? scaleMin : null;
      } else {
        let worse = 0;
        b.forEach((bk, k) => {
          const fk = def.fFlags[k]!;
          worse += (def.dir === 'H' ? (x < bk ? 1 : 0) : x > bk ? 1 : 0) + (x === bk ? 1 - fk : 0);
        });
        band = 1 + worse;
        const h = def.dir === 'H' ? x : -x;
        const c = b.map((bk) => (def.dir === 'H' ? bk : -bk));
        const a = def.nb === 4 ? anchors4 : anchors2;
        if (def.nb === 4) {
          const [c1, c2, c3, c4] = c as [number, number, number, number];
          const [a1, a2, a3, a4] = a as [number, number, number, number];
          if (h >= c1) base = Math.min(scaleMax, a1 + ((h - c1) / (c1 - c2)) * (a1 - a2));
          else if (h >= c2) base = a2 + ((h - c2) / (c1 - c2)) * (a1 - a2);
          else if (h >= c3) base = a3 + ((h - c3) / (c2 - c3)) * (a2 - a3);
          else if (h >= c4) base = a4 + ((h - c4) / (c3 - c4)) * (a3 - a4);
          else base = Math.max(scaleMin, a4 - ((c4 - h) / (c3 - c4)) * (a3 - a4));
        } else {
          const [c1, c2] = c as [number, number];
          const [a1, a2] = a as [number, number];
          if (h >= c1) base = Math.min(scaleMax, a1 + ((h - c1) / (c1 - c2)) * (a1 - a2));
          else if (h >= c2) base = a2 + ((h - c2) / (c1 - c2)) * (a1 - a2);
          else base = Math.max(scaleMin, a2 - ((c2 - h) / (c1 - c2)) * (a1 - a2));
        }
      }
      if (band !== null && band >= 1 && band <= 5) bandText = def.descriptors[band - 1] ?? null;
    } else if (def.type === 'SubSector' || def.type === 'Offtaker') {
      const [lo, hi] = def.type === 'SubSector' ? ssRange : offRange;
      if (isNum(lo) && isNum(hi)) {
        base = (scoreOfGrade(hi) + scoreOfGrade(lo)) / 2;
        bandText = `${fmtFixed(scoreOfGrade(hi), 2)} to ${fmtFixed(scoreOfGrade(lo), 2)}`;
      }
    }

    const add = modifierSum(def.key, 'Add');
    const min = modifierSum(def.key, 'Min');
    const set = modifierSum(def.key, 'Set');
    let calculated: number | null = null;
    if (applies && isNum(base)) {
      const shift = -add / gf;
      const cap = min > 0 ? scoreOfGrade(min) : scaleMax;
      const v = set > 0 ? scoreOfGrade(set) : Math.min(cap, Math.max(scaleMin, base + shift));
      calculated = excelRound(v, 2);
      if (calculated < scaleMin || calculated > scaleMax)
        integrityIssues.push(
          `Factor ${def.key} (${def.name}): modifiers give a score of ${fmtFixed(calculated, 2)}, outside ${scaleMin} to ${scaleMax} (D-13)`,
        );
    }
    const analyst = fi?.score ?? null;
    const bg = !applies || def.link ? null : analyst !== null ? analyst : calculated;
    const groupKey = def.group ? `${def.pillar}|${def.group}` : def.key;
    return {
      def,
      applies,
      groupKey,
      metricUsed,
      fromFin,
      band,
      bandText,
      base,
      add,
      min,
      set,
      calculated,
      analyst,
      bg,
      effW: 0,
    };
  });

  // Effective weights (E): weight × Σweight(group) / Σ(weight × applies)(group)
  for (const r of rows) {
    if (!r.applies) continue;
    let sumD = 0;
    let sumAP = 0;
    for (const o of rows)
      if (o.groupKey === r.groupKey) {
        sumD += o.def.weight;
        sumAP += o.def.weight * (o.applies ? 1 : 0);
      }
    if (sumAP === 0) {
      integrityIssues.push(`Factor group ${r.groupKey} has no applicable factor (D-10)`);
      continue;
    }
    r.effW = (r.def.weight * sumD) / sumAP;
  }

  // Pillar scores (C96:C104) and CAMPARI (C99)
  const pillarRaw = (code: string, camp: number | null): number | null => {
    let missing = 0;
    let sumE = 0;
    let sumBE = 0;
    let linkW = 0;
    for (const r of rows) {
      if (r.def.pillar !== code) continue;
      if (r.applies && !r.def.link && r.bg === null) missing++;
      sumE += r.effW;
      sumBE += r.applies && r.bg !== null ? r.effW * r.bg : 0;
      if (r.def.link === 'CAMP') linkW += r.effW;
    }
    if (missing > 0 || sumE === 0 || (linkW > 0 && camp === null)) return null;
    return excelRound(excelRound((sumBE + linkW * N(camp)) / sumE, 9), 2);
  };
  const weightSum = (code: string) => rows.reduce((s, r) => (r.def.pillar === code ? s + r.effW : s), 0);
  const campari = pillarRaw('CAMP', null);

  // Linked roles (S19, S20)
  const charRow = rows.find((r) => r.def.role === 'CHAR');
  const characterScore = charRow ? charRow.bg : null;
  const dscrRow = rows.find((r) => r.def.role === 'BASEDSCR');
  const baseDscr = dscrRow ? dscrRow.metricUsed : null;

  // --- 12.1 Structure (S21, S141:S146, C144:C147) ----------------------------------------------
  const st = blank(input.structure.name)
    ? undefined
    : ps.doc.structures.find((s) => eq(input.structure.name, s.name));
  const stMin = st?.minNotch ?? 0;
  const stMax = st?.maxNotch ?? 0;
  const notchesUsed = blank(input.structure.name)
    ? 0
    : Math.max(stMin, Math.min(stMax, N(input.structure.notches)));
  const selfLiquidating: 'Yes' | 'No' = st?.selfLiquidating ? 'Yes' : 'No';

  // --- 17. Knockouts KO1-KO3 (C174:C176) --------------------------------------------------------
  const KO1: KoResult =
    isNum(characterScore) && characterScore <= ps.num('KO_CharScore') ? 'Knockout' : 'Clear';
  const KO2: KoResult =
    isCorp && isNum(baseDscr) && baseDscr < ps.num('KO_DSCRMin') && selfLiquidating !== 'Yes'
      ? 'Knockout'
      : 'Clear';
  const KO3: KoResult = eq(d.ko3RepaymentsBeforeCash, 'Yes') ? 'Knockout' : 'Clear';

  // --- 8. Pillars, hard rules, blend, grade score (C96:C106) -----------------------------------
  const pillarCodes = ['P1', 'P2', 'PF1', 'PF2', 'PF3', 'PF4', 'PF5'];
  const pillarScores: Record<string, number | null> = {};
  for (const p of pillarCodes) pillarScores[p] = pillarRaw(p, campari);
  const p2Before = pillarScores['P2']!;
  const trigger = ps.num('RE_StressLTV_Trigger');
  const ltvRule = eq(d.moduleCode, 'B5') && isNum(d.stressedLtv) && d.stressedLtv > trigger;
  const p2 = !isCorp
    ? null
    : KO2 === 'Knockout'
      ? ps.num('KO2_P2Score')
      : p2Before === null
        ? null
        : ltvRule
          ? Math.min(p2Before, ps.num('RE_P2_Cap'))
          : p2Before;
  const pillar2RuleNote =
    KO2 === 'Knockout'
      ? `Base DSCR knockout: Pillar 2 set to ${excelGeneral(ps.num('KO2_P2Score'))}`
      : ltvRule
        ? `Stressed LTV above ${fmtPercent(trigger, 0)} caps Pillar 2 at ${excelGeneral(ps.num('RE_P2_Cap'))}`
        : null;

  const pillars: Record<string, PillarResult> = {
    P1: { code: 'P1', score: pillarScores['P1']!, weightSum: weightSum('P1'), applies: isCorp },
    P2: { code: 'P2', score: p2, weightSum: weightSum('P2'), applies: isCorp },
    CAMP: { code: 'CAMP', score: campari, weightSum: weightSum('CAMP'), applies: !blank(d.moduleCode) },
  };
  for (const p of ['PF1', 'PF2', 'PF3', 'PF4', 'PF5'])
    pillars[p] = { code: p, score: pillarScores[p]!, weightSum: weightSum(p), applies: isPF };

  let blended: number | null = null;
  if (isCorp) {
    if (pillarScores['P1'] !== null && p2 !== null && campari !== null)
      blended = excelRound(
        excelRound(
          ps.num('Wt_P1') * pillarScores['P1']! + ps.num('Wt_P2') * p2 + ps.num('Wt_P3') * campari,
          9,
        ),
        2,
      );
  } else if (isPF) {
    const s = ['PF1', 'PF2', 'PF3', 'PF4', 'PF5'].map((p) => pillarScores[p]!);
    if (s.every((x) => x !== null)) {
      const w = (['Wt_PF1', 'Wt_PF2', 'Wt_PF3', 'Wt_PF4', 'Wt_PF5'] as const).map((n) => ps.num(n));
      blended = excelRound(
        excelRound(w[0]! * s[0]! + w[1]! * s[1]! + w[2]! * s[2]! + w[3]! * s[3]! + w[4]! * s[4]!, 9),
        2,
      );
    }
  }
  const gradeScore = blended === null ? null : excelRound(excelRound(1 + (scaleMax - blended) * gf, 9), 2);

  // --- 9. Overlays (rows 109-115) ---------------------------------------------------------------
  const overlays: OverlayResult[] = ps.doc.overlays.map((o) => {
    const oi = input.overlays[String(o.ord)];
    const notches = oi?.notches ?? null;
    const reason = oi?.reason ?? null;
    const descriptor = !isNum(notches)
      ? null
      : notches === 0
        ? (o.descriptors[0] ?? null)
        : notches === 1
          ? (o.descriptors[1] ?? null)
          : (o.descriptors[2] ?? null);
    const status = !isNum(notches)
      ? 'OK'
      : notches > o.maxNotches
        ? 'Error: above maximum'
        : notches > 0 && blank(reason)
          ? 'Reason required'
          : 'OK';
    return { ord: o.ord, name: o.name, maxNotches: o.maxNotches, notches, descriptor, reason, status };
  });
  const overlayTotal = Math.min(
    ps.num('Overlay_Cap'),
    overlays.reduce((s, o) => s + (N(o.notches) < o.maxNotches ? N(o.notches) : o.maxNotches), 0),
  );
  const afterOverlays = gradeScore === null ? null : gradeScore + overlayTotal;

  // --- 10. Deal History (C118:C129, P129) -------------------------------------------------------
  const histEnabled = ps.on('Hist_Enabled');
  const histReg = isPF ? txt(d.sponsorRegNo) : txt(d.regNo);
  const statuses = ps.list('lst_HistStatus');
  const lookback = ps.optNum('Hist_LookbackYears');
  const cutoff = lookback !== null && isIsoDate(d.ratingDate) ? edate(d.ratingDate, -12 * lookback) : null;
  const counts = statuses.map((s) => {
    if (histReg === '') return 0;
    const matching = history.rows.filter((r) => regNoKey(r.regNo) === regNoKey(histReg) && eq(r.status, s));
    const old = cutoff
      ? matching.filter((r) => r.maturityDate !== null && r.maturityDate < cutoff).length
      : 0;
    return matching.length - old;
  });
  const [onTime, late130, late3190, restructured, defaulted, liveCurrent, arrears] = counts as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const summaryParts = [
    [onTime, 'repaid on time'],
    [late130, 'repaid late (1-30 DPD)'],
    [late3190, 'repaid late (31-90 DPD)'],
    [restructured, 'restructured'],
    [defaulted, 'defaulted'],
    [liveCurrent, 'live, current'],
    [arrears, 'live, in arrears'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, t]) => `${n} ${t}`);
  const histSummary =
    histReg === ''
      ? 'No registration number'
      : summaryParts.length === 0
        ? 'No previous Crowdaxe deals'
        : summaryParts.join('; ');
  let histAdj = 0;
  if (histEnabled) {
    const penalty = late3190 + arrears > 0 ? ps.num('Hist_Penalty') : 0;
    const credit =
      late3190 + arrears + restructured + defaulted > 0
        ? 0
        : onTime >= ps.num('Hist_Credit2_Min')
          ? ps.num('Hist_Credit2')
          : onTime >= ps.num('Hist_Credit1_Min')
            ? ps.num('Hist_Credit1')
            : 0;
    histAdj = penalty + credit;
  }
  const suggest = ps.num('Hist_CharacterSuggest');
  const charFlagOn = histEnabled && restructured + defaulted > 0;
  const characterFlag = charFlagOn
    ? `Character should be ${excelGeneral(suggest)} or lower` +
      (isNum(characterScore) && characterScore > suggest ? ` (current ${excelGeneral(characterScore)})` : '')
    : 'No flag';
  const characterStatus =
    charFlagOn && isNum(characterScore) && characterScore > suggest
      ? blank(input.characterJustification)
        ? 'Justification required'
        : 'Character above suggestion (explained)'
      : 'OK';

  // --- 11. Obligor grade (C132:C138) and 14. overrides ------------------------------------------
  const obligorScore = afterOverlays === null ? null : afterOverlays + histAdj;
  const gradeBeforeHistory = afterOverlays === null ? null : gradeOf(afterOverlays);
  const obligorModel =
    obligorScore === null
      ? null
      : histAdj < 0
        ? Math.max(gradeOf(obligorScore), Math.min(gradeBeforeHistory!, ps.num('Hist_BestGrade')))
        : gradeOf(obligorScore);
  const ov = input.override;
  const maxNoApproval = ps.num('Ovr_MaxNoApproval');
  const applyOverride = (
    model: number | null,
    wanted: number | null,
  ): { final: number | null; status: string } => {
    if (model === null || wanted === null) return { final: model, status: 'No override' };
    if (wanted === model) return { final: model, status: 'No override' };
    if (blank(ov.reason)) return { final: model, status: 'Blocked: written reason required' };
    if (Math.abs(wanted - model) > maxNoApproval && (blank(ov.approverName) || blank(ov.approvalDate)))
      return {
        final: model,
        status: `Blocked: more than ${excelGeneral(maxNoApproval)} notch needs IC approval`,
      };
    return { final: wanted, status: `Override applied: ${fmtSigned0(wanted - model, '+0')} (grade number)` };
  };
  const obligorOv = applyOverride(obligorModel, ov.obligorGrade);
  const obligorFinal = obligorOv.final;

  // --- 12.3 Facility grade path (C148:C155) -----------------------------------------------------
  const beforeLimits = obligorFinal === null ? null : obligorFinal - notchesUsed;
  const afterUplift =
    beforeLimits === null
      ? null
      : notchesUsed > 0
        ? Math.max(beforeLimits, Math.min(obligorFinal!, ps.num('Uplift_BestGrade')))
        : beforeLimits;
  const afterOfftaker =
    afterUplift === null
      ? null
      : st?.offtake && offGrade !== null
        ? Math.max(afterUplift, offGrade)
        : afterUplift;
  const constructionCapApplies =
    isPF &&
    !eq(d.completionCertified, 'Yes') &&
    !(
      eq(d.bankPerformanceBond, 'Yes') ||
      (isNum(d.completionGuarantorGrade) && d.completionGuarantorGrade <= ps.num('Construct_GuarantorBest'))
    );
  const afterConstruction =
    afterOfftaker === null
      ? null
      : constructionCapApplies
        ? Math.max(afterOfftaker, ps.num('Construct_CapGrade'))
        : afterOfftaker;
  const facilityModel = afterConstruction === null ? null : Math.max(1, Math.min(gMax, afterConstruction));
  const facilityOv = applyOverride(facilityModel, ov.facilityGrade);
  const facilityFinal = facilityOv.final;
  const overrideApplied =
    (obligorModel !== null && obligorFinal !== null && obligorModel !== obligorFinal) ||
    (facilityModel !== null && facilityFinal !== null && facilityModel !== facilityFinal);
  const overrideBlocked = obligorOv.status.startsWith('Blocked') || facilityOv.status.startsWith('Blocked');

  // --- 15. Collateral and LGD (Collateral sheet) ------------------------------------------------
  const hcSet = mod?.haircutSet ?? '';
  const tolHc = ps.num('Tol_Haircut');
  const lines: CollateralResult[] = input.collateral.map((c) => {
    if (blank(c.type))
      return {
        type: null,
        value: c.value,
        rangeText: null,
        suggestedHaircut: null,
        haircutUsed: null,
        recoverable: 0,
        status: null,
      };
    const hc = ps.doc.haircuts.find((h) => h.set === hcSet && eq(c.type, h.name));
    const add = hc && eq(c.crossBorderNoTracking, 'Yes') ? hc.crossBorderAddOn : 0;
    const lo = hc ? Math.min(1, hc.low + add) : null;
    const hi = hc ? Math.min(1, hc.high + add) : null;
    const suggested = hc ? Math.min(1, (hc.low + hc.high) / 2 + add) : null;
    const used = isNum(c.haircut) ? c.haircut : suggested;
    const recoverable = isNum(c.value) && isNum(used) ? c.value * (1 - used) : 0;
    const rangeText = hc ? fmtPercent(lo!, 0) + (hc.high === hc.low ? '' : ` – ${fmtPercent(hi!, 0)}`) : null;
    let status: string;
    if (!hc) status = "Error: not in this module's list";
    else if (!isNum(c.value)) status = 'Value required';
    else if (used! < lo! - tolHc || used! > hi! + tolHc) status = 'Out of range';
    else if (isNum(c.haircut) && Math.abs(c.haircut - suggested!) > tolHc && blank(c.note))
      status = 'Note required';
    else status = 'OK';
    return {
      type: c.type,
      value: c.value,
      rangeText,
      suggestedHaircut: suggested,
      haircutUsed: used,
      recoverable,
      status,
    };
  });
  const colCount = input.collateral.filter((c) => typeof c.type === 'string' && c.type !== '').length;
  const totalValue = input.collateral.reduce((s, c) => s + N(c.value), 0);
  const totalRecoverable = lines.reduce((s, l) => s + l.recoverable, 0);
  const lgdFloor = ps.num('LGD_Floor');
  const lgdUnsec = ps.num('LGD_Unsecured');
  const lgdFormula = ead <= 0 ? null : Math.max(lgdFloor, 1 - totalRecoverable / ead);
  const lgd =
    lgdFormula === null
      ? null
      : totalRecoverable <= 0
        ? lgdUnsec
        : ps.on('LGD_CapAtUnsecured')
          ? Math.min(lgdUnsec, lgdFormula)
          : lgdFormula;
  const lgdBasis =
    lgd === null
      ? null
      : totalRecoverable <= 0
        ? 'Unsecured: no recoverable collateral'
        : lgd === lgdFloor
          ? `Floor for secured facilities (${fmtPercent(lgdFloor, 0)})`
          : ps.on('LGD_CapAtUnsecured') && lgdFormula! > lgdUnsec
            ? `Capped at the unsecured LGD (${fmtPercent(lgdUnsec, 0)})`
            : 'Recoverable value against exposure';
  const coverText =
    N(d.amount) === 0
      ? null
      : totalValue < (d.amount as number)
        ? `Warning: total collateral US$ ${fmtThousands(totalValue)} is below the amount requested US$ ${fmtThousands(d.amount as number)}`
        : `OK: collateral of US$ ${fmtThousands(totalValue)} covers the amount requested`;

  // --- 16. PD, EL, pricing (C164:C171) ----------------------------------------------------------
  const pd = facilityFinal === null ? null : ps.grade(facilityFinal).pd;
  const elPct = pd === null || lgd === null ? null : pd * lgd;
  const elUsd = elPct === null ? null : elPct * ead;
  const cof = ps.optNum('Price_CostOfFunds');
  const opex = ps.optNum('Price_OperatingCost');
  const margin = ps.optNum('Price_TargetMargin');
  const minYield: number | string | null =
    cof === null || opex === null || margin === null
      ? 'Pricing inputs not set'
      : elPct === null
        ? null
        : cof + elPct + opex + margin;
  const pricingStatus = !isNum(minYield)
    ? 'Warning: pricing inputs not set'
    : !isNum(input.proposedAllInYield)
      ? 'OK'
      : input.proposedAllInYield < minYield
        ? 'Warning: below minimum yield, IC approval needed'
        : 'OK';

  // --- 17/18. KO4-KO6, recommendation, review (C177:C179, Knockouts!F9:F10, Blacklist!C5) -------
  const KO4 =
    obligorFinal === null ? null : obligorFinal >= ps.num('Dec_ObligorDecline') ? 'Decline' : 'Clear';
  const KO5 =
    facilityFinal === null ? null : facilityFinal >= ps.num('Dec_FacilityDecline') ? 'Decline' : 'Clear';
  const blRegs = [histReg];
  if (isPF && ps.on('KO6_CheckBorrowerOnPF')) blRegs.push(txt(d.regNo));
  const listed = blRegs.some(
    (reg) =>
      reg !== '' &&
      history.blacklist.some((b) => regNoKey(b.regNo) === regNoKey(reg) && b.status === 'Active'),
  );
  const KO6 = !listed ? 'Clear' : ps.switchText('KO6_Enabled') === 'No' ? 'Warning' : 'Knockout';

  let recommendation: string;
  if (KO6 === 'Knockout') recommendation = ps.text('Txt_KO6');
  else if (KO1 === 'Knockout') recommendation = ps.text('Txt_KO1');
  else if (KO2 === 'Knockout') recommendation = ps.text('Txt_KO2');
  else if (KO3 === 'Knockout') recommendation = ps.text('Txt_KO3');
  else if (obligorFinal === null || facilityFinal === null) recommendation = 'Incomplete: scores missing';
  else if (eq(d.ratingType, 'Review'))
    recommendation = `Existing exposure: ${ps.grade(facilityFinal).appetite}`;
  else if (obligorFinal >= ps.num('Dec_ObligorDecline')) recommendation = ps.text('Txt_Decline');
  else if (facilityFinal >= ps.num('Dec_FacilityDecline')) recommendation = ps.text('Txt_Decline');
  else if (facilityFinal === ps.num('Dec_FacilityConditions')) recommendation = ps.text('Txt_Conditions');
  else recommendation = ps.text('Txt_Approve');

  const reviewCycle = facilityFinal === null ? null : ps.grade(facilityFinal).reviewCycle;
  const nextReviewDate =
    facilityFinal === null || !isIsoDate(d.ratingDate)
      ? null
      : edate(d.ratingDate, ps.grade(facilityFinal).reviewMonths);

  // --- Factor results (statuses need CAMPARI) ---------------------------------------------------
  const tolScore = ps.num('Tol_ScoreOverride');
  const factors: FactorResult[] = rows.map((r) => {
    const fi = input.factors[r.def.key];
    const evidence = fi?.evidence ?? null;
    const scoreUsed = !r.applies ? null : r.def.link === 'CAMP' ? campari : r.bg;
    let status: string;
    if (!r.applies) status = 'N/A';
    else if (scoreUsed === null) status = 'Score required';
    else if (r.def.link) status = 'OK (linked)';
    else if (
      r.def.type === 'Descriptor' &&
      (scoreUsed !== excelInt(scoreUsed) || scoreUsed < scaleMin || scoreUsed > scaleMax)
    )
      status = 'Whole number 1-5 required';
    else if (r.calculated !== null && r.analyst !== null && Math.abs(r.analyst - r.calculated) > tolScore)
      status = blank(evidence) ? 'Override: reason required' : 'Override (reason given)';
    else if (r.calculated === null && blank(evidence)) status = 'Evidence required';
    else status = 'OK';
    const meaning =
      scoreUsed === null
        ? null
        : ps.grade(Math.min(gMax, Math.max(1, excelInt(1 + (scaleMax - scoreUsed) * gf + 0.5)))).description;
    return {
      key: r.def.key,
      pillar: r.def.pillar,
      name: r.def.name,
      type: r.def.type,
      weight: r.def.weight,
      effectiveWeight: r.effW,
      applies: r.applies,
      measure: r.def.measure,
      metricUsed: r.metricUsed,
      metricFromFinancials: r.fromFin,
      metricHint: r.fromFin ? `From Financials: ${metricText(r.def, r.metricUsed as number)}` : null,
      band: r.band,
      bandText: r.bandText,
      baseScore: r.base,
      modifiers: { add: r.add, min: r.min, set: r.set },
      calculatedScore: r.calculated,
      analystScore: r.analyst,
      scoreUsed,
      weighted: scoreUsed === null ? 0 : r.effW * scoreUsed,
      meaning,
      status,
      evidence,
    };
  });

  // --- 19. Data checks (Checks sheet) -----------------------------------------------------------
  const checks: CheckResult[] = [];
  const add = (name: string, status: CheckStatus, detail: string) =>
    checks.push({ no: checks.length + 1, name, status, detail });
  const fs = factors.map((x) => x.status);
  const countOf = (arr: (string | null)[], pred: (s: string) => boolean) =>
    arr.filter((s) => s !== null && pred(s)).length;

  const missingDeal =
    [d.dealId, d.borrowerName, d.regNo, d.ratingType, d.moduleCode, d.facilityType].filter(blank).length +
    (isNum(d.amount) ? 0 : 1) +
    (blank(d.tenorMonths) ? 1 : 0) +
    (isIsoDate(d.ratingDate) ? 0 : 1) +
    [d.analystName, d.statementsBasis, d.accountsType, d.ko3RepaymentsBeforeCash].filter(blank).length;
  add(
    'Required deal fields complete',
    missingDeal === 0 ? 'Passed' : 'Error',
    missingDeal === 0 ? 'All required deal fields entered' : `${missingDeal} required deal field(s) blank`,
  );

  add(
    'Track consistent with the B0 questions',
    blank(d.moduleCode) ? 'Error' : suggestedTrack === (track ?? '') ? 'Passed' : 'Warning',
    blank(d.moduleCode)
      ? 'No module chosen'
      : suggestedTrack === (track ?? '')
        ? 'Module track matches B0'
        : `B0 answers suggest ${suggestedTrack}; module is ${track ?? ''}`,
  );

  const nMissing = countOf(fs, (s) => s === 'Score required');
  const nNoReason = countOf(fs, (s) => s === 'Override: reason required');
  const nWhole = countOf(fs, (s) => s === 'Whole number 1-5 required');
  const nReason = countOf(fs, (s) => s === 'Override (reason given)');
  add(
    'Factor scores present; every override has a reason',
    nMissing + nNoReason + nWhole > 0 ? 'Error' : nReason > 0 ? 'Warning' : 'Passed',
    `${nMissing} missing, ${nNoReason} override(s) without a reason, ${nReason} override(s) with a reason`,
  );

  const nEvid = countOf(fs, (s) => s === 'Evidence required');
  add(
    'Evidence recorded for every descriptor-based score',
    nEvid > 0 ? 'Error' : 'Passed',
    `${nEvid} score(s) without evidence`,
  );

  const tolW = ps.num('Tol_Weights');
  const weightRows: [number, boolean][] = [
    [weightSum('P1'), isCorp],
    [weightSum('P2'), isCorp],
    [weightSum('CAMP'), !blank(d.moduleCode)],
    ...['PF1', 'PF2', 'PF3', 'PF4', 'PF5'].map((p): [number, boolean] => [weightSum(p), isPF]),
  ];
  const weightsOk = weightRows.every(([w, applies]) => !applies || Math.abs(w - 1) <= tolW);
  add(
    'Weights sum to 100% in every pillar',
    blank(d.moduleCode) || !weightsOk ? 'Error' : 'Passed',
    blank(d.moduleCode)
      ? 'No module chosen'
      : weightsOk
        ? 'All pillar weights sum to 100%'
        : "A pillar's weights do not sum to 100%",
  );

  const ias =
    typeof d.statementsBasis === 'string' && d.statementsBasis.slice(0, 6).toLowerCase() === 'ias 29';
  add(
    'Figures in USD, not IAS 29 statements',
    blank(d.statementsBasis) || ias ? 'Error' : 'Passed',
    blank(d.statementsBasis)
      ? 'Statements basis not recorded'
      : ias
        ? 'IAS 29 statements are not scored: restate to USD'
        : 'USD restated',
  );

  const accounts = ps.list('lst_Accounts');
  const accIdx = accounts.findIndex((a) => eq(d.accountsType, a)) + 1;
  const iq = N(input.overlays[String(ps.num('Overlay_InfoQuality_Ord'))]?.notches ?? null);
  if (blank(d.accountsType))
    add('Information quality overlay consistent with accounts type', 'Error', 'Accounts type not recorded');
  else if (accIdx === 0)
    add(
      'Information quality overlay consistent with accounts type',
      'Error',
      'Accounts type is not one of the listed types',
    );
  else if (iq !== accIdx - 1)
    add(
      'Information quality overlay consistent with accounts type',
      'Warning',
      `Check: accounts type suggests information quality +${accIdx - 1}`,
    );
  else if (accIdx > 1) {
    const a = d.accountsType as string;
    add(
      'Information quality overlay consistent with accounts type',
      'Warning',
      `${a.slice(0, 1).toLowerCase()}${a.slice(1, 100)} (information quality +${accIdx - 1})`,
    );
  } else add('Information quality overlay consistent with accounts type', 'Passed', 'Audited or reconciled');

  const ovNotOk = overlays.filter((o) => o.status !== 'OK').length;
  add(
    'Every overlay notch has a reason and is within its maximum',
    ovNotOk === 0 ? 'Passed' : 'Error',
    `${ovNotOk} overlay row(s) need attention`,
  );

  const shockReq = shocks.filter((s) => s.status.toLowerCase().endsWith('required')).length;
  add(
    'Stress shocks applied, or adjusted with a reason',
    shockReq > 0 ? 'Error' : 'Passed',
    `${shockReq} shock row(s) incomplete`,
  );

  const notchingText =
    notchesUsed > 0
      ? `+${notchesUsed}${notchesUsed === 1 ? ' notch' : ' notches'} (better)`
      : notchesUsed < 0
        ? `${notchesUsed}${notchesUsed === -1 ? ' notch' : ' notches'} (worse)`
        : 'No notching';
  const notchesTyped = input.structure.notches;
  if (blank(input.structure.name))
    add('Structure notching within limits and reasoned', 'Error', 'No structure chosen');
  else if (isNum(notchesTyped) && notchesTyped !== notchesUsed)
    add(
      'Structure notching within limits and reasoned',
      'Error',
      "Notches entered are outside the structure's range",
    );
  else if (stMax > 0 && notchesUsed < stMax && blank(input.structure.reason))
    add('Structure notching within limits and reasoned', 'Warning', 'Partial uplift: record the reason');
  else if (st?.offtake && offGrade === null && blank(input.structure.reason))
    add(
      'Structure notching within limits and reasoned',
      'Warning',
      'Offtake with no offtaker grade: record the reason',
    );
  else add('Structure notching within limits and reasoned', 'Passed', notchingText);

  const colOk = lines.filter((l) => l.status === 'OK').length;
  if (colOk < colCount)
    add(
      'Collateral schedule complete and covering the amount requested',
      'Error',
      `${colCount - colOk} collateral row(s) need attention`,
    );
  else if (
    (colCount === 0 && stMin >= 0 && !blank(input.structure.name)) ||
    (coverText ?? '').startsWith('Warning')
  )
    add(
      'Collateral schedule complete and covering the amount requested',
      'Warning',
      colCount === 0 ? `No collateral recorded: LGD ${fmtPercent(lgdUnsec, 0)}` : coverText!,
    );
  else
    add(
      'Collateral schedule complete and covering the amount requested',
      'Passed',
      colCount === 0
        ? `No collateral recorded: LGD ${fmtPercent(lgdUnsec, 0)}`
        : `${colCount} item(s), recoverable US$ ${fmtThousands(totalRecoverable)}`,
    );

  const qs = [...questions.map((q) => q.status), characterStatus];
  const nReq = qs.filter((s) => s.toLowerCase().endsWith('required')).length;
  const nExpl = qs.filter((s) => s.toLowerCase().includes('explained')).length;
  add(
    'Red flags, conditions and Deal History flags answered and explained',
    nReq > 0 ? 'Error' : nExpl > 0 ? 'Warning' : 'Passed',
    `${nReq} unanswered or unexplained, ${nExpl} flagged and explained`,
  );

  add(
    'Pricing inputs set',
    isNum(minYield) ? 'Passed' : 'Warning',
    isNum(minYield)
      ? `Minimum yield ${fmtPercent(minYield, 2)}`
      : 'Cost of funds, operating cost or target margin blank on Parameters',
  );

  const nPassed = checks.filter((c) => c.status === 'Passed').length;
  const nWarn = checks.filter((c) => c.status === 'Warning').length;
  const nErr = checks.filter((c) => c.status === 'Error').length;

  return {
    engineVersion: ENGINE_VERSION,
    parameterSetVersion: ps.doc.version,
    methodVersion: ps.text('Method_Version'),
    deal: {
      moduleName: mod?.name ?? null,
      track,
      suggestedTrack,
      trackCheckText,
      ead,
      factorSet: facSet,
      subSectorSet: ssSet,
      haircutSet: mod?.haircutSet ?? null,
    },
    financials: fin,
    factors,
    questions,
    shocks,
    pillars,
    pillar2BeforeRules: p2Before,
    pillar2RuleNote,
    campari,
    blendedScore: blended,
    gradeScore,
    overlays,
    overlayTotal,
    scoreAfterOverlays: afterOverlays,
    history: {
      enabled: histEnabled,
      regNo: histReg,
      statuses,
      counts,
      summary: histSummary,
      adjustment: histAdj,
      characterFlag,
      characterStatus,
    },
    obligor: {
      score: obligorScore,
      gradeBeforeHistory,
      model: obligorModel,
      final: obligorFinal,
      overrideStatus: obligorOv.status,
    },
    structure: {
      name: st?.name ?? (blank(input.structure.name) ? null : input.structure.name),
      code: st?.code ?? null,
      minNotch: stMin,
      maxNotch: stMax,
      notchingAvailableText: blank(input.structure.name)
        ? null
        : `${fmtSigned0(stMin)} to ${fmtSigned0(stMax)}`,
      notchesUsed,
      notchingText,
      selfLiquidating,
      offtake: st?.offtake ?? false,
      conditions: st?.conditions ?? null,
    },
    facility: {
      beforeLimits,
      afterUpliftFloor: afterUplift,
      afterOfftakerCap: afterOfftaker,
      afterConstructionCap: afterConstruction,
      model: facilityModel,
      final: facilityFinal,
      overrideStatus: facilityOv.status,
    },
    override: { applied: overrideApplied, blocked: overrideBlocked },
    collateral: {
      lines,
      count: colCount,
      totalValue,
      totalRecoverable,
      lgdFormula,
      lgd,
      lgdBasis,
      coverText,
    },
    pd,
    elPct,
    elUsd,
    minYield,
    pricingStatus,
    knockouts: { KO1, KO2, KO3, KO4, KO5, KO6 },
    characterScore,
    baseDscr,
    recommendation,
    reviewCycle,
    nextReviewDate,
    checks,
    checksSummary: `${nPassed} of ${excelGeneral(ps.num('Checks_Total'))} data checks passed`,
    checksCounts: `${nWarn} warning(s), ${nErr} error(s)`,
    integrityIssues,
    canFinalise: nErr === 0 && !overrideBlocked && integrityIssues.length === 0,
  };
}
