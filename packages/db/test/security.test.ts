/**
 * Database security (docs/architecture.md section 2): RLS on every table, the app role limited to data,
 * append-only audit log, and nothing visible to a public role such as Supabase's anon / authenticated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkbookExtract } from '../src/index.js';
import { createTestDb, extractFixture, psql, type TestDb, urlFor } from './testDb.js';

let t: TestDb;
let asApp: (q: string) => string;
let asAnon: (q: string) => string;
beforeAll(async () => {
  t = await createTestDb();
  await loadWorkbookExtract(t.db, extractFixture(), { mode: 'apply', today: '2026-11-13' });
  // Login roles for the test: one member of crs_app, one public role with table grants but no policy
  t.sql(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='crs_test_app') THEN CREATE ROLE crs_test_app LOGIN PASSWORD 'test' IN ROLE crs_app; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='crs_test_anon') THEN CREATE ROLE crs_test_anon LOGIN PASSWORD 'test'; END IF;
  END $$`);
  t.sql(
    `GRANT USAGE ON SCHEMA public TO crs_test_anon; GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO crs_test_anon`,
  );
  asApp = (q) => psql(urlFor(t.name, 'crs_test_app'), q);
  asAnon = (q) => psql(urlFor(t.name, 'crs_test_anon'), q);
});
afterAll(async () => {
  t?.sql(
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM crs_test_anon; REVOKE ALL ON SCHEMA public FROM crs_test_anon`,
  );
  await t?.drop();
});

describe('database security', () => {
  it('every application table has Row Level Security and the crs_app policy', () => {
    const missing = t.sql(`
      SELECT coalesce(string_agg(c.relname, ', '), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
        AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND 'crs_app' = ANY (p.roles)))`);
    expect(missing).toBe('');
    expect(
      Number(
        t.sql(
          `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
        ),
      ),
    ).toBe(36);
  });

  it('the app role reads and writes data', () => {
    expect(asApp('SELECT count(*) FROM ratings')).toBe('7');
    expect(asApp(`INSERT INTO system_status (key, value) VALUES ('ping', '{}') RETURNING key`)).toBe('ping');
  });

  it('the app role cannot change the schema, the migration history or the audit trail', () => {
    expect(() => asApp('CREATE TABLE x (id int)')).toThrow(/permission denied/);
    expect(() => asApp('DROP TABLE ratings')).toThrow(/must be owner|permission denied/);
    expect(() => asApp('SELECT * FROM _prisma_migrations')).toThrow(/permission denied/);
    expect(() => asApp(`UPDATE audit_log SET action = 'x'`)).toThrow(/permission denied/);
    expect(() => asApp('DELETE FROM audit_log')).toThrow(/permission denied/);
    expect(() => asApp('DELETE FROM login_events')).toThrow(/permission denied/);
    expect(
      asApp(`INSERT INTO audit_log (action, entity_type) VALUES ('test', 'test') RETURNING action`),
    ).toBe('test');
  });

  it('a role without the policy sees no rows and cannot insert, even with table grants', () => {
    expect(asAnon('SELECT count(*) FROM ratings')).toBe('0');
    expect(asAnon('SELECT count(*) FROM companies')).toBe('0');
    expect(asAnon('SELECT count(*) FROM users')).toBe('0');
    expect(() => asAnon(`INSERT INTO system_status (key, value) VALUES ('x', '{}')`)).toThrow(
      /row-level security/,
    );
  });
});
