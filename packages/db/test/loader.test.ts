/** Workbook import: dry run, apply, re-run, refusals, and the stored ratings. */
import { parseHistorySnapshot, rate, ParameterSet } from '@crowdaxe/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historySnapshotFor, loadParameterSet, loadWorkbookExtract, renderReport } from '../src/index.js';
import { createTestDb, extractFixture, type TestDb } from './testDb.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());
const TODAY = '2026-11-13';
const count = (table: string) => Number(t.sql(`select count(*) from ${table}`));

describe('workbook import', () => {
  it('dry run reports a clean import and writes nothing', async () => {
    const r = await loadWorkbookExtract(t.db, extractFixture(), { mode: 'dry-run', today: TODAY });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(Object.fromEntries(r.tables.map((x) => [x.table, x.inserted]))).toEqual({
      companies: 3,
      deals: 6,
      deal_activity: 26,
      ratings: 7,
      rating_inputs: 7,
      rating_results: 7,
      rating_checks: 91,
      overrides: 1,
      changelog: 1,
    });
    expect(r.totals.every((x) => x.matches)).toBe(true);
    for (const tb of ['parameter_sets', 'companies', 'ratings', 'deal_activity', 'import_runs'])
      expect(count(tb)).toBe(0);
    expect(renderReport(r)).toContain('Dry run: would import cleanly');
  });

  it('apply imports everything, the parameter set Active', async () => {
    const r = await loadWorkbookExtract(t.db, extractFixture(), { mode: 'apply', today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.parameterSet).toMatchObject({ version: '1.1', action: 'created', status: 'ACTIVE' });
    expect(count('ratings')).toBe(7);
    expect(count('import_runs')).toBe(1);
    expect(t.sql(`select action from audit_log`)).toBe('import.workbook');
    expect(
      t.sql(
        `select string_agg(rating_id || ':' || status, ',' order by rating_id) from ratings where status <> 'FINAL'`,
      ),
    ).toBe('R-20261006-152210:SUPERSEDED');
    expect(
      t.sql(
        `select r.rating_id from ratings r join ratings s on s.superseded_by_id is null and r.superseded_by_id = s.id`,
      ),
    ).toBe('R-20261006-152210');
    expect(
      t.sql(`select grade_type||' '||model_grade||'>'||final_grade||' '||approval_status from overrides`),
    ).toBe('Facility 3>4 NOT_REQUIRED');
    expect(t.sql(`select stage from deals where deal_id='CX-2026-006'`)).toBe('Pipeline Deals');
    expect(
      t.sql(
        `select to_char(saved_at at time zone 'Africa/Harare','YYYY-MM-DD HH24:MI:SS') from ratings where rating_id='R-20260112-101422'`,
      ),
    ).toBe('2026-01-12 10:14:22');
  });

  it('stored inputs, history snapshot and parameter set re-run to the stored result', async () => {
    const rows = await t.db.rating.findMany({ include: { inputs: true, result: true } });
    for (const r of rows) {
      const ps: ParameterSet = await loadParameterSet(t.db, r.parameterSetId);
      const again = rate(r.inputs!.inputs as never, ps, parseHistorySnapshot(r.inputs!.historySnapshot));
      // exact: every double as the engine produced it (Prisma's JSON writes would round to 15 digits)
      expect(r.result!.result).toEqual(JSON.parse(JSON.stringify(again)));
      expect(again.facility.final).toBe(r.facilityFinal);
    }
  });

  it('live Deal History from the database matches the import-time snapshot (as at the rating date)', async () => {
    const r = await t.db.rating.findUniqueOrThrow({
      where: { ratingId: 'R-20261105-113004' },
      include: { inputs: true },
    });
    const snap = await historySnapshotFor(t.db, ['2259/2013'], '2026-11-05');
    expect(snap).toEqual(r.inputs!.historySnapshot);
    const live = await historySnapshotFor(t.db, [' 2259 / 2013 '], TODAY);
    expect(live.blacklist).toEqual([{ regNo: '2259/2013', status: 'Active' }]);
    expect(live.rows).toEqual([
      { regNo: '2259/2013', dealId: 'CX-2026-003', status: 'Defaulted', maturityDate: '2027-02-25' },
    ]);
    expect(await historySnapshotFor(t.db, [null, ''], TODAY)).toEqual({
      asOf: TODAY,
      rows: [],
      blacklist: [],
    });
  });

  it('opening-balance history records are included (D-33)', async () => {
    const co = await t.db.company.findUniqueOrThrow({ where: { regNoKey: '3187/2011' } });
    await t.db.manualHistoryRecord.create({
      data: {
        companyId: co.id,
        regNo: '3187/2011',
        dealRef: 'PRE-CRS-1',
        status: 'Repaid on time',
        maturityDate: new Date('2024-06-30T00:00:00Z'),
      },
    });
    const snap = await historySnapshotFor(t.db, ['3187/2011'], TODAY);
    expect(snap.rows.map((r) => r.dealId)).toEqual(['CX-2026-001', 'CX-2026-004', 'PRE-CRS-1']);
  });

  it('a re-run changes nothing', async () => {
    const r = await loadWorkbookExtract(t.db, extractFixture(), { mode: 'apply', today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.parameterSet.action).toBe('unchanged');
    for (const tb of r.tables) {
      expect(tb.inserted, tb.table).toBe(0);
      expect(tb.unchanged, tb.table).toBe(tb.source);
    }
    expect(count('ratings')).toBe(7);
  });

  it('Final ratings are frozen in the database', async () => {
    const id = 'R-20260112-101422';
    expect(() => t.sql(`update ratings set facility_final = 2 where rating_id='${id}'`)).toThrow(
      /cannot be changed/,
    );
    expect(() => t.sql(`update ratings set status = 'DRAFT' where rating_id='${id}'`)).toThrow(
      /cannot be changed/,
    );
    expect(() => t.sql(`delete from ratings where rating_id='${id}'`)).toThrow(/cannot be deleted/);
    expect(() =>
      t.sql(
        `update rating_results set engine_version='x' where rating_ref=(select id from ratings where rating_id='${id}')`,
      ),
    ).toThrow(/cannot be changed/);
    expect(() =>
      t.sql(
        `update rating_inputs set revision = 2 where rating_ref=(select id from ratings where rating_id='${id}')`,
      ),
    ).toThrow(/cannot be changed/);
  });

  it('refuses a parameter set with the same version but different rules', async () => {
    const x = extractFixture();
    x.parameterSet.scalars.find((s) => s.name === 'Overlay_Cap')!.value = 2;
    const r = await loadWorkbookExtract(t.db, x, { mode: 'dry-run', today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/already in the database with different rules/);
  });

  it('a new methodology version is imported as PROPOSED, the Active set unchanged', async () => {
    const x = extractFixture();
    x.parameterSet.version = '1.2';
    x.parameterSet.methodVersion = '1.2';
    const r = await loadWorkbookExtract(t.db, x, { mode: 'apply', methodologyOnly: true, today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('methodology');
    expect(r.parameterSet.status).toBe('PROPOSED');
    expect(t.sql(`select string_agg(version||':'||status, ',' order by version) from parameter_sets`)).toBe(
      '1.1:ACTIVE,1.2:PROPOSED',
    );
  });
});

describe('import refusals (fresh database)', () => {
  let u: TestDb;
  beforeAll(async () => {
    u = await createTestDb();
  });
  afterAll(async () => u?.drop());

  it('a rating that does not reproduce stops the whole import', async () => {
    const x = extractFixture();
    x.ratings[1]!.ratingsRow['EL USD'] = 219;
    x.overrideLog[0]!.finalGrade = 5;
    const r = await loadWorkbookExtract(u.db, x, { mode: 'apply', today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(
      'Rating R-20260203-140251 does not reproduce: EL USD: workbook 219, engine 218.75',
    );
    expect(r.errors).toContain('Override Log row for R-20260810-093145 (Facility): log 3→5, rating 3→4');
    expect(r.errors).toContain('Total "Ratings: EL US$" differs: source 63279, database 63060');
    expect(r.tables.find((x) => x.table === 'ratings')).toMatchObject({ inserted: 6, refused: 1 });
    expect(Number(u.sql('select count(*) from ratings'))).toBe(0);
    expect(Number(u.sql('select count(*) from parameter_sets'))).toBe(0);
  });

  it('flags Deal History and Blacklist rows that Deal Activity does not explain', async () => {
    const x = extractFixture();
    x.dealHistory[0]!.status = 'Defaulted';
    x.blacklist[0]!.status = 'Lifted';
    const r = await loadWorkbookExtract(u.db, x, { mode: 'dry-run', today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      'Deal History sheet = derived from Deal Activity',
      'Blacklist sheet = derived from Deal Activity',
    ]);
    expect(renderReport(r)).toContain('**Not imported: see errors**');
  });

  it('methodology only, for production (the workbook deals are test data)', async () => {
    const r = await loadWorkbookExtract(u.db, extractFixture(), {
      mode: 'apply',
      methodologyOnly: true,
      today: TODAY,
    });
    expect(r.ok).toBe(true);
    expect(r.tables).toEqual([]);
    expect(Number(u.sql('select count(*) from companies'))).toBe(0);
    expect(u.sql(`select status from parameter_sets`)).toBe('ACTIVE');
  });
});
