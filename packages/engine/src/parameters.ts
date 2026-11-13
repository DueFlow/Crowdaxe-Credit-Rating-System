/**
 * Parameter set: every rule value and methodology table the engine uses (methodology-spec.md section 21,
 * data-inventory.md section 4). No methodology value is written in engine code; everything comes from here.
 */
import { z } from 'zod';

const text = z.string().min(1);
const optText = z.string().min(1).nullable();
const yesNo = z.enum(['Yes', 'No']);

export const scalarSchema = z.object({
  name: text,
  value: z.union([z.number(), z.string(), z.null()]),
  unit: z.string().nullable(),
  ref: z.string().nullable(),
  note: z.string().nullable(),
  proposed: z.boolean(),
  origin: z.string().nullable().optional(),
});

export const ratingScaleRowSchema = z.object({
  grade: z.number().int().min(1),
  description: text,
  cxScale: text,
  pd: z.number().min(0).max(1),
  appetite: text,
  reviewMonths: z.number().int().min(0),
  reviewCycle: text,
});

export const overlaySchema = z.object({
  ord: z.number().int().min(1),
  name: text,
  maxNotches: z.number().int().min(0),
  descriptors: z.array(z.string().nullable()),
});

export const tracks = ['Corporate', 'Project finance'] as const;
export const trackSchema = z.enum(tracks);
export type Track = z.infer<typeof trackSchema>;

export const structureSchema = z.object({
  code: text,
  track: trackSchema,
  name: text,
  minNotch: z.number().int(),
  maxNotch: z.number().int(),
  selfLiquidating: z.boolean(),
  offtake: z.boolean(),
  ref: optText,
  conditions: optText,
  proposed: z.boolean(),
});

export const moduleSchema = z.object({
  code: text,
  name: text,
  track: trackSchema,
  factorSet: text,
  subSectorSet: optText,
  haircutSet: text,
  ref: optText,
});

export const factorTypes = ['Numeric', 'Descriptor', 'SubSector', 'Offtaker', 'Link'] as const;

export const factorSchema = z.object({
  set: text,
  ord: z.number().int().min(1),
  key: text,
  pillar: text,
  profile: optText,
  name: text,
  weight: z.number().min(0).max(1),
  measure: optText,
  unit: optText,
  type: z.enum(factorTypes),
  dir: z.enum(['H', 'L']).nullable(),
  scale: z.union([z.literal(3), z.literal(5)]),
  nb: z.union([z.literal(0), z.literal(2), z.literal(4)]),
  bounds: z.array(z.number()),
  fFlags: z.array(z.number().int().min(0).max(1)),
  neg: z.boolean(),
  group: optText,
  optional: z.boolean(),
  trackOnly: trackSchema.nullable(),
  role: z.enum(['BASEDSCR', 'CHAR']).nullable(),
  link: z.literal('CAMP').nullable(),
  descriptors: z.array(z.string().nullable()).length(5),
  ref: optText,
  auto: optText,
  legacy: z
    .object({ topCut: z.number().nullable(), botCut: z.number().nullable(), judge: z.number().nullable() })
    .optional(),
});

export const subSectorSchema = z.object({
  set: text,
  ord: z.number().int(),
  name: text,
  gradeLow: z.number().nullable(),
  gradeHigh: z.number().nullable(),
  special: z.enum(['ANCHORGRADE', 'GRADEPLUS1']).nullable(),
});

export const haircutSchema = z.object({
  set: text,
  ord: z.number().int(),
  name: text,
  low: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
  crossBorderAddOn: z.number().min(0).max(1),
  ref: optText,
  linkedCoreOrd: z.number().int().nullable(),
});

export const questionSchema = z.object({
  module: text,
  ord: z.number().int(),
  key: text,
  kind: z.enum(['Red flag', 'Condition', 'Modifier']),
  question: text,
  flagAnswer: z.enum(['Yes', 'No']),
  target: optText,
  modifierType: z.enum(['Add', 'Min', 'Set']).nullable(),
  modifierValue: z.number().nullable(),
  ref: optText,
  proposed: z.boolean(),
});

export const shockSchema = z.object({
  module: text,
  ord: z.number().int(),
  key: text,
  name: text,
  size: optText,
  ref: optText,
  costType: z.enum(['Volume', 'Price', 'Cost', 'Delay', 'FX', 'Info']),
  defaultValue: z.number(),
});

/** Scalars the engine requires, with their type. */
const REQUIRED_NUMBERS = [
  'Wt_P1',
  'Wt_P2',
  'Wt_P3',
  'Wt_PF1',
  'Wt_PF2',
  'Wt_PF3',
  'Wt_PF4',
  'Wt_PF5',
  'Overlay_Cap',
  'KO_CharScore',
  'KO_DSCRMin',
  'KO2_P2Score',
  'RE_StressLTV_Trigger',
  'RE_P2_Cap',
  'Uplift_BestGrade',
  'Construct_CapGrade',
  'Construct_GuarantorBest',
  'LGD_Floor',
  'LGD_Unsecured',
  'Dec_ObligorDecline',
  'Dec_FacilityDecline',
  'Dec_FacilityConditions',
  'Ovr_MaxNoApproval',
  'Ovr_RateTrigger',
  'Ovr_YearStartMonth',
  'Hist_Credit1',
  'Hist_Credit1_Min',
  'Hist_Credit2',
  'Hist_Credit2_Min',
  'Hist_Penalty',
  'Hist_BestGrade',
  'Hist_CharacterSuggest',
  'Scale_Max',
  'Scale_Min',
  'Grade_Factor',
  'Checks_Total',
  'Interp_NB4_A1',
  'Interp_NB4_A2',
  'Interp_NB4_A3',
  'Interp_NB4_A4',
  'Interp_NB2_A1',
  'Interp_NB2_A2',
  'Tol_ScoreOverride',
  'Tol_Weights',
  'Tol_ShockValue',
  'Tol_Haircut',
  'Overlay_InfoQuality_Ord',
] as const;
const OPTIONAL_NUMBERS = [
  'Price_CostOfFunds',
  'Price_OperatingCost',
  'Price_TargetMargin',
  'Hist_LookbackYears',
] as const;
const REQUIRED_TEXTS = [
  'Txt_Approve',
  'Txt_Conditions',
  'Txt_Decline',
  'Txt_KO1',
  'Txt_KO2',
  'Txt_KO3',
  'Txt_KO6',
  'Method_Version',
  'CRS_Version',
] as const;
const SWITCHES = ['LGD_CapAtUnsecured', 'Hist_Enabled', 'KO6_Enabled', 'KO6_CheckBorrowerOnPF'] as const;

export type NumberParam = (typeof REQUIRED_NUMBERS)[number];
export type OptionalNumberParam = (typeof OPTIONAL_NUMBERS)[number];
export type TextParam = (typeof REQUIRED_TEXTS)[number];
export type SwitchParam = (typeof SWITCHES)[number];

export const parameterSetSchema = z
  .object({
    version: text,
    methodVersion: text,
    workbookVersion: text,
    source: z.string().optional(),
    scalars: z.array(scalarSchema),
    ratingScale: z.array(ratingScaleRowSchema).min(2),
    overlays: z.array(overlaySchema),
    structures: z.array(structureSchema),
    modules: z.array(moduleSchema).min(1),
    factors: z.array(factorSchema),
    subSectors: z.array(subSectorSchema),
    haircuts: z.array(haircutSchema),
    questions: z.array(questionSchema),
    shocks: z.array(shockSchema),
    lists: z.record(z.array(z.string())),
  })
  .superRefine((ps, ctx) => {
    const byName = new Map(ps.scalars.map((s) => [s.name, s.value]));
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    for (const n of REQUIRED_NUMBERS)
      if (typeof byName.get(n) !== 'number') issue(`Parameter ${n} must be a number`);
    for (const n of OPTIONAL_NUMBERS) {
      const v = byName.get(n);
      if (v !== null && v !== undefined && typeof v !== 'number')
        issue(`Parameter ${n} must be a number or blank`);
    }
    for (const n of REQUIRED_TEXTS)
      if (typeof byName.get(n) !== 'string') issue(`Parameter ${n} must be text`);
    for (const n of SWITCHES)
      if (!yesNo.safeParse(byName.get(n)).success) issue(`Parameter ${n} must be Yes or No`);
    if (new Set(ps.scalars.map((s) => s.name)).size !== ps.scalars.length)
      issue('Parameter names must be unique');

    ps.ratingScale.forEach((r, i) => {
      if (r.grade !== i + 1) issue(`Rating scale grades must run 1, 2, 3 … in order (row ${i + 1})`);
    });
    const near1 = (x: number) => Math.abs(x - 1) <= 1e-9;
    const w = (n: string) => (typeof byName.get(n) === 'number' ? (byName.get(n) as number) : NaN);
    if (!near1(w('Wt_P1') + w('Wt_P2') + w('Wt_P3'))) issue('Pillar weights Wt_P1 to Wt_P3 must sum to 100%');
    if (!near1(w('Wt_PF1') + w('Wt_PF2') + w('Wt_PF3') + w('Wt_PF4') + w('Wt_PF5')))
      issue('Pillar weights Wt_PF1 to Wt_PF5 must sum to 100%');

    const keys = new Set<string>();
    for (const f of ps.factors) {
      if (f.key !== `${f.set}|${f.ord}`) issue(`Factor key ${f.key} must be "${f.set}|${f.ord}"`);
      if (keys.has(f.key)) issue(`Duplicate factor key ${f.key}`);
      keys.add(f.key);
      if (f.type === 'Numeric') {
        if (f.nb !== 2 && f.nb !== 4) issue(`Numeric factor ${f.key} needs 2 or 4 band boundaries`);
        if (f.bounds.length !== f.nb || f.fFlags.length !== f.nb)
          issue(`Factor ${f.key}: number of boundaries and f-flags must equal NB`);
        if (!f.dir) issue(`Numeric factor ${f.key} needs a direction (H or L)`);
        for (let k = 1; k < f.bounds.length; k++) {
          const a = f.bounds[k - 1]!;
          const b = f.bounds[k]!;
          if (f.dir === 'H' ? !(a > b) : !(a < b))
            issue(
              `Factor ${f.key}: boundaries must be strictly ${f.dir === 'H' ? 'decreasing' : 'increasing'} (D-12)`,
            );
        }
      }
      if (f.optional && !f.group)
        issue(`Optional factor ${f.key} must belong to a weight-sharing group (D-10)`);
    }
    for (const g of new Set(
      ps.factors.filter((f) => f.group).map((f) => `${f.set}|${f.pillar}|${f.group}`),
    )) {
      const members = ps.factors.filter((f) => `${f.set}|${f.pillar}|${f.group}` === g);
      if (members.every((m) => m.optional)) issue(`Group ${g} needs at least one non-optional factor (D-10)`);
    }
    const contiguous = (label: string, groups: Map<string, number[]>) => {
      for (const [g, ords] of groups) {
        const sorted = [...ords].sort((a, b) => a - b);
        if (sorted.some((o, i) => o !== i + 1))
          issue(`${label} ${g}: order numbers must run 1, 2, 3 … without gaps`);
      }
    };
    const groupOrds = <T>(rows: T[], k: (r: T) => string, o: (r: T) => number) => {
      const m = new Map<string, number[]>();
      for (const r of rows) m.set(k(r), [...(m.get(k(r)) ?? []), o(r)]);
      return m;
    };
    contiguous(
      'Factor set',
      groupOrds(
        ps.factors,
        (f) => f.set,
        (f) => f.ord,
      ),
    );
    contiguous(
      'Questions of module',
      groupOrds(
        ps.questions,
        (q) => q.module,
        (q) => q.ord,
      ),
    );
    contiguous(
      'Shocks of module',
      groupOrds(
        ps.shocks,
        (s) => s.module,
        (s) => s.ord,
      ),
    );
    if (!ps.overlays.some((o) => o.ord === w('Overlay_InfoQuality_Ord')))
      issue('Overlay_InfoQuality_Ord must be the order number of an overlay');
    for (const m of ps.modules) {
      const applying = ps.factors.filter(
        (f) =>
          (f.set === m.factorSet || f.set === 'CORE') && (f.trackOnly === null || f.trackOnly === m.track),
      );
      for (const pillar of new Set(applying.map((f) => f.pillar))) {
        const sum = applying.filter((f) => f.pillar === pillar).reduce((t, f) => t + f.weight, 0);
        if (Math.abs(sum - 1) > 1e-9)
          issue(
            `Module ${m.code}: factor weights in pillar ${pillar} sum to ${Math.round(sum * 10000) / 100}%, not 100%`,
          );
      }
      if (!ps.factors.some((f) => f.set === m.factorSet))
        issue(`Module ${m.code}: factor set ${m.factorSet} not found`);
      if (!ps.haircuts.some((h) => h.set === m.haircutSet))
        issue(`Module ${m.code}: haircut set ${m.haircutSet} not found`);
    }
    for (const q of ps.questions) {
      if (q.key !== `${q.module}|${q.ord}`) issue(`Question key ${q.key} must be "${q.module}|${q.ord}"`);
      if (q.target && !keys.has(q.target)) issue(`Question ${q.key}: target factor ${q.target} not found`);
      if ((q.target === null) !== (q.modifierType === null))
        issue(`Question ${q.key}: target and modifier go together`);
    }
    for (const s of ps.shocks)
      if (s.key !== `${s.module}|${s.ord}`) issue(`Shock key ${s.key} must be "${s.module}|${s.ord}"`);
    for (const s of ps.structures)
      if (s.minNotch > s.maxNotch) issue(`Structure ${s.code}: min notch above max notch`);
    for (const l of ['lst_HistStatus', 'lst_Accounts']) if (!ps.lists[l]) issue(`List ${l} is required`);
    if ((ps.lists['lst_HistStatus']?.length ?? 0) !== 7)
      issue('lst_HistStatus must have the 7 Deal History statuses');
  });

export type ParameterSetDoc = z.infer<typeof parameterSetSchema>;
export type FactorDef = z.infer<typeof factorSchema>;
export type ModuleDef = z.infer<typeof moduleSchema>;
export type StructureDef = z.infer<typeof structureSchema>;
export type QuestionDef = z.infer<typeof questionSchema>;
export type ShockDef = z.infer<typeof shockSchema>;
export type SubSectorDef = z.infer<typeof subSectorSchema>;
export type HaircutDef = z.infer<typeof haircutSchema>;
export type RatingScaleRow = z.infer<typeof ratingScaleRowSchema>;

/** A validated parameter set with typed accessors. */
export class ParameterSet {
  readonly doc: ParameterSetDoc;
  private readonly values: Map<string, number | string | null>;

  private constructor(doc: ParameterSetDoc) {
    this.doc = doc;
    this.values = new Map(doc.scalars.map((s) => [s.name, s.value]));
  }

  /** Validate and wrap a parameter set document. Throws a ZodError listing every problem. */
  static parse(raw: unknown): ParameterSet {
    return new ParameterSet(parameterSetSchema.parse(raw));
  }

  /** Validate without throwing; returns plain-English issues for the Admin screens. */
  static validate(raw: unknown): string[] {
    const r = parameterSetSchema.safeParse(raw);
    return r.success
      ? []
      : r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  }

  num(name: NumberParam): number {
    return this.values.get(name) as number;
  }

  optNum(name: OptionalNumberParam): number | null {
    const v = this.values.get(name);
    return typeof v === 'number' ? v : null;
  }

  text(name: TextParam): string {
    return this.values.get(name) as string;
  }

  on(name: SwitchParam): boolean {
    return this.values.get(name) === 'Yes';
  }

  /** Raw switch text, for outputs that show it ("Yes"/"No"). */
  switchText(name: SwitchParam): string {
    return this.values.get(name) as string;
  }

  get gradeMax(): number {
    return this.doc.ratingScale.length;
  }

  grade(g: number): RatingScaleRow {
    return this.doc.ratingScale[g - 1]!;
  }

  module(code: string | null): ModuleDef | undefined {
    return code ? this.doc.modules.find((m) => m.code === code) : undefined;
  }

  list(code: string): string[] {
    return this.doc.lists[code] ?? [];
  }
}
