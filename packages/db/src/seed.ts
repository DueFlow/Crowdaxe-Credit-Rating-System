/**
 * Development seed: the five roles, default settings, parameter set 1.1 (Active), and the workbook's TEST
 * companies, deals, ratings and Deal Activity (confirmed test data), all marked source = SEED.
 * Never run against production: production gets the methodology only (crs-import --methodology-only).
 */
import type { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WorkbookExtract } from './extract.js';
import { loadWorkbookExtract, type ReconciliationReport } from './loader.js';

export const ROLES = [
  {
    code: 'ANALYST',
    name: 'Analyst',
    description:
      'Creates and edits deals and ratings, records deal activity, submits ratings, exports Screening Notes',
  },
  {
    code: 'REVIEWER',
    name: 'Reviewer',
    description: 'Reviews submitted ratings; returns them with comments or marks them reviewed',
  },
  {
    code: 'IC_APPROVER',
    name: 'IC Approver',
    description: 'Approves overrides above the limit, parameter sets, and final ratings when that step is on',
  },
  {
    code: 'ADMIN',
    name: 'Admin',
    description: 'Manages users, roles, parameters, methodology tables, lists, branding and system settings',
  },
  { code: 'VIEWER', name: 'Viewer', description: 'Read-only access to ratings, pipeline and dashboards' },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'workflow.reviewerStep': false,
  'workflow.icSignOffOnFinal': false,
  'auth.ssoEnabled': false,
  'auth.sessionIdleMinutes': 30,
  'auth.sessionAbsoluteHours': 12,
  'auth.lockoutAttempts': 5,
  'auth.lockoutMinutes': 15,
  'auth.totpRequiredForRoles': ['ADMIN', 'IC_APPROVER'],
  'text.disclaimer': 'Internal assessment, not a rating by a registered credit rating agency.',
  'text.screeningNoteFooter': 'Crowdaxe Capital  |  Internal',
};

/** Roles and default settings: safe to run anywhere, including production (inserts only what is missing). */
export async function seedReferenceData(db: PrismaClient): Promise<void> {
  for (const r of ROLES) await db.role.upsert({ where: { code: r.code }, create: r, update: {} });
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
    await db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
}

export async function seedDevelopment(db: PrismaClient, today?: string): Promise<ReconciliationReport> {
  await seedReferenceData(db);
  const extract = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/workbook-extract-1.1.json', import.meta.url)), 'utf8'),
  ) as WorkbookExtract;
  return loadWorkbookExtract(db, extract, { mode: 'apply', source: 'SEED', ...(today ? { today } : {}) });
}
