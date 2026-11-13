/**
 * Read Crowdaxe_CRS.xlsm into a WorkbookExtract (packages/db/src/extract.ts).
 *
 * Cell positions are those of Workbook 1.1 (data-inventory.md). Each sheet's header row is checked first,
 * so a later workbook with a changed layout stops with a clear message instead of importing wrong data.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { WorkbookExtract } from '@crowdaxe/db';
import { extractSchema } from '@crowdaxe/db';
import { serialToIso } from '@crowdaxe/engine';
import ExcelJS from 'exceljs';

type Prim = string | number | boolean | Date | null;

/** The value Excel shows: formula results, rich text joined, errors and blanks as null. */
function prim(v: ExcelJS.CellValue): Prim {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v as Prim;
  if ('result' in v) return prim((v as { result?: ExcelJS.CellValue }).result ?? null);
  if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
  if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  return null; // errors
}

/** Python-equivalent cleaning used by the Phase 1 extractor: trim text, blank → null. */
const v = (x: Prim): string | number | boolean | null => {
  if (typeof x === 'string') {
    const t = x.trim();
    return t === '' ? null : t;
  }
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return x;
};
const num = (x: Prim): number | null => (typeof x === 'number' ? x : null);
const str = (x: Prim): string | null => {
  const c = v(x);
  return c === null ? null : String(c);
};
/** Text exactly as stored (not trimmed), as the Phase 1 fixture export kept it. */
const raw = (x: Prim): string | null =>
  x === null || x === '' ? null : x instanceof Date ? isoDateTime(x) : String(x);
/** Dates: Date cells and serial numbers → "yyyy-mm-dd" (or with time when there is one). */
function isoDateTime(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : iso.slice(0, 19);
}
const date = (x: Prim): string | null =>
  x instanceof Date ? isoDateTime(x) : typeof x === 'number' ? serialToIso(x) : str(x);
const proposed = (ref: unknown) => typeof ref === 'string' && ref.includes('PROPOSED');

export class WorkbookLayoutError extends Error {}

export async function readWorkbook(path: string): Promise<WorkbookExtract> {
  const buffer = readFileSync(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new WorkbookLayoutError(`Sheet "${name}" not found: is this the Crowdaxe CRS workbook?`);
    return ws;
  };
  const cellOf = (ws: ExcelJS.Worksheet, r: number, c: number) => prim(ws.getCell(r, c).value);
  const expectHeader = (ws: ExcelJS.Worksheet, r: number, c: number, want: string[]) => {
    const got = want.map((_, i) => str(cellOf(ws, r, c + i)));
    if (got.some((g, i) => g !== want[i]))
      throw new WorkbookLayoutError(
        `Sheet "${ws.name}" row ${r}: expected headers ${want.join(', ')}; found ${got.join(', ')}. The workbook layout has changed.`,
      );
  };

  // ---------------------------------------------------------------- Parameters
  const P = sheet('Parameters');
  expectHeader(P, 5, 2, ['Name', 'Value', 'Unit', 'Methodology', 'Note']);
  const scalars: WorkbookExtract['parameterSet']['scalars'] = [];
  for (let r = 6; r <= 57; r++) {
    const name = str(cellOf(P, r, 2));
    if (!name || name === 'Output_PDFFolder') continue;
    const ref = str(cellOf(P, r, 5));
    scalars.push({
      name,
      value: v(cellOf(P, r, 3)) as number | string | null,
      unit: str(cellOf(P, r, 4)),
      ref,
      note: str(cellOf(P, r, 6)),
      proposed: proposed(ref),
      origin: 'Parameters sheet',
    });
  }
  // Values that were literals in formulas or outside the Parameters sheet (D-07, D-22, D-23)
  const added: [string, number | string, string, string | null, string][] = [
    ['Interp_NB4_A1', 4.5, 'num', 's4.2', 'Interpolation anchor at boundary b1 (4-boundary factors)'],
    ['Interp_NB4_A2', 3.5, 'num', 's4.2', 'Interpolation anchor at boundary b2 (4-boundary factors)'],
    ['Interp_NB4_A3', 2.5, 'num', 's4.2', 'Interpolation anchor at boundary b3 (4-boundary factors)'],
    ['Interp_NB4_A4', 1.5, 'num', 's4.2', 'Interpolation anchor at boundary b4 (4-boundary factors)'],
    ['Interp_NB2_A1', 4, 'num', 's4.2', 'Interpolation anchor at boundary b1 (2-boundary factors)'],
    ['Interp_NB2_A2', 2, 'num', 's4.2', 'Interpolation anchor at boundary b2 (2-boundary factors)'],
    [
      'Tol_ScoreOverride',
      0.005,
      'num',
      null,
      'A score differing from the calculated score by more than this is an override',
    ],
    ['Tol_Weights', 0.000001, 'num', null, 'Tolerance for pillar weights summing to 100%'],
    [
      'Tol_ShockValue',
      0.000001,
      'num',
      null,
      'A shock value differing from the default by more than this needs a reason',
    ],
    ['Tol_Haircut', 0.00001, 'num', null, 'Tolerance for haircut range and midpoint tests'],
    [
      'Overlay_InfoQuality_Ord',
      2,
      'num',
      's7.1',
      'Which Zimbabwe overlay is information quality (data check 7 compares it with the accounts type)',
    ],
    [
      'KO6_Enabled',
      String(v(cellOf(sheet('Blacklist'), 4, 3))),
      'text',
      null,
      'Blacklisting stops a new rating (knockout KO6); was Blacklist!C4',
    ],
    [
      'Txt_KO6',
      'Decline (knockout: company blacklisted by Crowdaxe)',
      'text',
      null,
      'Was the defined name Txt_KO6',
    ],
    [
      'KO6_CheckBorrowerOnPF',
      'No',
      'text',
      null,
      'Project finance: also check the borrower registration number for KO6 (D-23; No = workbook behaviour)',
    ],
  ];
  for (const [name, value, unit, ref, note] of added)
    scalars.push({ name, value, unit, ref, note, proposed: false, origin: 'added in Phase 1' });

  const ratingScale = [];
  for (let r = 61; r <= 70; r++)
    ratingScale.push({
      grade: num(cellOf(P, r, 2))!,
      description: str(cellOf(P, r, 3))!,
      cxScale: str(cellOf(P, r, 4))!,
      pd: num(cellOf(P, r, 5))!,
      appetite: str(cellOf(P, r, 6))!,
      reviewMonths: num(cellOf(P, r, 7))!,
      reviewCycle: str(cellOf(P, r, 8))!,
    });
  const overlays = [];
  for (let r = 74; r <= 78; r++)
    overlays.push({
      ord: num(cellOf(P, r, 2))!,
      name: str(cellOf(P, r, 3))!,
      maxNotches: num(cellOf(P, r, 4))!,
      descriptors: [str(cellOf(P, r, 5)), str(cellOf(P, r, 6)), str(cellOf(P, r, 7))],
    });
  expectHeader(P, 81, 2, ['Code', 'Track', 'Structure', 'Min notch', 'Max notch']);
  const structures = [];
  for (let r = 82; r <= 91; r++) {
    const ref = str(cellOf(P, r, 9));
    const name = str(cellOf(P, r, 4))!;
    structures.push({
      code: str(cellOf(P, r, 2))!,
      track: str(cellOf(P, r, 3)) as 'Corporate' | 'Project finance',
      name,
      minNotch: num(cellOf(P, r, 5))!,
      maxNotch: num(cellOf(P, r, 6))!,
      selfLiquidating: num(cellOf(P, r, 7)) === 1,
      offtake: num(cellOf(P, r, 8)) === 1,
      ref,
      conditions: str(cellOf(P, r, 10)),
      proposed: proposed(ref) || name.includes('PROPOSED'),
    });
  }

  // ---------------------------------------------------------------- Modules
  const M = sheet('Modules');
  expectHeader(M, 5, 2, ['Code', 'Module', 'Track', 'Factor set', 'Sub-sector set', 'Haircut set']);
  const modules = [];
  for (let r = 6; r <= 17; r++) {
    if (!str(cellOf(M, r, 2))) continue;
    modules.push({
      code: str(cellOf(M, r, 2))!,
      name: str(cellOf(M, r, 3))!,
      track: str(cellOf(M, r, 4)) as 'Corporate' | 'Project finance',
      factorSet: str(cellOf(M, r, 5))!,
      subSectorSet: str(cellOf(M, r, 6)),
      haircutSet: str(cellOf(M, r, 7))!,
      ref: str(cellOf(M, r, 8)),
    });
  }
  const hdr: Record<string, number> = {};
  M.getRow(21).eachCell((c, col) => {
    const h = str(prim(c.value));
    if (h) hdr[h] = col;
  });
  for (const h of ['Set', 'Key', 'Weight', 'b1', 'f1', 'Auto'])
    if (!hdr[h]) throw new WorkbookLayoutError(`Modules row 21: column "${h}" not found`);
  const factors = [];
  for (let r = 22; r <= 153; r++) {
    const g = (h: string) => v(cellOf(M, r, hdr[h]!));
    const gn = (h: string) => num(cellOf(M, r, hdr[h]!));
    if (!g('Key')) continue;
    const nb = (gn('NB') ?? 0) as 0 | 2 | 4;
    const ks = Array.from({ length: nb }, (_, k) => k + 1);
    factors.push({
      set: String(g('Set')),
      ord: gn('Ord')!,
      key: String(g('Key')),
      pillar: String(g('Pillar')),
      profile: g('Profile') as string | null,
      name: String(g('Factor')),
      weight: gn('Weight')!,
      measure: g('Measure') as string | null,
      unit: g('Unit') as string | null,
      type: g('Type') as 'Numeric',
      dir: g('Dir') as 'H' | 'L' | null,
      scale: gn('Scale') as 3 | 5,
      nb,
      bounds: ks.map((k) => gn(`b${k}`)!),
      fFlags: ks.map((k) => gn(`f${k}`) ?? 0),
      neg: gn('Neg') === 1,
      group: g('Group') as string | null,
      optional: gn('Optional') === 1,
      trackOnly: g('TrackOnly') as 'Corporate' | null,
      role: g('Role') as 'BASEDSCR' | 'CHAR' | null,
      link: g('Link') as 'CAMP' | null,
      descriptors: [1, 2, 3, 4, 5].map((k) => g(`T${k}`) as string | null),
      ref: g('Ref') as string | null,
      auto: g('Auto') as string | null,
      legacy: { topCut: gn('TopCut'), botCut: gn('BotCut'), judge: gn('Judge') },
    });
  }
  const subSectors = [];
  for (let r = 158; r <= 201; r++) {
    if (!str(cellOf(M, r, 2))) continue;
    subSectors.push({
      set: str(cellOf(M, r, 2))!,
      ord: num(cellOf(M, r, 3))!,
      name: str(cellOf(M, r, 5))!,
      gradeLow: num(cellOf(M, r, 6)),
      gradeHigh: num(cellOf(M, r, 7)),
      special: str(cellOf(M, r, 8)) as 'ANCHORGRADE' | 'GRADEPLUS1' | null,
    });
  }
  /** A number, following a plain cell reference when exceljs has dropped a cached result of 0. */
  const numFollow = (ws: ExcelJS.Worksheet, r: number, c: number): number | null => {
    const direct = num(cellOf(ws, r, c));
    if (direct !== null) return direct;
    const f = ws.getCell(r, c).formula;
    const m = f ? /^([A-Z]+)(\d+)$/.exec(f) : null;
    return m ? num(prim(ws.getCell(`${m[1]}${m[2]}`).value)) : null;
  };
  const coreOrdByRow = new Map<number, number>();
  for (let r = 206; r <= 317; r++)
    if (str(cellOf(M, r, 2)) === 'CORE') coreOrdByRow.set(r, num(cellOf(M, r, 3))!);
  const haircuts = [];
  for (let r = 206; r <= 317; r++) {
    if (!str(cellOf(M, r, 2))) continue;
    const f = M.getCell(r, 6).formula;
    const linked = f && /^F\d+$/.test(f) ? (coreOrdByRow.get(Number(f.slice(1))) ?? null) : null;
    haircuts.push({
      set: str(cellOf(M, r, 2))!,
      ord: num(cellOf(M, r, 3))!,
      name: str(cellOf(M, r, 5))!,
      low: numFollow(M, r, 6)!,
      high: numFollow(M, r, 7)!,
      crossBorderAddOn: numFollow(M, r, 8) ?? 0,
      ref: str(cellOf(M, r, 9)),
      linkedCoreOrd: linked,
    });
  }
  const questions = [];
  for (let r = 322; r <= 378; r++) {
    if (!str(cellOf(M, r, 2))) continue;
    const ref = str(cellOf(M, r, 11));
    questions.push({
      module: str(cellOf(M, r, 2))!,
      ord: num(cellOf(M, r, 3))!,
      key: str(cellOf(M, r, 4))!,
      kind: str(cellOf(M, r, 5)) as 'Red flag',
      question: str(cellOf(M, r, 6))!,
      flagAnswer: str(cellOf(M, r, 7)) as 'Yes' | 'No',
      target: str(cellOf(M, r, 8)),
      modifierType: str(cellOf(M, r, 9)) as 'Add' | null,
      modifierValue: num(cellOf(M, r, 10)),
      ref,
      proposed: proposed(ref),
    });
  }
  const shocks = [];
  for (let r = 383; r <= 447; r++) {
    if (!str(cellOf(M, r, 2))) continue;
    shocks.push({
      module: str(cellOf(M, r, 2))!,
      ord: num(cellOf(M, r, 3))!,
      key: str(cellOf(M, r, 4))!,
      name: str(cellOf(M, r, 5))!,
      size: str(cellOf(M, r, 6)),
      ref: str(cellOf(M, r, 7)),
      costType: str(cellOf(M, r, 8)) as 'Volume',
      defaultValue: num(cellOf(M, r, 9)) ?? 0,
    });
  }

  // ---------------------------------------------------------------- Lists
  const L = sheet('Lists');
  const lists: Record<string, string[]> = {};
  for (let c = 2; c <= 14; c++) {
    const code = str(cellOf(L, 5, c));
    if (!code) continue;
    const items: string[] = [];
    for (let r = 6; r <= 16; r++) {
      const x = v(cellOf(L, r, c));
      if (x !== null) items.push(String(x));
    }
    lists[code] = items;
  }
  const A = sheet('Deal Activity');
  lists['act_EventTypes'] = Array.from({ length: 10 }, (_, i) => str(cellOf(A, 5 + i, 16))!);

  const methodVersion = String(scalars.find((x) => x.name === 'Method_Version')?.value ?? '');
  const workbookVersion = String(scalars.find((x) => x.name === 'CRS_Version')?.value ?? '');
  const parameterSet = {
    version: methodVersion,
    methodVersion,
    workbookVersion,
    source: 'Crowdaxe_CRS.xlsm',
    scalars,
    ratingScale,
    overlays,
    structures,
    modules,
    factors,
    subSectors,
    haircuts,
    questions,
    shocks,
    lists,
  };

  // ---------------------------------------------------------------- Ratings and RatingInputs
  const R = sheet('Ratings');
  const rHdr: string[] = [];
  for (let c = 2; c <= 26; c++) rHdr.push(str(cellOf(R, 5, c)) ?? '');
  if (rHdr[0] !== 'Rating ID' || rHdr[24] !== 'Saved at')
    throw new WorkbookLayoutError('Ratings: header row 5 has changed');
  const inputs = new Map<string, Record<string, string>>();
  const RI = sheet('RatingInputs');
  expectHeader(RI, 5, 2, ['Rating ID', 'Key', 'Value']);
  for (let r = 6; r <= RI.rowCount; r++) {
    const id = raw(cellOf(RI, r, 2));
    if (!id) continue;
    const m = inputs.get(id) ?? {};
    m[raw(cellOf(RI, r, 3))!] = raw(cellOf(RI, r, 4))!;
    inputs.set(id, m);
  }
  const ratings = [];
  for (let r = 6; r <= R.rowCount; r++) {
    const id = raw(cellOf(R, r, 2));
    if (!id) continue;
    const row: Record<string, string | number | null> = {};
    rHdr.forEach((h, i) => {
      const x = cellOf(R, r, 2 + i);
      row[h] = x instanceof Date ? isoDateTime(x) : (x as string | number | null);
    });
    ratings.push({ ratingsRow: row, inputs: inputs.get(id) ?? {} });
  }

  // ---------------------------------------------------------------- Deal Activity, Deal History, Blacklist
  expectHeader(A, 4, 2, ['Entry ID', 'Reg number', 'Borrower', 'Deal ID', 'Event', 'Event date']);
  const activity = [];
  for (let r = 5; r <= A.rowCount; r++) {
    const id = raw(cellOf(A, r, 2));
    if (!id) continue;
    const c = (k: number) => cellOf(A, r, k);
    activity.push({
      entryId: id,
      regNo: raw(c(3))!,
      borrowerName: raw(c(4)),
      dealId: raw(c(5)),
      event: raw(c(6))!,
      eventDate: date(c(7))!,
      dueDate: date(c(8)),
      amountDue: num(c(9)),
      amountPaid: num(c(10)),
      daysLate: num(c(11)),
      notes: raw(c(12)),
      enteredOn: date(c(13)),
      enteredBy: raw(c(14)),
    });
  }
  const H = sheet('Deal History');
  expectHeader(H, 5, 2, ['Reg number', 'Borrower name', 'Deal ID', 'Facility type', 'Amount USD']);
  const dealHistory = [];
  for (let r = 6; r <= H.rowCount; r++) {
    const reg = raw(cellOf(H, r, 2));
    if (!reg) continue;
    const c = (k: number) => cellOf(H, r, k);
    dealHistory.push({
      regNo: reg,
      borrowerName: raw(c(3)),
      dealId: raw(c(4)),
      facilityType: raw(c(5)),
      amount: num(c(6)),
      disbursementDate: date(c(7)),
      maturityDate: date(c(8)),
      status: raw(c(9))!,
      maxDpd: num(c(10)),
      notes: raw(c(11)),
    });
  }
  const B = sheet('Blacklist');
  expectHeader(B, 8, 2, ['Reg number', 'Borrower', 'Status', 'Blacklisted on', 'Reason']);
  const blacklist = [];
  for (let r = 9; r <= B.rowCount; r++) {
    const reg = raw(cellOf(B, r, 2));
    if (!reg) continue;
    const c = (k: number) => cellOf(B, r, k);
    blacklist.push({
      regNo: reg,
      borrowerName: raw(c(3)),
      status: raw(c(4))!,
      blacklistedOn: date(c(5)),
      reason: raw(c(6)),
      liftedOn: date(c(7)),
      updated: date(c(8)),
    });
  }

  // ---------------------------------------------------------------- Pipeline Register, Override Log, Changelog
  const PR = sheet('Pipeline Register');
  expectHeader(PR, 5, 2, ['Deal ID', 'Borrower', 'Sector module', 'Track', 'Facility', 'Amount USD']);
  const pipeline = [];
  for (let r = 6; r <= PR.rowCount; r++) {
    const id = raw(cellOf(PR, r, 2));
    if (!id) continue;
    const c = (k: number) => cellOf(PR, r, k);
    pipeline.push({
      dealId: id,
      borrower: raw(c(3)),
      sectorModule: raw(c(4)),
      track: raw(c(5)),
      facility: raw(c(6)),
      amount: num(c(7)),
      obligorGrade: num(c(8)),
      facilityGrade: num(c(9)),
      pd: num(c(10)),
      lgd: num(c(11)),
      elUsd: num(c(12)),
      recommendation: raw(c(13)),
      stage: raw(c(14)),
      analyst: raw(c(15)),
      reviewer: raw(c(16)),
      ratingDate: date(c(17)),
      nextReview: date(c(18)),
      methodVersion: raw(c(19)),
      pdfPath: raw(c(20)),
    });
  }
  const OL = sheet('Override Log');
  expectHeader(OL, 6, 2, [
    'Date',
    'Deal',
    'Rating ID',
    'Grade',
    'Model grade',
    'Final grade',
    'Notches moved',
    'Reason',
  ]);
  const overrideLog = [];
  for (let r = 7; r <= OL.rowCount; r++) {
    const id = raw(cellOf(OL, r, 4));
    if (!id) continue;
    const c = (k: number) => cellOf(OL, r, k);
    overrideLog.push({
      date: date(c(2)),
      dealId: raw(c(3)),
      ratingId: id,
      grade: raw(c(5))!,
      modelGrade: num(c(6))!,
      finalGrade: num(c(7))!,
      notches: num(c(8))!,
      reason: raw(c(9)),
      approvedBy: raw(c(10)),
      approvalDate: date(c(11)),
      analyst: raw(c(12)),
    });
  }
  const CL = sheet('Changelog');
  const changelog = [];
  for (let r = 6; r <= CL.rowCount; r++) {
    const ver = raw(cellOf(CL, r, 2));
    if (!ver) continue;
    changelog.push({ version: ver, date: raw(cellOf(CL, r, 3)) ?? '', change: raw(cellOf(CL, r, 4)) ?? '' });
  }

  return extractSchema.parse({
    source: {
      file: basename(path),
      sha256: createHash('sha256').update(buffer).digest('hex'),
      workbookVersion,
      methodVersion,
    },
    parameterSet,
    ratings,
    activity,
    dealHistory,
    blacklist,
    pipeline,
    overrideLog,
    changelog,
  });
}
