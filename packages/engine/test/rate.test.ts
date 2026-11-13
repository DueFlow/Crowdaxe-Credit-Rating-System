/**
 * Table-driven and property tests of the rating rules, built on the workbook's s9.4 worked example
 * (self-test T01: module B1, blended 2.99, obligor 7, facility 5).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CellValue,
  type HistorySnapshot,
  ParameterSet,
  type RatingInput,
  type RatingResult,
  decodeWorkbookValue,
  inputFromWorkbookCells,
  metricText,
  parseHistorySnapshot,
  parseRatingInput,
  rate,
  regNoKey,
} from '../src/index.js';
import { fixture, params11, withParams } from './helpers.js';

const rows = fixture<{ rows: { case: string; kind: string; key: string; value: string }[] }>(
  'testcases.json',
).rows;
const cellsOf = (id: string) => {
  const c: Record<string, CellValue> = {};
  for (const r of rows) if (r.case === id && r.kind === 'Input') c[r.key] = decodeWorkbookValue(r.value);
  return c;
};
/** T01 with the sector questions and stress shocks answered, so it can be saved as Final. */
const T01 = (() => {
  const i = inputFromWorkbookCells(cellsOf('T01'), params11).input;
  for (const q of params11.doc.questions.filter((x) => x.module === 'B1'))
    i.questions[q.key] = { answer: q.flagAnswer === 'Yes' ? 'No' : 'Yes', explanation: null };
  for (const s of params11.doc.shocks.filter((x) => x.module === 'B1'))
    i.shocks[s.key] = { apply: 'Yes', valueUsed: null, reason: null };
  return i;
})();
const T09A = inputFromWorkbookCells(cellsOf('T09A'), params11).input;
const clone = (x: RatingInput): RatingInput => structuredClone(x);
const noHistory = parseHistorySnapshot({});
const run = (
  edit: (i: RatingInput) => void = () => undefined,
  ps: ParameterSet = params11,
  h: HistorySnapshot = noHistory,
  base = T01,
): RatingResult => {
  const i = clone(base);
  edit(i);
  return rate(i, ps, h);
};
const check = (r: RatingResult, no: number) => r.checks[no - 1]!;

describe('worked example (s9.4)', () => {
  const r = run();
  it('reproduces the methodology example', () => {
    expect(r).toMatchObject({
      blendedScore: 2.99,
      gradeScore: 5.52,
      scoreAfterOverlays: 6.52,
      recommendation: 'Recommend approval',
      reviewCycle: 'Annual',
    });
    expect(r.obligor).toMatchObject({ model: 7, final: 7, overrideStatus: 'No override' });
    expect(r.facility).toMatchObject({ beforeLimits: 5, model: 5, final: 5 });
    expect(r.pd).toBe(0.035);
    expect(r.elUsd).toBeCloseTo(1750, 9);
    expect(r.canFinalise).toBe(true);
    expect(r.checksSummary).toBe('10 of 13 data checks passed');
    expect(r.checksCounts).toBe('3 warning(s), 0 error(s)');
  });
});

describe('knockouts', () => {
  it('KO1 Character rated 1', () => {
    const r = run((i) => (i.factors['CORE|2']!.score = 1));
    expect(r.knockouts.KO1).toBe('Knockout');
    expect(r.recommendation).toBe('Decline (knockout: Character rated 1)');
  });
  it('KO2 base DSCR below 1.00x unless self-liquidating; Pillar 2 forced to 1', () => {
    const r = run((i) => {
      i.factors['B1|11']!.metric = 0.95;
      i.structure.name = 'Corporate (general security)';
      i.structure.notches = 1;
    });
    expect(r.knockouts.KO2).toBe('Knockout');
    expect(r.pillars['P2']!.score).toBe(1);
    expect(r.pillar2RuleNote).toBe('Base DSCR knockout: Pillar 2 set to 1');
    expect(r.recommendation).toMatch(/^Decline \(knockout: base DSCR/);
    expect(run((i) => (i.factors['B1|11']!.metric = 0.95)).knockouts.KO2).toBe('Clear'); // T01 is warehouse receipts (self-liquidating)
    expect(run((i) => (i.factors['B1|11']!.metric = 'n/a')).knockouts.KO2).toBe('Clear');
  });
  it('KO3 repayments before cash', () => {
    const r = run((i) => (i.deal.ko3RepaymentsBeforeCash = 'Yes'));
    expect(r.knockouts.KO3).toBe('Knockout');
    expect(r.recommendation).toMatch(/^Not rated/);
  });
  it('KO4 obligor 8+ and KO5 facility 7+', () => {
    const r = run((i) => (i.overlays['3'] = { notches: 1, reason: 'parastatal' }));
    expect(r.obligor.final).toBe(8);
    expect(r.knockouts.KO4).toBe('Decline');
    expect(r.recommendation).toBe('Decline');
    const f = run((i) => (i.structure.notches = 0));
    expect(f.facility.final).toBe(7);
    expect(f.knockouts).toMatchObject({ KO4: 'Clear', KO5: 'Decline' });
    expect(f.recommendation).toBe('Decline');
    expect(run((i) => (i.structure.notches = 1)).recommendation).toMatch(
      /^Recommend approval with conditions/,
    );
  });
  it('KO6 blacklist: knockout, warning when switched off, sponsor-only on project finance (D-23)', () => {
    const bl = parseHistorySnapshot({ blacklist: [{ regNo: ' selftest-reg ', status: 'Active' }] });
    expect(run(undefined, params11, bl).knockouts.KO6).toBe('Knockout');
    expect(run(undefined, params11, bl).recommendation).toBe(
      'Decline (knockout: company blacklisted by Crowdaxe)',
    );
    expect(run(undefined, withParams({ KO6_Enabled: 'No' }), bl).knockouts.KO6).toBe('Warning');
    expect(
      run(
        undefined,
        params11,
        parseHistorySnapshot({ blacklist: [{ regNo: 'SELFTEST-REG', status: 'Lifted' }] }),
      ).knockouts.KO6,
    ).toBe('Clear');
    expect(run((i) => (i.deal.regNo = null), params11, bl).knockouts.KO6).toBe('Clear');
    const pfBl = parseHistorySnapshot({ blacklist: [{ regNo: 'BORROWER-SPV', status: 'Active' }] });
    const pf = (i: RatingInput) => (i.deal.regNo = 'BORROWER-SPV');
    expect(run(pf, params11, pfBl, T09A).knockouts.KO6).toBe('Clear');
    expect(run(pf, withParams({ KO6_CheckBorrowerOnPF: 'Yes' }), pfBl, T09A).knockouts.KO6).toBe('Knockout');
  });
});

describe('recommendation', () => {
  it('review ratings show the appetite of the facility grade (D-19)', () => {
    expect(run((i) => (i.deal.ratingType = 'Review')).recommendation).toBe('Existing exposure: Eligible');
  });
  it('incomplete while a score is missing', () => {
    const r = run((i) => (i.factors['CORE|3']!.score = null));
    expect(r.campari).toBeNull();
    expect(r.recommendation).toBe('Incomplete: scores missing');
    expect(r.nextReviewDate).toBeNull();
    expect(check(r, 3)).toMatchObject({
      status: 'Error',
      detail: '1 missing, 0 override(s) without a reason, 1 override(s) with a reason',
    });
  });
  it('next review date from the rating date and the facility grade', () => {
    expect(run().nextReviewDate).toBe('2027-10-27');
    expect(run((i) => (i.deal.ratingDate = null)).nextReviewDate).toBeNull();
  });
});

describe('factor scoring', () => {
  const b1 = params11.doc.factors.find((f) => f.key === 'B1|8')!; // interest cover, H, 6 / 4 / 2.5 / 1.5
  const lev = params11.doc.factors.find((f) => f.key === 'B1|7')!; // leverage, L, 1.5 / 2.5 / 3.5 / 5, Neg
  const score = (key: string, metric: number | string | null) =>
    run((i) => {
      i.factors[key] = { metric, score: null, notApplicable: null, evidence: null };
    }).factors.find((f) => f.key === key)!;

  it.each([
    [6, 4.5, 2],
    [6.0001, 4.5, 1],
    [4, 3.5, 3],
    [2.5, 2.5, 4],
    [1.5, 1.5, 4],
    [5, 4, 2],
    [8, 5, 1],
    [1, 1, 5],
    [0, 1, 5],
    [-3, 1, 5],
  ])('interest cover %s → %s (band %s; f-flags 0,0,0,1 put b1-b3 in the weaker band)', (x, want, band) => {
    const f = score('B1|8', x);
    expect(f.calculatedScore).toBe(want);
    expect(f.band).toBe(band);
    expect(f.bandText).toBe(b1.descriptors[band - 1]);
  });
  it.each([
    [1.5, 4.5, 2],
    [1.4999, 4.5, 1],
    [2.5, 3.5, 3],
    [5, 1.5, 4],
    [5.0001, 1.5, 5],
    [7, 1, 5],
    [0, 5, 1],
    [-1, 1, 5],
  ])('leverage %s → %s (band %s): f-flags decide the band of a boundary value only', (x, want, band) => {
    const f = score('B1|7', x);
    expect(f.calculatedScore).toBe(want);
    expect(f.band).toBe(band);
  });
  it('three-band factors (NB 2) and Neg off', () => {
    const cfq = (x: number) => score('CORE|1', x);
    expect(cfq(0.8).calculatedScore).toBe(4);
    expect(cfq(0.5)).toMatchObject({ calculatedScore: 2, band: 2 }); // f2 = 1: boundary belongs to the stronger band
    expect(cfq(0.65).calculatedScore).toBe(3);
    expect(cfq(0.95).calculatedScore).toBe(5);
    expect(cfq(0.3).calculatedScore).toBe(1);
    expect(cfq(0.2).calculatedScore).toBe(1);
    // a negative value on a lower-is-better factor without Neg cannot be scored (debt/equity has Neg = 0)
    expect(score('B1|10', -0.5)).toMatchObject({
      calculatedScore: null,
      band: null,
      status: 'Score required',
    });
  });
  it('text in a metric cell is kept but not scored', () => {
    const f = score('B1|8', 'tbc');
    expect(f).toMatchObject({ metricUsed: 'tbc', calculatedScore: null, status: 'Score required' });
  });
  it('score is monotonic in the metric and stays within 1 to 5 (property)', () => {
    for (const [def, key] of [
      [b1, 'B1|8'],
      [lev, 'B1|7'],
    ] as const) {
      fc.assert(
        fc.property(
          fc.double({ min: -2, max: 12, noNaN: true }),
          fc.double({ min: 0, max: 3, noNaN: true }),
          (x, dx) => {
            const a = score(key, x).calculatedScore!;
            const b = score(key, x + dx).calculatedScore!;
            expect(a).toBeGreaterThanOrEqual(1);
            expect(a).toBeLessThanOrEqual(5);
            if (def.dir === 'H') expect(b).toBeGreaterThanOrEqual(a);
            else if (x >= 0) expect(b).toBeLessThanOrEqual(a);
          },
        ),
        { numRuns: 60 },
      );
    }
  });
  it('override of a calculated score needs a reason; descriptors need whole numbers and evidence', () => {
    expect(
      run(
        (i) => (i.factors['B1|8'] = { metric: 4, score: 3, notApplicable: null, evidence: null }),
      ).factors.find((f) => f.key === 'B1|8')!.status,
    ).toBe('Override: reason required');
    expect(
      run(
        (i) => (i.factors['B1|8'] = { metric: 4, score: 3.504, notApplicable: null, evidence: null }),
      ).factors.find((f) => f.key === 'B1|8')!.status,
    ).toBe('OK');
    const d = run((i) => {
      i.factors['B1|2']!.score = 3.5;
      i.factors['CORE|3']!.evidence = null;
    });
    expect(d.factors.find((f) => f.key === 'B1|2')!.status).toBe('Whole number 1-5 required');
    expect(d.factors.find((f) => f.key === 'CORE|3')!.status).toBe('Evidence required');
    expect(check(d, 4)).toMatchObject({ status: 'Error', detail: '1 score(s) without evidence' });
  });
  it('metric text in the factor unit', () => {
    const def = (k: string) => params11.doc.factors.find((f) => f.key === k)!;
    expect(metricText(def('B1|8'), 4)).toBe('4.00x');
    expect(metricText(def('B1|6'), 0.1234)).toBe('12.3%');
    expect(metricText(def('B5|1'), 2500000)).toBe('2,500,000');
    expect(metricText(def('B1|3'), 6)).toBe('6.00');
    expect(metricText(def('CORE|1'), 0.8)).toBe('80%');
  });
});

describe('weights', () => {
  const b7c = parseRatingInput({ deal: { moduleCode: 'B7C' } });
  it('an N/A optional factor gives its weight to its group (WCE)', () => {
    const on = rate(b7c, params11, noHistory);
    const off = rate(
      { ...b7c, factors: { 'B7C|7': { metric: null, score: null, notApplicable: 'Yes', evidence: null } } },
      params11,
      noHistory,
    );
    expect(on.factors.find((f) => f.key === 'B7C|6')!.effectiveWeight).toBeCloseTo(0.05, 12);
    expect(off.factors.find((f) => f.key === 'B7C|6')!.effectiveWeight).toBeCloseTo(0.1, 12);
    expect(off.factors.find((f) => f.key === 'B7C|7')!).toMatchObject({
      effectiveWeight: 0,
      status: 'N/A',
      applies: false,
    });
  });
  it('every applicable pillar sums to 100% whatever is marked N/A (property)', () => {
    const optional = params11.doc.factors.filter((f) => f.optional);
    fc.assert(
      fc.property(
        fc.constantFrom(...params11.doc.modules.map((m) => m.code)),
        fc.subarray(optional),
        (code, na) => {
          const i = parseRatingInput({
            deal: { moduleCode: code },
            factors: Object.fromEntries(na.map((f) => [f.key, { notApplicable: 'Yes' }])),
          });
          const r = rate(i, params11, noHistory);
          for (const p of Object.values(r.pillars)) if (p.applies) expect(p.weightSum).toBeCloseTo(1, 9);
          expect(check(r, 5).status).toBe('Passed');
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('weights that do not add up (edited parameter sets)', () => {
  it('check 5 fails when a pillar does not sum to 100%, and a zero-weight factor is an integrity issue', () => {
    const ps = ParameterSet.parse(params11.doc);
    ps.doc.factors.find((f) => f.key === 'B1|1')!.weight = 0;
    const r = run(undefined, ps);
    expect(check(r, 5)).toMatchObject({ status: 'Error', detail: "A pillar's weights do not sum to 100%" });
    expect(r.integrityIssues).toEqual(['Factor group B1|1 has no applicable factor (D-10)']);
    expect(r.canFinalise).toBe(false);
  });
});

describe('modifiers (D-13)', () => {
  const b6 = (answers: Record<string, string>) =>
    rate(
      parseRatingInput({
        deal: { moduleCode: 'B6' },
        factors: { 'B6|2': { metric: 0.9 } },
        questions: Object.fromEntries(
          Object.entries(answers).map(([k, a]) => [k, { answer: a, explanation: 'x' }]),
        ),
      }),
      params11,
      noHistory,
    );
  it('a Min modifier caps the score at the grade', () => {
    expect(b6({ 'B6|5': 'Yes' }).factors.find((f) => f.key === 'B6|2')!.calculatedScore).toBe(1.44);
    expect(b6({ 'B6|5': 'Yes' }).questions.find((q) => q.key === 'B6|5')!.status).toBe(
      'Modifier applied (explained)',
    );
  });
  it('two Min modifiers are summed as in the workbook, and the result blocks a Final rating', () => {
    const r = b6({ 'B6|5': 'Yes', 'B6|6': 'Yes' });
    expect(r.factors.find((f) => f.key === 'B6|2')!.calculatedScore).toBe(0.11);
    expect(r.integrityIssues).toEqual([
      'Factor B6|2 (Enrolment strength): modifiers give a score of 0.11, outside 1 to 5 (D-13)',
    ]);
    expect(r.canFinalise).toBe(false);
  });
  it('Set and Add modifiers', () => {
    const b5 = (a: string) =>
      rate(
        parseRatingInput({
          deal: { moduleCode: 'B5', subSector: 'Residential rental' },
          factors: { 'B5|4': { metric: 0.5 } },
          questions: { 'B5|5': { answer: a }, 'B5|6': { answer: a } },
        }),
        params11,
        noHistory,
      );
    expect(b5('Yes').factors.find((f) => f.key === 'B5|4')!.calculatedScore).toBe(4.11);
    expect(b5('Yes').factors.find((f) => f.key === 'B5|5')!.calculatedScore).toBe(2.11);
    expect(b5('No').factors.find((f) => f.key === 'B5|5')!.calculatedScore).toBe(2.56);
  });
});

describe('data checks', () => {
  it('1 required fields', () => {
    expect(
      check(
        run((i) => {
          i.deal.dealId = null;
          i.deal.amount = null;
          i.deal.tenorMonths = null;
        }),
        1,
      ),
    ).toMatchObject({ status: 'Error', detail: '3 required deal field(s) blank' });
  });
  it('2 track and B0', () => {
    expect(
      check(
        run((i) => (i.deal.b0GenerationAsset = 'Yes')),
        2,
      ),
    ).toMatchObject({ status: 'Warning', detail: 'B0 answers suggest Project finance; module is Corporate' });
    const none = run((i) => (i.deal.moduleCode = null));
    expect(check(none, 2)).toMatchObject({ status: 'Error', detail: 'No module chosen' });
    expect(check(none, 5)).toMatchObject({ status: 'Error', detail: 'No module chosen' }); // D-15 detail text
    expect(none.deal.trackCheckText).toBeNull();
    expect(run((i) => (i.deal.b0GenerationAsset = 'Yes')).deal.trackCheckText).toBe(
      'Check: B0 suggests Project finance',
    );
  });
  it('3 overrides with and without reasons', () => {
    expect(
      check(
        run((i) => (i.factors['B1|11'] = { metric: 1.45, score: 4, notApplicable: null, evidence: 'why' })),
        3,
      ).status,
    ).toBe('Warning');
  });
  it('6 IAS 29 statements', () => {
    expect(
      check(
        run((i) => (i.deal.statementsBasis = 'IAS 29 (ZiG, inflation-adjusted)')),
        6,
      ),
    ).toMatchObject({ status: 'Error', detail: 'IAS 29 statements are not scored: restate to USD' });
    expect(
      check(
        run((i) => (i.deal.statementsBasis = null)),
        6,
      ).detail,
    ).toBe('Statements basis not recorded');
  });
  it('7 information quality against accounts type', () => {
    expect(check(run(), 7)).toMatchObject({
      status: 'Warning',
      detail: 'management accounts only, partly reconciled (information quality +1)',
    });
    expect(
      check(
        run((i) => (i.overlays['2'] = { notches: 0, reason: null })),
        7,
      ),
    ).toMatchObject({ status: 'Warning', detail: 'Check: accounts type suggests information quality +1' });
    expect(
      check(
        run((i) => {
          i.deal.accountsType = 'Audited USD accounts or fully reconciled bank records';
          i.overlays['2'] = { notches: 0, reason: null };
        }),
        7,
      ),
    ).toMatchObject({ status: 'Passed', detail: 'Audited or reconciled' });
    expect(
      check(
        run((i) => (i.deal.accountsType = null)),
        7,
      ).status,
    ).toBe('Error');
    expect(
      check(
        run((i) => (i.deal.accountsType = 'Something else')),
        7,
      ).detail,
    ).toBe('Accounts type is not one of the listed types');
  });
  it('8 overlays', () => {
    const r = run((i) => (i.overlays['3'] = { notches: 2, reason: null }));
    expect(r.overlays[2]!.status).toBe('Error: above maximum');
    expect(check(r, 8)).toMatchObject({ status: 'Error', detail: '1 overlay row(s) need attention' });
    expect(run((i) => (i.overlays['4'] = { notches: 1, reason: null })).overlays[3]!.status).toBe(
      'Reason required',
    );
  });
  it('9 shocks', () => {
    const b1 = (s: Record<string, unknown>) => run((i) => (i.shocks = { 'B1|1': s as never }));
    expect(b1({ apply: 'No', valueUsed: null, reason: null }).shocks[0]!.status).toBe(
      'Reason required (not applied)',
    );
    expect(b1({ apply: 'Yes', valueUsed: 0.2, reason: null }).shocks[0]!.status).toBe(
      'Reason required (value changed)',
    );
    expect(check(b1({ apply: 'Yes', valueUsed: 0.2, reason: null }), 9).status).toBe('Error');
  });
  it('10 structure', () => {
    expect(
      check(
        run((i) => (i.structure.name = null)),
        10,
      ),
    ).toMatchObject({ status: 'Error', detail: 'No structure chosen' });
    expect(
      check(
        run((i) => (i.structure.notches = 5)),
        10,
      ),
    ).toMatchObject({ status: 'Error', detail: "Notches entered are outside the structure's range" });
    expect(
      check(
        run((i) => {
          i.structure.notches = 1;
          i.structure.reason = null;
        }),
        10,
      ),
    ).toMatchObject({ status: 'Warning', detail: 'Partial uplift: record the reason' });
    const s2 = run((i) => {
      i.structure = { name: 'Offtake and pre-export finance', notches: 3, reason: null };
      i.deal.offtakerGrade = 'Ungraded international buyer';
    });
    expect(check(s2, 10)).toMatchObject({
      status: 'Warning',
      detail: 'Offtake with no offtaker grade: record the reason',
    });
    expect(run((i) => (i.structure = { name: 'Unknown', notches: 0, reason: null })).structure).toMatchObject(
      { code: null, notchesUsed: 0 },
    );
    expect(
      run((i) => (i.structure = { name: 'Unsecured or subordinated', notches: -2, reason: 'r' })).structure
        .notchingText,
    ).toBe('-2 notches (worse)');
    expect(
      run((i) => (i.structure = { name: 'Unsecured or subordinated', notches: -1, reason: 'r' })).structure
        .notchingText,
    ).toBe('-1 notch (worse)');
    expect(
      run((i) => (i.structure = { name: 'Corporate (general security)', notches: 1, reason: 'r' })).structure
        .notchingText,
    ).toBe('+1 notch (better)');
  });
  it('11 collateral', () => {
    const col = (c: RatingInput['collateral']) => run((i) => (i.collateral = c));
    const line = {
      type: 'Breeding livestock',
      value: 100000,
      haircut: null,
      crossBorderNoTracking: null,
      note: null,
    };
    expect(check(col([{ ...line, type: 'Gold bars' }]), 11)).toMatchObject({
      status: 'Error',
      detail: '1 collateral row(s) need attention',
    });
    expect(col([{ ...line, type: 'Gold bars' }]).collateral.lines[0]!.status).toBe(
      "Error: not in this module's list",
    );
    expect(col([{ ...line, value: null }]).collateral.lines[0]!.status).toBe('Value required');
    expect(col([{ ...line, haircut: 0.2 }]).collateral.lines[0]!.status).toBe('Out of range');
    expect(
      col([{ ...line, type: 'Tractors and irrigation equipment (notarial bond)', haircut: 0.5 }]).collateral
        .lines[0]!.status,
    ).toBe('Note required');
    expect(col([{ ...line, type: null }]).collateral).toMatchObject({
      count: 0,
      lines: [{ status: null, recoverable: 0 }],
    });
    const none = col([]);
    expect(check(none, 11)).toMatchObject({ status: 'Warning', detail: 'No collateral recorded: LGD 75%' });
    expect(none.collateral).toMatchObject({ lgd: 0.75, lgdBasis: 'Unsecured: no recoverable collateral' });
    expect(check(col([{ ...line, value: 600000 }]), 11)).toMatchObject({
      status: 'Passed',
      detail: '1 item(s), recoverable US$ 240,000',
    });
    expect(col([{ ...line, value: 600000 }]).collateral).toMatchObject({
      lgdBasis: 'Recoverable value against exposure',
    });
    expect(
      col([{ ...line, type: 'Cash cover held by Crowdaxe Capital', value: 600000 }]).collateral.lgdBasis,
    ).toBe('Floor for secured facilities (10%)');
    // an unsecured structure with no collateral is not flagged for missing collateral, only for cover
    expect(
      check(
        run((i) => {
          i.collateral = [];
          i.structure = { name: 'Unsecured or subordinated', notches: -1, reason: null };
        }),
        11,
      ),
    ).toMatchObject({ status: 'Warning', detail: 'No collateral recorded: LGD 75%' });
    expect(
      check(
        run((i) => {
          i.collateral = [];
          i.deal.amount = null;
          i.deal.eadInput = 1;
          i.structure = { name: 'Unsecured or subordinated', notches: -1, reason: null };
        }),
        11,
      ).status,
    ).toBe('Passed');
  });
  it('LGD cap at unsecured (PROPOSED item 22) and no EAD', () => {
    const tiny = (ps: ParameterSet) =>
      run(
        (i) =>
          (i.collateral = [
            {
              type: 'Breeding livestock',
              value: 1000,
              haircut: null,
              crossBorderNoTracking: null,
              note: null,
            },
          ]),
        ps,
      );
    expect(tiny(params11).collateral).toMatchObject({
      lgd: 0.75,
      lgdBasis: 'Capped at the unsecured LGD (75%)',
    });
    expect(tiny(withParams({ LGD_CapAtUnsecured: 'No' })).collateral.lgd).toBeCloseTo(0.9992, 12);
    const noEad = run((i) => {
      i.deal.amount = null;
      i.deal.eadInput = null;
    });
    expect(noEad.collateral).toMatchObject({ lgd: null, lgdBasis: null, coverText: null });
    expect(noEad.elPct).toBeNull();
    expect(noEad.elUsd).toBeNull();
  });
  it('12 questions and the character review', () => {
    const b1q = run((i) => (i.questions = { 'B1|1': { answer: 'Yes', explanation: null } }));
    expect(b1q.questions[0]!.status).toBe('Explanation required');
    expect(check(b1q, 12).status).toBe('Error');
    const flagged = run((i) => (i.questions = { 'B1|1': { answer: 'Yes', explanation: 'Contract signed' } }));
    expect(flagged.questions[0]!.status).toBe('Flagged (explained)');
  });
  it('13 pricing', () => {
    const ps = withParams({ Price_CostOfFunds: 0.08, Price_OperatingCost: 0.03, Price_TargetMargin: 0.04 });
    const r = run(undefined, ps);
    expect(r.minYield).toBeCloseTo(0.1535, 12);
    expect(check(r, 13)).toMatchObject({ status: 'Passed', detail: 'Minimum yield 15.35%' });
    expect(r.pricingStatus).toBe('OK');
    expect(run((i) => (i.proposedAllInYield = 0.12), ps).pricingStatus).toBe(
      'Warning: below minimum yield, IC approval needed',
    );
    expect(run((i) => (i.proposedAllInYield = 0.2), ps).pricingStatus).toBe('OK');
    expect(run((i) => (i.factors['CORE|3']!.score = null), ps).minYield).toBeNull();
    expect(run().pricingStatus).toBe('Warning: pricing inputs not set');
  });
});

describe('Deal History', () => {
  const h = (rows: { status: string; maturityDate?: string | null; regNo?: string }[]) =>
    parseHistorySnapshot({
      rows: rows.map((r) => ({
        regNo: r.regNo ?? 'SELFTEST-REG',
        status: r.status,
        maturityDate: r.maturityDate ?? null,
      })),
    });
  it('penalty, credits and the character flag', () => {
    const late = run(
      undefined,
      params11,
      h([{ status: 'Repaid late, 31-90' }, { status: 'Repaid on time' }]),
    );
    expect(late.history).toMatchObject({
      adjustment: 0.5,
      summary: '1 repaid on time; 1 repaid late (31-90 DPD)',
    });
    const two = run(undefined, params11, h([{ status: 'Repaid on time' }, { status: 'Live, current' }]));
    expect(two.history.adjustment).toBe(-0.25);
    const restr = run(
      (i) => (i.factors['CORE|2']!.score = 3),
      params11,
      h([{ status: 'Restructured' }, { status: 'Repaid late, max DPD 1-30' }, { status: 'Defaulted' }]),
    );
    expect(restr.history).toMatchObject({
      adjustment: 0,
      characterFlag: 'Character should be 2 or lower (current 3)',
      characterStatus: 'Justification required',
    });
    expect(check(restr, 12).status).toBe('Error');
    const explained = run(
      (i) => {
        i.factors['CORE|2']!.score = 3;
        i.characterJustification = 'New management';
      },
      params11,
      h([{ status: 'Defaulted' }]),
    );
    expect(explained.history.characterStatus).toBe('Character above suggestion (explained)');
    expect(check(explained, 12).status).toBe('Warning');
    expect(run(undefined, params11, h([{ status: 'Defaulted' }])).history.characterFlag).toBe(
      'Character should be 2 or lower (current 3)',
    );
    expect(
      run((i) => (i.factors['CORE|2']!.score = 2), params11, h([{ status: 'Defaulted' }])).history,
    ).toMatchObject({ characterFlag: 'Character should be 2 or lower', characterStatus: 'OK' });
  });
  it('lookback excludes old facilities, keeps undated ones', () => {
    const ps = withParams({ Hist_LookbackYears: 1 });
    const r = run(
      undefined,
      ps,
      h([
        { status: 'Repaid on time', maturityDate: '2025-01-01' },
        { status: 'Repaid on time', maturityDate: null },
        { status: 'Repaid on time', maturityDate: '2026-06-01' },
      ]),
    );
    expect(r.history.counts[0]).toBe(2);
    expect(
      run(
        (i) => (i.deal.ratingDate = null),
        ps,
        h([{ status: 'Repaid on time', maturityDate: '2025-01-01' }]),
      ).history.counts[0],
    ).toBe(1);
  });
  it('matches registration numbers ignoring case and spaces (D-34); no number, no history', () => {
    expect(
      run(undefined, params11, h([{ status: 'Repaid on time', regNo: 'selftest - reg' }])).history.counts[0],
    ).toBe(1);
    expect(
      run(undefined, params11, h([{ status: 'Repaid on time', regNo: 'SELFTEST-REG2' }])).history.counts[0],
    ).toBe(0);
    expect(
      run(undefined, params11, h([{ status: 'Repaid on time', regNo: ' Selftest-Reg' }])).history.counts[0],
    ).toBe(1);
    expect(regNoKey('3187 / 2011')).toBe('3187/2011');
    expect(regNoKey(null)).toBe('');
    expect(run((i) => (i.deal.regNo = null)).history).toMatchObject({
      summary: 'No registration number',
      regNo: '',
    });
  });
});

describe('overrides', () => {
  it('obligor override flows into the facility grade', () => {
    const r = run(
      (i) =>
        (i.override = {
          obligorGrade: 6,
          facilityGrade: null,
          reason: 'Strong sponsor',
          approverName: null,
          approvalDate: null,
        }),
    );
    expect(r.obligor).toMatchObject({
      model: 7,
      final: 6,
      overrideStatus: 'Override applied: -1 (grade number)',
    });
    expect(r.facility.model).toBe(4);
    expect(r.override).toEqual({ applied: true, blocked: false });
  });
  it('same grade is no override; blocked overrides block a Final rating', () => {
    expect(run((i) => (i.override.facilityGrade = 5)).facility.overrideStatus).toBe('No override');
    const b = run((i) => (i.override.facilityGrade = 6));
    expect(b.facility).toMatchObject({ final: 5, overrideStatus: 'Blocked: written reason required' });
    expect(b.override.blocked).toBe(true);
    expect(b.canFinalise).toBe(false);
  });
});

describe('project finance', () => {
  it('construction cap, guarantor and bond (C3)', () => {
    expect(run(undefined, params11, noHistory, T09A).facility).toMatchObject({
      afterConstructionCap: 5,
      final: 5,
    });
    expect(run((i) => (i.deal.completionGuarantorGrade = 4), params11, noHistory, T09A).facility.final).toBe(
      3,
    );
    expect(run((i) => (i.deal.completionGuarantorGrade = 5), params11, noHistory, T09A).facility.final).toBe(
      5,
    );
    expect(run((i) => (i.deal.completionCertified = 'yes'), params11, noHistory, T09A).facility.final).toBe(
      3,
    );
  });
  it('shocks are not costed off the Corporate track; Pillar 2 does not apply', () => {
    const r = run(
      (i) => (i.shocks = { 'PF-RE|1': { apply: 'Yes', valueUsed: null, reason: null } }),
      params11,
      noHistory,
      T09A,
    );
    expect(r.shocks[0]!.cost).toBe(0);
    expect(r.pillars['P2']!.score).toBeNull();
    expect(r.knockouts.KO2).toBe('Clear');
  });
  it('PF-REN offtaker: graded corporate takes grade + 1', () => {
    const ren = (grade: number | string | null) =>
      rate(
        parseRatingInput({
          deal: {
            moduleCode: 'PF-REN',
            offtakerType: "Graded corporate (1-4), USD PPA (offtaker's grade + 1)",
            offtakerGrade: grade,
          },
        }),
        params11,
        noHistory,
      ).factors.find((f) => f.key === 'B7P|16')!;
    expect(ren(3)).toMatchObject({ calculatedScore: 3.67, bandText: '3.67 to 3.67' });
    expect(ren(10).calculatedScore).toBe(1);
    expect(ren('Ungraded international buyer').calculatedScore).toBeNull();
  });
  it('B3 anchor-graded payables take the anchor grade', () => {
    const b3 = (grade: number | null) =>
      rate(
        parseRatingInput({
          deal: {
            moduleCode: 'B3',
            subSector: "Payables finance anchored on a buyer graded 1-4 (anchor's grade applies)",
            offtakerGrade: grade,
          },
        }),
        params11,
        noHistory,
      ).factors.find((f) => f.key === 'B3|4')!;
    expect(b3(2).calculatedScore).toBe(4.56);
    expect(b3(null).status).toBe('Score required');
  });
});

describe('B5 stressed LTV cap', () => {
  it('caps Pillar 2 when stressed LTV is above the trigger', () => {
    const b5 = (ltv: number) =>
      rate(
        parseRatingInput({
          deal: { moduleCode: 'B5', stressedLtv: ltv },
          factors: { 'B5|10': { metric: 2 }, 'B5|11': { metric: 2 }, 'CORE|1': { metric: 1 } },
        }),
        params11,
        noHistory,
      );
    expect(b5(0.9).pillars['P2']!.score).toBe(1.89);
    expect(b5(0.9).pillar2RuleNote).toBe('Stressed LTV above 85% caps Pillar 2 at 1.89');
    expect(b5(0.85).pillars['P2']!.score).toBe(5);
  });
});

describe('workbook cell mapping', () => {
  it('warns about cells it cannot place, and accepts serial dates', () => {
    const { input, warnings } = inputFromWorkbookCells(
      {
        'Scorecard!C10': 'S:B1',
        'Scorecard!C16': 'S:lots',
        'Scorecard!C20': 46042,
        'Scorecard!C160': 'next week',
        'Scorecard!G67': 5,
        'Scorecard!G82': 'Yes',
        'Scorecard!G93': 'Yes',
        'Scorecard!C26': 4,
        'Scorecard!C19': 'E:',
        'Scorecard!J39': 'B:True',
      },
      params11,
    );
    expect(input.deal).toMatchObject({
      moduleCode: 'B1',
      amount: null,
      ratingDate: '2026-01-20',
      offtakerGrade: 4,
      tenorMonths: null,
    });
    expect(warnings).toEqual([
      'Scorecard!C16: expected a number, found "lots" (ignored)',
      'Scorecard!J39: expected a number, found "true" (ignored)',
      'Scorecard row 67: factor inputs found but the module has no factor on this row (ignored)',
      'Scorecard row 82: question answer found but the module has no question on this row (ignored)',
      'Scorecard row 93: shock input found but the module has no shock on this row (ignored)',
      'Scorecard!C160: expected a date, found "next week" (ignored)',
    ]);
  });
  it('rejects malformed inputs', () => {
    expect(() => parseRatingInput({ deal: { amount: 'lots' } })).toThrow();
    expect(() => parseRatingInput({ deal: { ratingDate: '12/01/2026' } })).toThrow();
  });
});
