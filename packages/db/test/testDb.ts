/**
 * A fresh PostgreSQL database per test file, built with the committed migrations (prisma migrate deploy).
 * Needs a server: TEST_DATABASE_ADMIN_URL (default postgresql://postgres@localhost:5432/postgres).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { WorkbookExtract } from '../src/index.js';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'] ?? 'postgresql://postgres@localhost:5432/postgres';
const pkgDir = fileURLToPath(new URL('..', import.meta.url));

export interface TestDb {
  url: string;
  name: string;
  db: PrismaClient;
  sql: (query: string) => string;
  drop: () => Promise<void>;
}

export const urlFor = (name: string, user?: string) => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  if (user) {
    u.username = user;
    u.password = 'test';
  }
  return u.toString();
};

export function psql(url: string, query: string): string {
  return execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', query], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function createTestDb(): Promise<TestDb> {
  const name = `crs_test_${randomBytes(5).toString('hex')}`;
  psql(adminUrl, `CREATE DATABASE ${name}`);
  const url = urlFor(name);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: pkgDir,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    url,
    name,
    db,
    sql: (q) => psql(url, q),
    drop: async () => {
      await db.$disconnect();
      psql(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}

export const extractFixture = (): WorkbookExtract =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/workbook-extract-1.1.json', import.meta.url)), 'utf8'),
  );

export const engineFixture = (n: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../engine/fixtures/${n}`, import.meta.url)), 'utf8'));
