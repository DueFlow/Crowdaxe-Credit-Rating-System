/** Excel-compatible helpers: ROUND, INT, EDATE, serial dates and TEXT() formats. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clamp,
  daysBetween,
  edate,
  excelGeneral,
  excelInt,
  excelRound,
  fmtDateDdMmmYyyy,
  fmtFixed,
  fmtPercent,
  fmtPercentOneTwo,
  fmtSigned0,
  fmtSigned2,
  fmtThousands,
  isIsoDate,
  isoToSerial,
  parseIsoDate,
  serialToIso,
} from '../src/index.js';

describe('excelRound (Excel ROUND: half away from zero on 15 significant digits)', () => {
  it.each([
    [2.675, 2, 2.68], // 2.67499999999999982236431605997495353221893310546875 in binary
    [1.005, 2, 1.01],
    [-1.005, 2, -1.01],
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [4.609999999999999, 2, 4.61],
    [2.995000000000001, 2, 3],
    [2.994999999999999, 2, 3], // 15 significant digits: 2.99500000000000
    [2.99499999999, 2, 2.99],
    [0, 2, 0],
    [1234.5678, -2, 1200],
  ])('ROUND(%s, %s) = %s', (x, d, want) => expect(excelRound(x, d)).toBe(want));

  it('rejects non-finite numbers', () => {
    expect(() => excelRound(Number.NaN, 2)).toThrow(RangeError);
    expect(() => excelRound(Infinity, 2)).toThrow(RangeError);
  });

  it('is idempotent and never moves a value by more than half a unit (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.integer({ min: 0, max: 6 }), (x, d) => {
        const r = excelRound(x, d);
        expect(excelRound(r, d)).toBe(r);
        expect(Math.abs(r - x)).toBeLessThanOrEqual(0.5 * 10 ** -d + 1e-9 * Math.max(1, Math.abs(x)));
      }),
    );
  });

  it('two-decimal half-up: exact x.xx5 values always go up in absolute value (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), (n) => {
        const x = (n * 10 + 5) / 1000; // e.g. 1.235
        expect(excelRound(x, 2)).toBeCloseTo((n + 1) / 100, 10);
        expect(excelRound(-x, 2)).toBeCloseTo(-(n + 1) / 100, 10);
      }),
    );
  });
});

describe('integers, clamps and grades', () => {
  it('INT rounds down', () => {
    expect(excelInt(6.99)).toBe(6);
    expect(excelInt(-0.5)).toBe(-1);
    expect(clamp(1, 10, 11)).toBe(10);
    expect(clamp(1, 10, 0)).toBe(1);
  });
});

describe('dates', () => {
  it('EDATE clips to month end and handles years', () => {
    expect(edate('2026-01-31', 1)).toBe('2026-02-28');
    expect(edate('2028-01-31', 1)).toBe('2028-02-29');
    expect(edate('2026-11-05', 3)).toBe('2027-02-05');
    expect(edate('2026-03-31', -1)).toBe('2026-02-28');
    expect(edate('2026-08-10', -12)).toBe('2025-08-10');
  });
  it('Excel serial dates (1900 system)', () => {
    expect(serialToIso(46042)).toBe('2026-01-20');
    expect(serialToIso(46042.75)).toBe('2026-01-20');
    expect(isoToSerial('2026-01-20')).toBe(46042);
    fc.assert(
      fc.property(fc.integer({ min: 61, max: 80_000 }), (n) => {
        expect(isoToSerial(serialToIso(n))).toBe(n);
      }),
    );
  });
  it('validates and formats dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('20260101')).toBe(false);
    expect(isIsoDate(46042)).toBe(false);
    expect(() => parseIsoDate('1 Jan 2026')).toThrow(RangeError);
    expect(daysBetween('2026-05-25', '2026-10-30')).toBe(158);
    expect(fmtDateDdMmmYyyy('2026-11-05')).toBe('05 Nov 2026');
  });
});

describe('TEXT() formats', () => {
  it.each([
    [fmtThousands(1630309.4999999998), '1,630,310'],
    [fmtThousands(1234567.5), '1,234,568'],
    [fmtThousands(0), '0'],
    [fmtThousands(-0.4), '0'],
    [fmtThousands(-1500), '-1,500'],
    [fmtFixed(1.005, 2), '1.01'],
    [fmtFixed(-0.001, 2), '0.00'],
    [fmtPercent(0.75, 0), '75%'],
    [fmtPercent(0.1428571, 1), '14.3%'],
    [fmtPercent(0.0035, 2), '0.35%'],
    [fmtPercentOneTwo(0.035), '3.5%'],
    [fmtPercentOneTwo(0.0025), '0.25%'],
    [fmtPercentOneTwo(0.01), '1.0%'],
    [fmtSigned2(-0.25), '-0.25'],
    [fmtSigned2(0.5), '+0.50'],
    [fmtSigned2(0.001), '0.00'],
    [fmtSigned0(3), '+3'],
    [fmtSigned0(-2), '-2'],
    [fmtSigned0(0), '0'],
    [fmtSigned0(0, '+0'), '+0'],
    [excelGeneral(5), '5'],
    [excelGeneral(1.89), '1.89'],
    [excelGeneral(0.1 + 0.2), '0.3'],
    [excelGeneral(-0.25), '-0.25'],
  ])('%s', (got, want) => expect(got).toBe(want));
});
