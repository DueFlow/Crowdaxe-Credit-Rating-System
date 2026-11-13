/** Parameter sets: exact round trip to the engine document, versioning controls in the database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activateParameterSet,
  createParameterSet,
  getActiveParameterSetId,
  loadParameterSet,
  loadParameterSetDoc,
  parameterSetHash,
} from '../src/index.js';
import { createTestDb, engineFixture, type TestDb } from './testDb.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());

describe('parameter sets', () => {
  const doc = engineFixture('parameter-set-1.1.json');

  it('round-trips parameter set 1.1 exactly', async () => {
    const { id, contentHash } = await createParameterSet(t.db, doc);
    expect(contentHash).toBe(parameterSetHash(doc));
    expect(await loadParameterSetDoc(t.db, id)).toEqual(doc);
    const ps = await loadParameterSet(t.db, id);
    expect(ps.num('Grade_Factor')).toBe(2.25);
    expect(ps.optNum('Price_CostOfFunds')).toBeNull();
  });

  it('hash ignores key order and the source note, but not content', () => {
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    expect(parameterSetHash(reordered as typeof doc)).toBe(parameterSetHash(doc));
    expect(parameterSetHash({ ...doc, source: 'elsewhere' })).toBe(parameterSetHash(doc));
    const changed = structuredClone(doc);
    changed.scalars[0].value = 0.46;
    expect(parameterSetHash(changed)).not.toBe(parameterSetHash(doc));
  });

  it('only a DRAFT set can change; only one set is ACTIVE', async () => {
    const draft = await createParameterSet(t.db, { ...doc, version: '1.1-test-a' });
    await t.db.parameter.update({
      where: { setId_name: { setId: draft.id, name: 'Overlay_Cap' } },
      data: { valueNum: 3 },
    });
    await activateParameterSet(t.db, draft.id, { effectiveDate: '2026-11-13' });
    expect(await getActiveParameterSetId(t.db)).toBe(draft.id);
    await expect(
      t.db.parameter.update({
        where: { setId_name: { setId: draft.id, name: 'Overlay_Cap' } },
        data: { valueNum: 4 },
      }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(t.db.factor.deleteMany({ where: { setId: draft.id } })).rejects.toThrow(/cannot be changed/);

    const next = await createParameterSet(t.db, { ...doc, version: '1.1-test-b' });
    await expect(
      t.db.parameterSet.update({ where: { id: next.id }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow();
    await activateParameterSet(t.db, next.id, { effectiveDate: '2026-12-01' });
    expect(await getActiveParameterSetId(t.db)).toBe(next.id);
    expect((await t.db.parameterSet.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('RETIRED');
  });

  it('refuses an invalid parameter set before writing anything', async () => {
    const bad = structuredClone(doc);
    bad.scalars.find((s: { name: string }) => s.name === 'Wt_P1').value = 0.5;
    const before = await t.db.parameterSet.count();
    await expect(createParameterSet(t.db, { ...bad, version: 'bad' })).rejects.toThrow(/must sum to 100%/);
    expect(await t.db.parameterSet.count()).toBe(before);
  });
});
