/** Parameter set validation: what Admin must not be able to activate. */
import { describe, expect, it } from 'vitest';
import { ParameterSet } from '../src/index.js';
import { paramsDoc, params11 } from './helpers.js';

const issuesAfter = (edit: (d: ReturnType<typeof paramsDoc>) => void) => {
  const d = paramsDoc();
  edit(d);
  return ParameterSet.validate(d);
};

describe('Parameter set 1.1', () => {
  it('is valid and complete', () => {
    expect(ParameterSet.validate(paramsDoc())).toEqual([]);
    expect(params11.doc.modules).toHaveLength(12);
    expect(params11.doc.factors).toHaveLength(132);
    expect(params11.doc.subSectors).toHaveLength(44);
    expect(params11.doc.haircuts).toHaveLength(112);
    expect(params11.doc.questions).toHaveLength(57);
    expect(params11.doc.shocks).toHaveLength(65);
    expect(params11.gradeMax).toBe(10);
    expect(params11.module('B1')?.name).toBe('Agriculture and agro-processing');
    expect(params11.module(null)).toBeUndefined();
    expect(params11.list('nope')).toEqual([]);
    expect(params11.switchText('Hist_Enabled')).toBe('Yes');
  });

  it('flags the PROPOSED rules that are live (D-05)', () => {
    const proposed = params11.doc.scalars.filter((s) => s.proposed).map((s) => s.name);
    expect(proposed).toEqual(
      expect.arrayContaining(['Hist_Enabled', 'LGD_CapAtUnsecured', 'Ovr_YearStartMonth']),
    );
    expect(params11.doc.structures.find((s) => s.code === 'S6')?.proposed).toBe(true);
    expect(params11.doc.questions.find((q) => q.key === 'B6|6')?.proposed).toBe(true);
  });

  it.each([
    [
      'pillar weights',
      (d: ReturnType<typeof paramsDoc>) => (d.scalars.find((s) => s.name === 'Wt_P1')!.value = 0.5),
      'Pillar weights Wt_P1 to Wt_P3 must sum to 100%',
    ],
    [
      'PF weights',
      (d: ReturnType<typeof paramsDoc>) => (d.scalars.find((s) => s.name === 'Wt_PF5')!.value = 0.2),
      'Pillar weights Wt_PF1 to Wt_PF5 must sum to 100%',
    ],
    [
      'missing number',
      (d: ReturnType<typeof paramsDoc>) => (d.scalars.find((s) => s.name === 'Grade_Factor')!.value = null),
      'Parameter Grade_Factor must be a number',
    ],
    [
      'optional number',
      (d: ReturnType<typeof paramsDoc>) =>
        (d.scalars.find((s) => s.name === 'Price_CostOfFunds')!.value = 'x'),
      'Parameter Price_CostOfFunds must be a number or blank',
    ],
    [
      'text',
      (d: ReturnType<typeof paramsDoc>) => (d.scalars.find((s) => s.name === 'Txt_Decline')!.value = 3),
      'Parameter Txt_Decline must be text',
    ],
    [
      'switch',
      (d: ReturnType<typeof paramsDoc>) =>
        (d.scalars.find((s) => s.name === 'Hist_Enabled')!.value = 'Maybe'),
      'Parameter Hist_Enabled must be Yes or No',
    ],
    [
      'duplicate name',
      (d: ReturnType<typeof paramsDoc>) => d.scalars.push({ ...d.scalars[0]! }),
      'Parameter names must be unique',
    ],
    [
      'grade order',
      (d: ReturnType<typeof paramsDoc>) => (d.ratingScale[2]!.grade = 4),
      'Rating scale grades must run 1, 2, 3 … in order (row 3)',
    ],
    [
      'boundaries',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[0]!.bounds = [20, 20, 5, 2]),
      'Factor B1|1: boundaries must be strictly decreasing (D-12)',
    ],
    [
      'L boundaries',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[6]!.bounds = [2.5, 1.5, 3.5, 5]),
      'Factor B1|7: boundaries must be strictly increasing (D-12)',
    ],
    [
      'NB',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[0]!.bounds = [20, 10, 5]),
      'Factor B1|1: number of boundaries and f-flags must equal NB',
    ],
    [
      'direction',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[0]!.dir = null),
      'Numeric factor B1|1 needs a direction (H or L)',
    ],
    [
      'NB zero',
      (d: ReturnType<typeof paramsDoc>) => {
        d.factors[0]!.nb = 0;
        d.factors[0]!.bounds = [];
        d.factors[0]!.fFlags = [];
      },
      'Numeric factor B1|1 needs 2 or 4 band boundaries',
    ],
    [
      'key',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[0]!.key = 'B1|9'),
      'Factor key B1|9 must be "B1|1"',
    ],
    [
      'duplicate factor',
      (d: ReturnType<typeof paramsDoc>) => d.factors.push({ ...d.factors[0]! }),
      'Duplicate factor key B1|1',
    ],
    [
      'optional without group',
      (d: ReturnType<typeof paramsDoc>) => (d.factors[0]!.optional = true),
      'Optional factor B1|1 must belong to a weight-sharing group (D-10)',
    ],
    [
      'all-optional group',
      (d: ReturnType<typeof paramsDoc>) => (d.factors.find((f) => f.key === 'B7C|6')!.optional = true),
      'Group B7C|P1|WCE needs at least one non-optional factor (D-10)',
    ],
    [
      'ord gap',
      (d: ReturnType<typeof paramsDoc>) => {
        const f = d.factors.find((x) => x.key === 'B1|12')!;
        f.ord = 13;
        f.key = 'B1|13';
      },
      'Factor set B1: order numbers must run 1, 2, 3 … without gaps',
    ],
    [
      'factor set',
      (d: ReturnType<typeof paramsDoc>) => (d.modules[0]!.factorSet = 'ZZ'),
      'Module B1: factor set ZZ not found',
    ],
    [
      'haircut set',
      (d: ReturnType<typeof paramsDoc>) => (d.modules[0]!.haircutSet = 'ZZ'),
      'Module B1: haircut set ZZ not found',
    ],
    [
      'question key',
      (d: ReturnType<typeof paramsDoc>) => (d.questions[0]!.key = 'B1|7'),
      'Question key B1|7 must be "B1|1"',
    ],
    [
      'question target',
      (d: ReturnType<typeof paramsDoc>) => (d.questions.find((q) => q.key === 'B2|5')!.target = 'B2|99'),
      'Question B2|5: target factor B2|99 not found',
    ],
    [
      'target without modifier',
      (d: ReturnType<typeof paramsDoc>) => (d.questions.find((q) => q.key === 'B2|5')!.modifierType = null),
      'Question B2|5: target and modifier go together',
    ],
    [
      'shock key',
      (d: ReturnType<typeof paramsDoc>) => (d.shocks[0]!.key = 'B1|9'),
      'Shock key B1|9 must be "B1|1"',
    ],
    [
      'pillar weights in a module',
      (d: ReturnType<typeof paramsDoc>) => (d.factors.find((f) => f.key === 'B1|1')!.weight = 0.2),
      'Module B1: factor weights in pillar P1 sum to 110%, not 100%',
    ],
    [
      'structure',
      (d: ReturnType<typeof paramsDoc>) => (d.structures[0]!.minNotch = 5),
      'Structure S1: min notch above max notch',
    ],
    [
      'history list',
      (d: ReturnType<typeof paramsDoc>) => d.lists['lst_HistStatus']!.pop(),
      'lst_HistStatus must have the 7 Deal History statuses',
    ],
    [
      'accounts list',
      (d: ReturnType<typeof paramsDoc>) => delete d.lists['lst_Accounts'],
      'List lst_Accounts is required',
    ],
    [
      'overlay ord',
      (d: ReturnType<typeof paramsDoc>) =>
        (d.scalars.find((s) => s.name === 'Overlay_InfoQuality_Ord')!.value = 9),
      'Overlay_InfoQuality_Ord must be the order number of an overlay',
    ],
  ])('rejects bad %s', (_n, edit, message) => {
    expect(issuesAfter(edit)).toContain(message);
  });

  it('reports schema errors with their path, and parse() throws', () => {
    const d = paramsDoc() as unknown as { factors: { weight: unknown }[] };
    d.factors[0]!.weight = 'heavy';
    expect(ParameterSet.validate(d)[0]).toMatch(/^factors\.0\.weight: /);
    expect(() => ParameterSet.parse(d)).toThrow();
  });
});
