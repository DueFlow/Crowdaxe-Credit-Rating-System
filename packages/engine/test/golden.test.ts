/**
 * Golden parity: random and boundary-value ratings for every module, recalculated by LibreOffice from the
 * original workbook (tools/oracle/generate_golden.py). Every mapped output cell must match.
 * LibreOffice itself passes all 102 workbook self-test checks and reproduces the saved ratings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CellValue } from '../src/index.js';
import { runFromCells, withParams } from './helpers.js';

interface GoldenCase {
  id: string;
  module: string;
  boundary: string | null;
  inputs: Record<string, CellValue>;
  params: Record<string, number | string>;
  history: { regNo: string; dealId: string; status: string; maturityDate: string | null }[];
  blacklist: { regNo: string; status: 'Active' | 'Lifted' }[];
  outputs: Record<string, CellValue>;
}
const file = process.env['GOLDEN_FILE'] ?? 'golden.json.gz';
const path = fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));
const golden: { outputCells: string[]; cases: GoldenCase[] } | null = existsSync(path)
  ? JSON.parse((file.endsWith('.gz') ? gunzipSync(readFileSync(path)) : readFileSync(path)).toString('utf8'))
  : null;

const close = (e: number, a: number) => Math.abs(e - a) <= 1e-9 * Math.max(1, Math.abs(e));

/**
 * The one known difference between the oracle and Excel: LibreOffice's TEXT() rounds a value such as
 * 1630309.4999999998 from the full binary value (1,630,309), Excel from 15 significant digits (1,630,310),
 * and the engine follows Excel (excel.ts). Such texts are accepted only when they are otherwise identical
 * and every differing number is off by exactly one in its last digit; each one is listed in the report.
 */
function lastDigitFormattingOnly(e: string, a: string): boolean {
  const num = /\d[\d,]*(?:\.\d+)?/g;
  if (e.replace(num, '#') !== a.replace(num, '#')) return false;
  const en = e.match(num) ?? [];
  const an = a.match(num) ?? [];
  let differing = 0;
  for (let i = 0; i < en.length; i++) {
    if (en[i] === an[i]) continue;
    const places = (en[i]!.split('.')[1] ?? '').length;
    if ((an[i]!.split('.')[1] ?? '').length !== places) return false;
    const unit = 10 ** -places;
    const diff = Math.abs(Number(en[i]!.replace(/,/g, '')) - Number(an[i]!.replace(/,/g, '')));
    if (Math.abs(diff - unit) > unit / 1000) return false;
    differing++;
  }
  return differing > 0;
}
export const formattingDifferences: string[] = [];

describe.runIf(golden)(`Golden parity with the workbook (${file})`, () => {
  const cases = golden!.cases;
  it('covers every module with random and boundary cases', () => {
    expect(new Set(cases.map((c) => c.module)).size).toBe(12);
    expect(cases.some((c) => c.boundary)).toBe(true);
  });
  for (const c of cases) {
    it(`${c.id} ${c.module}${c.boundary ? ` (${c.boundary})` : ''}`, () => {
      const run = runFromCells(c.inputs, withParams(c.params), { rows: c.history, blacklist: c.blacklist });
      expect(run.warnings).toEqual([]);
      const diffs: string[] = [];
      for (const k of golden!.outputCells) {
        const e = c.outputs[k] ?? null;
        const a = run.cells[k] ?? null;
        const ok = typeof e === 'number' && typeof a === 'number' ? close(e, a) : e === (a === '' ? null : a);
        if (ok) continue;
        if (typeof e === 'string' && typeof a === 'string' && lastDigitFormattingOnly(e, a)) {
          formattingDifferences.push(`${c.id} ${k}: LibreOffice "${e}", engine (Excel rule) "${a}"`);
          continue;
        }
        diffs.push(`${k}: workbook ${JSON.stringify(e)}, engine ${JSON.stringify(a)}`);
      }
      expect(diffs).toEqual([]);
    });
  }
  it('has only rare last-digit formatting differences (LibreOffice vs Excel rounding of x.5)', () => {
    if (formattingDifferences.length)
      console.info(`Formatting-only differences:\n${formattingDifferences.join('\n')}`);
    expect(formattingDifferences.length).toBeLessThanOrEqual(Math.ceil(cases.length / 100));
  });
});
