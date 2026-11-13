/**
 * The workbook's own self-test suite (hidden TestCases sheet, modSelfTest): 29 cases, 102 checks.
 * Each case follows the VBA semantics: "Use" inherits another case's inputs (later rows override),
 * "Param" changes a parameter for the case, "History" adds a temporary Deal History row.
 */
import { describe, expect, it } from 'vitest';
import type { CellValue, HistoryRow } from '../src/index.js';
import { decodeWorkbookValue, fixture, runFromCells, sameValue, withParams } from './helpers.js';

interface Row {
  case: string;
  kind: string;
  key: string | null;
  value: string | null;
  tolerance: number | null;
}
const { rows } = fixture<{ rows: Row[] }>('testcases.json');
const caseIds = [...new Set(rows.map((r) => r.case))];

function collectInputs(id: string, acc: Record<string, CellValue>, depth = 0): Record<string, CellValue> {
  if (depth > 5) throw new Error(`Test case ${id}: "Use" links loop`);
  for (const r of rows)
    if (r.case === id && r.kind === 'Use')
      collectInputs(String(decodeWorkbookValue(r.value!)), acc, depth + 1);
  for (const r of rows) if (r.case === id && r.kind === 'Input') acc[r.key!] = decodeWorkbookValue(r.value!);
  return acc;
}

function historyRow(encoded: string): HistoryRow {
  const p = String(decodeWorkbookValue(encoded))
    .split('~')
    .map((x) => decodeWorkbookValue(x));
  return {
    regNo: String(p[0]),
    dealId: (p[2] as string) ?? null,
    status: String(p[7]),
    maturityDate: (p[6] as string) ?? null,
  };
}

let total = 0;
describe('Workbook TestCases (modSelfTest)', () => {
  for (const id of caseIds) {
    const title = rows.find((r) => r.case === id && r.kind === 'Title');
    const expects = rows.filter((r) => r.case === id && r.kind === 'Expect');
    total += expects.length;
    it(`${id} ${title ? decodeWorkbookValue(title.value!) : ''}`, () => {
      const params: Record<string, number | string | null> = {};
      for (const r of rows)
        if (r.case === id && r.kind === 'Param')
          params[r.key!] = decodeWorkbookValue(r.value!) as number | string | null;
      const historyRows = rows
        .filter((r) => r.case === id && r.kind === 'History')
        .map((r) => historyRow(r.value!));
      const run = runFromCells(collectInputs(id, {}), withParams(params), { rows: historyRows });
      expect(run.warnings).toEqual([]);
      for (const e of expects) {
        const expected = decodeWorkbookValue(e.value!);
        const actual = run.cells[e.key!];
        expect(actual, `${e.key} not mapped`).not.toBeUndefined();
        expect(
          sameValue(expected, actual ?? null, e.tolerance ?? 1e-6),
          `${id} ${e.key}: expected ${expected}, got ${actual}`,
        ).toBe(true);
      }
    });
  }
  it('covers all 102 checks of the workbook suite', () => {
    expect(caseIds).toHaveLength(29);
    expect(total).toBe(102);
  });
});
