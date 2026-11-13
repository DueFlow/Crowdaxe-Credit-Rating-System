import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ROLES, seedDevelopment, seedReferenceData } from '../src/index.js';
import { createTestDb, type TestDb } from './testDb.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.drop());

describe('seed', () => {
  it('reference data only: roles and settings, idempotent', async () => {
    await seedReferenceData(t.db);
    await seedReferenceData(t.db);
    expect(await t.db.role.count()).toBe(ROLES.length);
    expect(await t.db.setting.count()).toBe(Object.keys(DEFAULT_SETTINGS).length);
    expect(await t.db.parameterSet.count()).toBe(0);
  });
  it('development seed loads the test deals marked as SEED', async () => {
    const r = await seedDevelopment(t.db, '2026-11-13');
    expect(r.ok).toBe(true);
    expect(t.sql(`select string_agg(distinct source::text, ',') from ratings`)).toBe('SEED');
    expect(t.sql(`select count(*) from companies where source = 'SEED'`)).toBe('3');
  });
});
