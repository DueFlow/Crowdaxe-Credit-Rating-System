/**
 * Excel-compatible numeric, date and text helpers.
 *
 * Arithmetic stays in IEEE doubles, as in Excel. Rounding replicates Excel's ROUND: the value is first
 * taken to 15 significant digits (Excel's internal precision), then rounded half away from zero with
 * decimal.js. See methodology-spec.md section 1.3.
 */
import Decimal from 'decimal.js';

/** Excel ROUND(x, digits): half away from zero, on the 15-significant-digit value. */
export function excelRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`excelRound: not a finite number (${x})`);
  if (x === 0) return 0;
  const fifteen = new Decimal(x.toPrecision(15));
  const r =
    digits >= 0
      ? fifteen.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP)
      : fifteen
          .div(new Decimal(10).pow(-digits))
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .mul(new Decimal(10).pow(-digits));
  return r.toNumber() + 0; // Excel has no negative zero
}

/** Excel INT: rounds down to the nearest integer. */
export function excelInt(x: number): number {
  return Math.floor(x);
}

/** Clamp a value to [lo, hi]. */
export function clamp(lo: number, hi: number, x: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ---------------------------------------------------------------------------------------------
// Dates. The engine uses ISO dates ("yyyy-mm-dd") only, never local time, so results do not
// depend on the server's time zone.
// ---------------------------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const m = ISO.exec(iso);
  if (!m) throw new RangeError(`Not an ISO date (yyyy-mm-dd): ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const { y, m, d } = parseIsoDate(v);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function toIso(t: Date): string {
  return t.toISOString().slice(0, 10);
}

/** Excel EDATE: the same day n months later, clipped to the end of the month. */
export function edate(iso: string, months: number): string {
  const { y, m, d } = parseIsoDate(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Excel serial date (1900 date system) to ISO date. Fractions (times) are dropped.
 * Valid from serial 61 (1 March 1900): Excel counts a 29 February 1900 that never existed.
 */
export function serialToIso(serial: number): string {
  return toIso(new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * 86_400_000));
}

/** ISO date to Excel serial date. */
export function isoToSerial(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Excel TEXT(date, "dd mmm yyyy"), e.g. "05 Nov 2026". */
export function fmtDateDdMmmYyyy(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------------------------
// Excel TEXT() formats used by the workbook.
// ---------------------------------------------------------------------------------------------

function fixed(x: number, places: number): string {
  return new Decimal(x.toPrecision(15)).toFixed(places, Decimal.ROUND_HALF_UP);
}

function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** TEXT(x, "#,##0") */
export function fmtThousands(x: number): string {
  const s = fixed(x, 0);
  const neg = s.startsWith('-');
  const body = withThousands(neg ? s.slice(1) : s);
  return neg && body !== '0' ? `-${body}` : body;
}

/** TEXT(x, "0.00") and similar fixed-decimal formats. */
export function fmtFixed(x: number, places: number): string {
  const s = fixed(x, places);
  return s.startsWith('-') && Number(s) === 0 ? s.slice(1) : s;
}

/** TEXT(x, "0%"), "0.0%", "0.00%" */
export function fmtPercent(x: number, places: number): string {
  return `${fmtFixed(x * 100, places)}%`;
}

/** TEXT(x, "0.0#%"): one decimal place always, a second only if not zero. */
export function fmtPercentOneTwo(x: number): string {
  const s = fixed(x * 100, 2);
  const trimmed = s.endsWith('0') ? s.slice(0, -1) : s;
  return `${trimmed}%`;
}

/** TEXT(x, "+0.00;-0.00;0.00") */
export function fmtSigned2(x: number): string {
  const s = fixed(Math.abs(x), 2);
  if (Number(s) === 0) return '0.00';
  return x > 0 ? `+${s}` : `-${s}`;
}

/** TEXT(x, "+0;-0;0") and "+0;-0" (the latter shows zero as "+0") */
export function fmtSigned0(x: number, zeroText = '0'): string {
  const s = fixed(Math.abs(x), 0);
  if (Number(s) === 0) return zeroText;
  return x > 0 ? `+${s}` : `-${s}`;
}

/** Excel's general number-to-text conversion in string concatenation (e.g. "Grade "&5). */
export function excelGeneral(x: number): string {
  if (Number.isInteger(x)) return String(x);
  const s = Number(x.toPrecision(15)).toString();
  return s.startsWith('0.') ? s : s.replace(/^-0\./, '-0.');
}
