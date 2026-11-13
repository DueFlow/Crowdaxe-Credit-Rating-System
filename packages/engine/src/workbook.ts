/**
 * Mapping between the workbook's cells and the engine's structured inputs and outputs.
 *
 * - `decodeWorkbookValue`: the `RatingInputs` encoding (S:, N:, D:, B:, E:).
 * - `inputFromWorkbookCells`: a rating saved as "Sheet!Cell" → value pairs → `RatingInput`
 *   (used by the importer and by the parity tests).
 * - `resultToWorkbookCells`: an engine result laid out on the workbook's output cells, so it can be
 *   compared cell by cell with Excel or the LibreOffice oracle.
 */
import { isoToSerial, serialToIso } from './excel.js';
import { parseRatingInput, type RatingInput, type RatingInputDraft } from './inputs.js';
import type { ParameterSet } from './parameters.js';
import type { RatingResult } from './result.js';

export type CellValue = number | string | boolean | null;

/** Decode a `RatingInputs` value ("S:text", "N:12.5", "D:2026-01-12", "B:True", "E:"). */
export function decodeWorkbookValue(encoded: string): CellValue {
  const body = encoded.slice(2);
  switch (encoded.slice(0, 2)) {
    case 'E:':
      return null;
    case 'N:':
      return Number(body);
    case 'D:':
      return body;
    case 'B:':
      return body === 'True';
    default:
      return encoded.startsWith('S:') ? body : encoded;
  }
}

const DEAL_CELLS: Record<string, keyof RatingInput['deal']> = {
  C6: 'dealId',
  C7: 'borrowerName',
  C8: 'regNo',
  C9: 'ratingType',
  C10: 'moduleCode',
  C12: 'b0UnderConstruction',
  C13: 'b0GenerationAsset',
  C15: 'facilityType',
  C16: 'amount',
  C17: 'eadInput',
  C19: 'tenorMonths',
  C20: 'ratingDate',
  C21: 'analystName',
  C22: 'reviewerName',
  C23: 'statementsBasis',
  C24: 'accountsType',
  C25: 'subSector',
  C26: 'offtakerGrade',
  C27: 'offtakerType',
  C28: 'stressedLtv',
  C29: 'sponsorRegNo',
  C30: 'ko3RepaymentsBeforeCash',
  C31: 'proceedsControlled',
  C32: 'completionCertified',
  C33: 'completionGuarantorGrade',
  C34: 'bankPerformanceBond',
};
const DEAL_NUMBERS = new Set(['amount', 'eadInput', 'stressedLtv', 'completionGuarantorGrade']);
const DEAL_NUM_OR_TEXT = new Set(['tenorMonths', 'offtakerGrade']);

const FIN_CELLS: Record<string, string> = {
  E10: 'existingDebt',
  E11: 'cash',
  E12: 'currentAssets',
  E13: 'currentLiabilities',
  E14: 'totalEquity',
  E15: 'propertyValue',
  E18: 'forecastRevenue',
  E19: 'forecastEbitda',
  E20: 'tax',
  E21: 'maintenanceCapex',
  E22: 'workingCapitalIncrease',
  E23: 'annualInterest',
  E24: 'annualDebtService',
  E27: 'revenueVerified',
  E28: 'ownersCash',
  E29: 'totalFundingNeed',
  E30: 'zigRevenueShare',
  E31: 'variableCostShare',
};

export const GRID = {
  factorFirst: 38,
  factorLast: 67,
  questionFirst: 71,
  questionLast: 82,
  shockFirst: 86,
  shockLast: 93,
  overlayFirst: 109,
  collateralFirst: 9,
  collateralLast: 23,
};

/** Grid rows of the current module: factor keys (rows 38+), question keys (71+), shock keys (86+). */
export function gridKeys(ps: ParameterSet, moduleCode: string | null) {
  const mod = ps.doc.modules.find((m) => m.code.toLowerCase() === (moduleCode ?? '').toLowerCase());
  const byOrd = <T extends { ord: number }>(xs: T[]) => [...xs].sort((a, b) => a.ord - b.ord);
  const factors = mod
    ? [
        ...byOrd(ps.doc.factors.filter((f) => f.set === mod.factorSet)),
        ...byOrd(ps.doc.factors.filter((f) => f.set === 'CORE')),
      ].map((f) => f.key)
    : [];
  const questions = mod ? byOrd(ps.doc.questions.filter((q) => q.module === mod.code)).map((q) => q.key) : [];
  const shocks = mod ? byOrd(ps.doc.shocks.filter((s) => s.module === mod.code)).map((s) => s.key) : [];
  return { factors, questions, shocks };
}

export interface CellMappingResult {
  input: RatingInput;
  /** Cells that could not be mapped or had an unexpected type (kept out of the input). */
  warnings: string[];
}

/**
 * Build a `RatingInput` from workbook input cells ("Scorecard!C10" → value). Values may be decoded
 * already, or still encoded ("S:B1"). Dates may be ISO strings or Excel serial numbers.
 */
export function inputFromWorkbookCells(
  cells: Record<string, CellValue>,
  ps: ParameterSet,
): CellMappingResult {
  const warnings: string[] = [];
  const v = (k: string): CellValue => {
    const raw = cells[k];
    if (raw === undefined) return null;
    return typeof raw === 'string' && /^[SNDBE]:/.test(raw) ? decodeWorkbookValue(raw) : raw;
  };
  const asNum = (k: string, x: CellValue): number | null => {
    if (x === null || x === '') return null;
    if (typeof x === 'number') return x;
    warnings.push(`${k}: expected a number, found "${String(x)}" (ignored)`);
    return null;
  };
  const asStr = (x: CellValue): string | null =>
    x === null || x === '' ? null : typeof x === 'number' ? String(x) : String(x);
  const asDate = (k: string, x: CellValue): string | null => {
    if (x === null || x === '') return null;
    if (typeof x === 'number') return serialToIso(x);
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
    warnings.push(`${k}: expected a date, found "${String(x)}" (ignored)`);
    return null;
  };

  const deal: Record<string, unknown> = {};
  for (const [cell, field] of Object.entries(DEAL_CELLS)) {
    const x = v(`Scorecard!${cell}`);
    if (field === 'ratingDate') deal[field] = asDate(`Scorecard!${cell}`, x);
    else if (DEAL_NUMBERS.has(field)) deal[field] = asNum(`Scorecard!${cell}`, x);
    else if (DEAL_NUM_OR_TEXT.has(field)) deal[field] = typeof x === 'number' ? x : asStr(x);
    else deal[field] = asStr(x);
  }

  const fin: Record<string, unknown> = {
    revenue: ['C6', 'D6', 'E6'].map((c) => asNum(`Financials!${c}`, v(`Financials!${c}`))),
    ebitda: ['C7', 'D7', 'E7'].map((c) => asNum(`Financials!${c}`, v(`Financials!${c}`))),
  };
  for (const [cell, field] of Object.entries(FIN_CELLS))
    fin[field] = asNum(`Financials!${cell}`, v(`Financials!${cell}`));

  const grid = gridKeys(ps, asStr(v('Scorecard!C10')));
  const factors: Record<string, unknown> = {};
  for (let r = GRID.factorFirst; r <= GRID.factorLast; r++) {
    const vals = {
      G: v(`Scorecard!G${r}`),
      J: v(`Scorecard!J${r}`),
      K: v(`Scorecard!K${r}`),
      N: v(`Scorecard!N${r}`),
    };
    if (Object.values(vals).every((x) => x === null || x === '')) continue;
    const key = grid.factors[r - GRID.factorFirst];
    if (!key) {
      warnings.push(
        `Scorecard row ${r}: factor inputs found but the module has no factor on this row (ignored)`,
      );
      continue;
    }
    factors[key] = {
      metric: typeof vals.G === 'number' ? vals.G : asStr(vals.G),
      score: asNum(`Scorecard!J${r}`, vals.J),
      notApplicable: asStr(vals.K),
      evidence: asStr(vals.N),
    };
  }
  const questions: Record<string, unknown> = {};
  for (let r = GRID.questionFirst; r <= GRID.questionLast; r++) {
    const a = v(`Scorecard!G${r}`);
    const e = v(`Scorecard!N${r}`);
    if ((a === null || a === '') && (e === null || e === '')) continue;
    const key = grid.questions[r - GRID.questionFirst];
    if (!key) {
      warnings.push(
        `Scorecard row ${r}: question answer found but the module has no question on this row (ignored)`,
      );
      continue;
    }
    questions[key] = { answer: asStr(a), explanation: asStr(e) };
  }
  const shocks: Record<string, unknown> = {};
  for (let r = GRID.shockFirst; r <= GRID.shockLast; r++) {
    const g = v(`Scorecard!G${r}`);
    const h = v(`Scorecard!H${r}`);
    const n = v(`Scorecard!N${r}`);
    if ([g, h, n].every((x) => x === null || x === '')) continue;
    const key = grid.shocks[r - GRID.shockFirst];
    if (!key) {
      warnings.push(
        `Scorecard row ${r}: shock input found but the module has no shock on this row (ignored)`,
      );
      continue;
    }
    shocks[key] = { apply: asStr(g), valueUsed: asNum(`Scorecard!H${r}`, h), reason: asStr(n) };
  }
  const overlays: Record<string, unknown> = {};
  ps.doc.overlays.forEach((o, i) => {
    const r = GRID.overlayFirst + i;
    const e = v(`Scorecard!E${r}`);
    const n = v(`Scorecard!N${r}`);
    if ((e === null || e === '') && (n === null || n === '')) return;
    overlays[String(o.ord)] = { notches: asNum(`Scorecard!E${r}`, e), reason: asStr(n) };
  });
  const collateral: unknown[] = [];
  for (let r = GRID.collateralFirst; r <= GRID.collateralLast; r++) {
    const vals = ['C', 'D', 'G', 'H', 'L'].map((c) => v(`Collateral!${c}${r}`));
    if (vals.every((x) => x === null || x === '')) continue;
    collateral.push({
      type: asStr(vals[0]!),
      value: asNum(`Collateral!D${r}`, vals[1]!),
      haircut: asNum(`Collateral!G${r}`, vals[2]!),
      crossBorderNoTracking: asStr(vals[3]!),
      note: asStr(vals[4]!),
    });
  }

  const draft: RatingInputDraft = {
    deal: deal as RatingInputDraft['deal'],
    financials: fin as RatingInputDraft['financials'],
    factors: factors as RatingInputDraft['factors'],
    questions: questions as RatingInputDraft['questions'],
    shocks: shocks as RatingInputDraft['shocks'],
    overlays: overlays as RatingInputDraft['overlays'],
    characterJustification: asStr(v('Scorecard!N129')),
    structure: {
      name: asStr(v('Scorecard!C141')),
      notches: asNum('Scorecard!C143', v('Scorecard!C143')),
      reason: asStr(v('Scorecard!C146')),
    },
    collateral: collateral as RatingInputDraft['collateral'],
    override: {
      obligorGrade: asNum('Scorecard!C136', v('Scorecard!C136')),
      facilityGrade: asNum('Scorecard!C153', v('Scorecard!C153')),
      reason: asStr(v('Scorecard!C158')),
      approverName: asStr(v('Scorecard!C159')),
      approvalDate: asDate('Scorecard!C160', v('Scorecard!C160')),
    },
    proposedAllInYield: asNum('Scorecard!C170', v('Scorecard!C170')),
  };
  return { input: parseRatingInput(draft), warnings };
}

/** The engine result laid out on the workbook's output cells (null = blank cell). */
export function resultToWorkbookCells(res: RatingResult): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  const S = (cell: string, x: CellValue) => (out[`Scorecard!${cell}`] = x);
  S('C11', res.deal.track);
  S('C14', res.deal.suggestedTrack);
  S('D14', res.deal.trackCheckText);
  S('D10', res.deal.moduleName);
  S('C18', res.deal.ead);
  for (let r = GRID.factorFirst; r <= GRID.factorLast; r++) {
    const f = res.factors[r - GRID.factorFirst];
    S(`E${r}`, f ? f.effectiveWeight : 0);
    S(`H${r}`, f ? f.bandText : null);
    S(`AZ${r}`, f ? f.metricHint : null);
    S(`I${r}`, f ? f.calculatedScore : null);
    S(`L${r}`, f ? f.scoreUsed : null);
    S(`O${r}`, f ? f.meaning : null);
    S(`P${r}`, f ? f.status : null);
  }
  for (let r = GRID.questionFirst; r <= GRID.questionLast; r++)
    S(`P${r}`, res.questions[r - GRID.questionFirst]?.status ?? null);
  for (let r = GRID.shockFirst; r <= GRID.shockLast; r++) {
    const s = res.shocks[r - GRID.shockFirst];
    S(`I${r}`, s ? s.cost : 0);
    S(`P${r}`, s ? s.status : null);
  }
  S('C96', res.pillars['P1']!.score);
  S('C97', res.pillar2BeforeRules);
  S('C98', res.pillars['P2']!.score);
  S('C99', res.campari);
  ['PF1', 'PF2', 'PF3', 'PF4', 'PF5'].forEach((p, i) => S(`C${100 + i}`, res.pillars[p]!.score));
  S('F98', res.pillar2RuleNote);
  S('C105', res.blendedScore);
  S('C106', res.gradeScore);
  res.overlays.forEach((o, i) => {
    S(`C${GRID.overlayFirst + i}`, o.descriptor);
    S(`P${GRID.overlayFirst + i}`, o.status);
  });
  S('C114', res.overlayTotal);
  S('C115', res.scoreAfterOverlays);
  S('C119', res.history.regNo === '' ? null : res.history.regNo);
  res.history.counts.forEach((c, i) => S(`C${120 + i}`, c));
  S('C127', res.history.summary);
  S('C128', res.history.adjustment);
  S('C129', res.history.characterFlag);
  S('P129', res.history.characterStatus);
  S('C133', res.obligor.score);
  S('C134', res.obligor.gradeBeforeHistory);
  S('C135', res.obligor.model);
  S('C137', res.obligor.final);
  S('C138', res.obligor.overrideStatus);
  S('C142', res.structure.notchingAvailableText);
  S('C144', res.structure.notchesUsed);
  S('C145', res.structure.notchingText);
  S('C147', res.structure.selfLiquidating);
  S('C148', res.facility.beforeLimits);
  S('C149', res.facility.afterUpliftFloor);
  S('C150', res.facility.afterOfftakerCap);
  S('C151', res.facility.afterConstructionCap);
  S('C152', res.facility.model);
  S('C154', res.facility.final);
  S('C155', res.facility.overrideStatus);
  S('C164', res.pd);
  S('C165', res.collateral.lgd);
  S('C167', res.elPct);
  S('C168', res.elUsd);
  S('C169', res.minYield);
  S('C171', res.pricingStatus);
  S('C174', res.knockouts.KO1);
  S('C175', res.knockouts.KO2);
  S('C176', res.knockouts.KO3);
  S('C177', res.recommendation);
  S('C178', res.reviewCycle);
  S('C179', res.nextReviewDate === null ? null : isoToSerial(res.nextReviewDate));

  const F = (cell: string, x: CellValue) => (out[`Financials!${cell}`] = x);
  const m = res.financials;
  const order = [
    'SCALEX',
    'PROPVAL',
    'MARGIN',
    'PFDEBT',
    'LEV',
    'ICR',
    'CR',
    'DE',
    'CASHM',
    'LTV',
    'DY',
    'RESM',
    'VERIF',
    'MEANS',
    'FCREV',
    'FCEBITDA',
    'CFADS',
    'DSCRB',
    'SHOCKS',
    'DSCRS',
  ] as const;
  order.forEach((code, i) => F(`H${6 + i}`, m[code]));

  const C = (cell: string, x: CellValue) => (out[`Collateral!${cell}`] = x);
  for (let r = GRID.collateralFirst; r <= GRID.collateralLast; r++) {
    // Collateral lines are laid out from the first row, in order.
    const l = res.collateral.lines[r - GRID.collateralFirst];
    C(`E${r}`, l ? l.rangeText : null);
    C(`F${r}`, l ? l.suggestedHaircut : null);
    C(`I${r}`, l ? l.haircutUsed : null);
    C(`J${r}`, l ? l.recoverable : 0);
    C(`K${r}`, l ? l.status : null);
  }
  C('D25', res.collateral.totalValue);
  C('D26', res.collateral.totalRecoverable);
  C('D27', res.collateral.lgdFormula);
  C('D28', res.collateral.lgd);
  C('D29', res.collateral.lgdBasis);
  C('D30', res.collateral.coverText);

  res.checks.forEach((c, i) => {
    out[`Checks!D${8 + i}`] = c.status;
    out[`Checks!E${8 + i}`] = c.detail;
  });
  out['Checks!D4'] = res.checksSummary;
  out['Checks!E4'] = res.checksCounts;
  out['Blacklist!C5'] = res.knockouts.KO6;
  out['Knockouts!F9'] = res.knockouts.KO4;
  out['Knockouts!F10'] = res.knockouts.KO5;
  return out;
}
