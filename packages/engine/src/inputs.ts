/**
 * Rating inputs (data-inventory.md section 1) and the Deal History snapshot (D-01).
 *
 * Yes/No answers are kept as the literal text the workbook compares ("Yes", "No", "N/A") so that any
 * other value behaves exactly as in the workbook. Blank is null.
 */
import { z } from 'zod';

const str = z.string().nullable().default(null);
const num = z.number().finite().nullable().default(null);
const numOrText = z.union([z.number().finite(), z.string()]).nullable().default(null);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form yyyy-mm-dd')
  .nullable()
  .default(null);

export const dealInputSchema = z.object({
  dealId: str,
  borrowerName: str,
  regNo: str,
  ratingType: str,
  moduleCode: str,
  b0UnderConstruction: str,
  b0GenerationAsset: str,
  facilityType: str,
  amount: num,
  eadInput: num,
  tenorMonths: numOrText,
  ratingDate: isoDate,
  analystName: str,
  reviewerName: str,
  statementsBasis: str,
  accountsType: str,
  subSector: str,
  /** 1 to 10, or the text "Ungraded international buyer" */
  offtakerGrade: numOrText,
  offtakerType: str,
  stressedLtv: num,
  sponsorRegNo: str,
  ko3RepaymentsBeforeCash: str,
  /** Recorded only; no rule uses it (D-06). */
  proceedsControlled: str,
  completionCertified: str,
  completionGuarantorGrade: num,
  bankPerformanceBond: str,
});

export const financialsInputSchema = z.object({
  revenue: z.tuple([num, num, num]).default([null, null, null]),
  ebitda: z.tuple([num, num, num]).default([null, null, null]),
  existingDebt: num,
  cash: num,
  currentAssets: num,
  currentLiabilities: num,
  totalEquity: num,
  propertyValue: num,
  forecastRevenue: num,
  forecastEbitda: num,
  tax: num,
  maintenanceCapex: num,
  workingCapitalIncrease: num,
  annualInterest: num,
  annualDebtService: num,
  revenueVerified: num,
  ownersCash: num,
  totalFundingNeed: num,
  zigRevenueShare: num,
  variableCostShare: num,
});

export const factorInputSchema = z.object({
  /** Metric typed on the factor (wins over the Financials value). Text is kept but cannot be scored. */
  metric: numOrText,
  /** Analyst score 1 to 5: the rating for descriptor factors, an override for calculated ones. */
  score: num,
  notApplicable: str,
  evidence: str,
});

export const questionInputSchema = z.object({ answer: str, explanation: str });
export const shockInputSchema = z.object({ apply: str, valueUsed: num, reason: str });
export const overlayInputSchema = z.object({ notches: num, reason: str });
export const collateralInputSchema = z.object({
  type: str,
  value: num,
  haircut: num,
  crossBorderNoTracking: str,
  note: str,
});

export const ratingInputSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  deal: dealInputSchema.default({}),
  financials: financialsInputSchema.default({}),
  factors: z.record(factorInputSchema).default({}),
  questions: z.record(questionInputSchema).default({}),
  shocks: z.record(shockInputSchema).default({}),
  /** Keyed by overlay order "1" to "5". */
  overlays: z.record(overlayInputSchema).default({}),
  characterJustification: str,
  structure: z.object({ name: str, notches: num, reason: str }).default({}),
  collateral: z.array(collateralInputSchema).default([]),
  override: z
    .object({ obligorGrade: num, facilityGrade: num, reason: str, approverName: str, approvalDate: isoDate })
    .default({}),
  proposedAllInYield: num,
});

export type RatingInput = z.infer<typeof ratingInputSchema>;
export type RatingInputDraft = z.input<typeof ratingInputSchema>;
export type FactorInput = z.infer<typeof factorInputSchema>;

/** Deal History row as used for the rating (derived from Deal Activity, or an opening-balance record). */
export const historyRowSchema = z.object({
  regNo: z.string(),
  dealId: z.string().nullable().default(null),
  status: z.string(),
  maturityDate: isoDate,
});

export const blacklistRowSchema = z.object({
  regNo: z.string(),
  status: z.enum(['Active', 'Lifted']),
});

/**
 * The Deal History and Blacklist the rating was calculated with, frozen at save (D-01).
 * It holds the rows for the registration numbers concerned; the engine selects and counts them.
 */
export const historySnapshotSchema = z.object({
  asOf: isoDate,
  rows: z.array(historyRowSchema).default([]),
  blacklist: z.array(blacklistRowSchema).default([]),
});

export type HistoryRow = z.infer<typeof historyRowSchema>;
export type HistorySnapshot = z.infer<typeof historySnapshotSchema>;

/** Parse inputs, filling every missing field with blank. Throws a ZodError on wrong types. */
export function parseRatingInput(raw: unknown): RatingInput {
  return ratingInputSchema.parse(raw);
}

export function parseHistorySnapshot(raw: unknown): HistorySnapshot {
  return historySnapshotSchema.parse(raw);
}

/** Registration-number match key: trimmed, upper case, internal spaces removed (D-34). */
export function regNoKey(regNo: string | null | undefined): string {
  return (regNo ?? '').replace(/\s+/g, '').toUpperCase();
}
