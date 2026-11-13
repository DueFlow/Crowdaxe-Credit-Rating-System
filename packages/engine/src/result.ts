/** Engine output (data-inventory.md section 2). Blank in the workbook is null here. */

export type CheckStatus = 'Passed' | 'Warning' | 'Error';
export type KoResult = 'Knockout' | 'Clear';

export interface FinancialMetrics {
  SCALEX: number | null;
  PROPVAL: number | null;
  MARGIN: number | null;
  PFDEBT: number;
  LEV: number | null;
  ICR: number | null;
  CR: number | null;
  DE: number | null;
  CASHM: number | null;
  LTV: number | null;
  DY: number | null;
  RESM: number | null;
  VERIF: number | null;
  MEANS: number | null;
  FCREV: number;
  FCEBITDA: number;
  CFADS: number;
  DSCRB: number | null;
  SHOCKS: number;
  DSCRS: number | null;
}

export interface FactorResult {
  key: string;
  pillar: string;
  name: string;
  type: string;
  weight: number;
  effectiveWeight: number;
  applies: boolean;
  measure: string | null;
  /** Metric used: typed on the factor, else from Financials (Corporate track). */
  metricUsed: number | string | null;
  metricFromFinancials: boolean;
  /** "From Financials: 1.50x" when the metric came from the Financials step (AZ). */
  metricHint: string | null;
  band: number | null;
  bandText: string | null;
  /** Interpolated (numeric) or range-midpoint (sub-sector, offtaker) score before modifiers. */
  baseScore: number | null;
  modifiers: { add: number; min: number; set: number };
  calculatedScore: number | null;
  analystScore: number | null;
  scoreUsed: number | null;
  weighted: number;
  meaning: string | null;
  status: string | null;
  evidence: string | null;
}

export interface QuestionResult {
  key: string;
  kind: string;
  question: string;
  flagAnswer: string;
  answer: string | null;
  explanation: string | null;
  target: string | null;
  modifierType: string | null;
  modifierValue: number;
  status: string;
}

export interface ShockResult {
  key: string;
  name: string;
  size: string | null;
  costType: string;
  defaultValue: number;
  valueUsed: number;
  apply: string | null;
  cost: number;
  status: string;
}

export interface PillarResult {
  code: string;
  score: number | null;
  weightSum: number;
  applies: boolean;
}

export interface OverlayResult {
  ord: number;
  name: string;
  maxNotches: number;
  notches: number | null;
  descriptor: string | null;
  reason: string | null;
  status: string;
}

export interface CollateralResult {
  type: string | null;
  value: number | null;
  rangeText: string | null;
  suggestedHaircut: number | null;
  haircutUsed: number | null;
  recoverable: number;
  status: string | null;
}

export interface CheckResult {
  no: number;
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface RatingResult {
  engineVersion: string;
  parameterSetVersion: string;
  methodVersion: string;
  deal: {
    moduleName: string | null;
    track: string | null;
    suggestedTrack: string;
    trackCheckText: string | null;
    ead: number;
    factorSet: string | null;
    subSectorSet: string | null;
    haircutSet: string | null;
  };
  financials: FinancialMetrics;
  factors: FactorResult[];
  questions: QuestionResult[];
  shocks: ShockResult[];
  pillars: Record<string, PillarResult>;
  pillar2BeforeRules: number | null;
  pillar2RuleNote: string | null;
  campari: number | null;
  blendedScore: number | null;
  gradeScore: number | null;
  overlays: OverlayResult[];
  overlayTotal: number;
  scoreAfterOverlays: number | null;
  history: {
    enabled: boolean;
    regNo: string;
    statuses: string[];
    counts: number[];
    summary: string;
    adjustment: number;
    characterFlag: string;
    characterStatus: string;
  };
  obligor: {
    score: number | null;
    gradeBeforeHistory: number | null;
    model: number | null;
    final: number | null;
    overrideStatus: string;
  };
  structure: {
    name: string | null;
    code: string | null;
    minNotch: number;
    maxNotch: number;
    notchingAvailableText: string | null;
    notchesUsed: number;
    notchingText: string;
    selfLiquidating: 'Yes' | 'No';
    offtake: boolean;
    conditions: string | null;
  };
  facility: {
    beforeLimits: number | null;
    afterUpliftFloor: number | null;
    afterOfftakerCap: number | null;
    afterConstructionCap: number | null;
    model: number | null;
    final: number | null;
    overrideStatus: string;
  };
  override: { applied: boolean; blocked: boolean };
  collateral: {
    lines: CollateralResult[];
    count: number;
    totalValue: number;
    totalRecoverable: number;
    lgdFormula: number | null;
    lgd: number | null;
    lgdBasis: string | null;
    coverText: string | null;
  };
  pd: number | null;
  elPct: number | null;
  elUsd: number | null;
  minYield: number | string | null;
  pricingStatus: string;
  knockouts: {
    KO1: KoResult;
    KO2: KoResult;
    KO3: KoResult;
    KO4: string | null;
    KO5: string | null;
    KO6: string;
  };
  characterScore: number | null;
  baseDscr: number | string | null;
  recommendation: string;
  reviewCycle: string | null;
  nextReviewDate: string | null;
  checks: CheckResult[];
  checksSummary: string;
  checksCounts: string;
  /** Problems the workbook would not flag but which must stop a Final rating (D-13). */
  integrityIssues: string[];
  /** True when a Final save is allowed: no Error check, no blocked override, no integrity issue. */
  canFinalise: boolean;
}
