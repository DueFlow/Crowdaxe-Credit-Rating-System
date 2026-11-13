/** Shared test helpers: load fixtures, run the engine from workbook cells, compare with the workbook. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CellValue,
  type HistorySnapshot,
  ParameterSet,
  type ParameterSetDoc,
  type RatingResult,
  decodeWorkbookValue,
  inputFromWorkbookCells,
  parseHistorySnapshot,
  rate,
  resultToWorkbookCells,
} from '../src/index.js';

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'),
  ) as T;
}

export const paramsDoc = (): ParameterSetDoc => fixture<ParameterSetDoc>('parameter-set-1.1.json');
export const params11 = ParameterSet.parse(paramsDoc());

/** A copy of the parameter set with some scalar values replaced. */
export function withParams(overrides: Record<string, number | string | null>): ParameterSet {
  if (Object.keys(overrides).length === 0) return params11;
  const doc = paramsDoc();
  for (const [name, value] of Object.entries(overrides)) {
    const s = doc.scalars.find((x) => x.name === name);
    if (!s) throw new Error(`Unknown parameter ${name}`);
    s.value = value;
  }
  return ParameterSet.parse(doc);
}

export interface CellRun {
  result: RatingResult;
  cells: Record<string, CellValue>;
  warnings: string[];
}

export function runFromCells(
  cells: Record<string, CellValue>,
  ps: ParameterSet = params11,
  history: Partial<HistorySnapshot> = {},
): CellRun {
  const { input, warnings } = inputFromWorkbookCells(cells, ps);
  const result = rate(input, ps, parseHistorySnapshot(history));
  return { result, cells: resultToWorkbookCells(result), warnings };
}

/** Compare a workbook value with the engine's (numbers within a tolerance, text exactly, blank = null). */
export function sameValue(expected: CellValue, actual: CellValue, tol = 1e-6): boolean {
  const norm = (x: CellValue) => (x === '' || x === undefined ? null : x);
  const e = norm(expected);
  const a = norm(actual);
  if (typeof e === 'number' && typeof a === 'number') return Math.abs(e - a) <= tol;
  return e === a;
}

export { decodeWorkbookValue };
