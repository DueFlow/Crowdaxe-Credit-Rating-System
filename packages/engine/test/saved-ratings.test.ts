/**
 * Parity with the 7 ratings saved in the workbook: each is re-run from its RatingInputs with Deal History
 * and the Blacklist rebuilt from Deal Activity as at its rating date (discrepancy D-01), and must reproduce
 * the saved Ratings row exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  type ActivityEvent,
  activityEventSchema,
  type CellValue,
  deriveBlacklist,
  deriveDealHistory,
} from '../src/index.js';
import { fixture, runFromCells } from './helpers.js';

interface Saved {
  ratingsRow: Record<string, CellValue>;
  inputs: Record<string, string>;
}
const { ratings } = fixture<{ ratings: Saved[] }>('saved-ratings.json');
const events: ActivityEvent[] = fixture<{ events: unknown[] }>('deal-activity.json').events.map((e) =>
  activityEventSchema.parse(e),
);

export function historyAsAt(asOf: string) {
  return {
    asOf,
    rows: deriveDealHistory(events, asOf).map((h) => ({
      regNo: h.regNo,
      dealId: h.dealId,
      status: h.status,
      maturityDate: h.maturityDate,
    })),
    blacklist: deriveBlacklist(events, asOf).map((b) => ({ regNo: b.regNo, status: b.status })),
  };
}

const COMPARE: [string, (r: ReturnType<typeof runFromCells>['result']) => CellValue][] = [
  ['Blended score', (r) => r.blendedScore],
  ['Obligor model', (r) => r.obligor.model],
  ['Obligor final', (r) => r.obligor.final],
  ['Facility model', (r) => r.facility.model],
  ['Facility final', (r) => r.facility.final],
  ['PD', (r) => r.pd],
  ['LGD', (r) => r.collateral.lgd],
  ['EAD USD', (r) => r.deal.ead],
  ['EL USD', (r) => r.elUsd],
  ['Recommendation', (r) => r.recommendation],
  ['Overridden', (r) => (r.override.applied ? 'Yes' : 'No')],
  ['Track', (r) => r.deal.track],
];

describe('Saved ratings reproduce exactly (history as at the rating date)', () => {
  it('has the 7 saved ratings', () => expect(ratings).toHaveLength(7));
  for (const s of ratings) {
    const id = String(s.ratingsRow['Rating ID']);
    it(`${id} ${s.ratingsRow['Deal ID']} ${s.ratingsRow['Rating type']}`, () => {
      const run = runFromCells(s.inputs, undefined, historyAsAt(String(s.ratingsRow['Rating date'])));
      expect(run.warnings).toEqual([]);
      for (const [col, get] of COMPARE) {
        const saved = s.ratingsRow[col];
        const now = get(run.result);
        if (typeof saved === 'number') expect(now, `${id} ${col}`).toBeCloseTo(saved, 9);
        else expect(now, `${id} ${col}`).toBe(saved);
      }
      expect(run.result.canFinalise, `${id} was saved as Final`).toBe(true);
    });
  }
});

describe('Without the history snapshot the saved ratings drift (why D-01 matters)', () => {
  it('3 of 7 change when run with the history as it stands today', () => {
    const today = historyAsAt('2026-11-13');
    const changed = ratings.filter((s) => {
      const r = runFromCells(s.inputs, undefined, today).result;
      return (
        r.facility.final !== s.ratingsRow['Facility final'] ||
        r.obligor.final !== s.ratingsRow['Obligor final'] ||
        r.recommendation !== s.ratingsRow['Recommendation']
      );
    });
    expect(changed.map((s) => s.ratingsRow['Rating ID'])).toEqual([
      'R-20260112-101422',
      'R-20260203-140251',
      'R-20260216-114007',
    ]);
  });
});
