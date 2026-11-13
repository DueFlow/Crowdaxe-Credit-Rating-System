/**
 * The TypeScript workbook reader must produce exactly what the Phase 1 extractor produced (the engine's
 * fixtures), and the committed extract. Needs the workbook: set CRS_WORKBOOK (it is not in the repository).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkbookExtract } from '@crowdaxe/db';
import { readWorkbook } from '../src/readWorkbook.js';

const wbPath = process.env['CRS_WORKBOOK'];
const engineFixture = (n: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../packages/engine/fixtures/${n}`, import.meta.url)), 'utf8'),
  );

describe.runIf(wbPath)('readWorkbook (Crowdaxe_CRS.xlsm)', () => {
  let x: WorkbookExtract | null = null;
  beforeAll(async () => {
    x = await readWorkbook(wbPath!);
  }, 60_000);
  it('reads parameter set 1.1 identical to the engine fixture', () => {
    expect(x!.parameterSet).toEqual(engineFixture('parameter-set-1.1.json'));
  });
  it('reads the saved ratings and their inputs', () => {
    expect(x!.ratings).toEqual(engineFixture('saved-ratings.json').ratings);
  });
  it('reads Deal Activity, Deal History and the Blacklist', () => {
    expect(x!.activity).toEqual(engineFixture('deal-activity.json').events);
    const dh = engineFixture('deal-history.json');
    expect(x!.dealHistory).toEqual(dh.dealHistory);
    expect(x!.blacklist).toEqual(dh.blacklist);
  });
  it('reads the Pipeline Register, Override Log and Changelog', () => {
    expect(x!.pipeline).toHaveLength(6);
    expect(x!.pipeline[5]).toMatchObject({ dealId: 'CX-2026-006', stage: 'Pipeline Deals', amount: 100000 });
    expect(x!.overrideLog).toEqual([
      expect.objectContaining({
        ratingId: 'R-20260810-093145',
        grade: 'Facility',
        modelGrade: 3,
        finalGrade: 4,
        notches: 1,
        date: '2026-08-10',
      }),
    ]);
    expect(x!.changelog).toHaveLength(1);
    expect(x!.source).toMatchObject({
      file: expect.stringMatching(/\.xlsm$/),
      workbookVersion: '1.1',
      methodVersion: '1.1',
    });
  });
});
