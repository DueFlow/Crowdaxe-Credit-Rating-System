#!/usr/bin/env tsx
/**
 * crs-import: import Crowdaxe_CRS.xlsm into the CRS database.
 *
 *   pnpm --filter @crowdaxe/import import -- --file Crowdaxe_CRS.xlsm                 dry run (default)
 *   pnpm --filter @crowdaxe/import import -- --file Crowdaxe_CRS.xlsm --apply         import
 *   pnpm --filter @crowdaxe/import import -- --file Crowdaxe_CRS.xlsm --methodology-only --apply
 *   pnpm --filter @crowdaxe/import import -- --file Crowdaxe_CRS.xlsm --extract out.json   write the extract only
 *
 * Writes the reconciliation report to --report (default import-report.md) and the same as JSON.
 * Uses DATABASE_URL. Exit code 0 when the import (or dry run) is clean, 1 otherwise.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadWorkbookExtract, prisma, renderReport } from '@crowdaxe/db';
import { readWorkbook } from './readWorkbook.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'methodology-only': { type: 'boolean', default: false },
    report: { type: 'string', default: 'import-report.md' },
    extract: { type: 'string' },
    today: { type: 'string' },
  },
});

async function main(): Promise<number> {
  if (!values.file) {
    console.error('Give the workbook with --file path/to/Crowdaxe_CRS.xlsm');
    return 2;
  }
  const extract = await readWorkbook(values.file);
  if (values.extract) {
    writeFileSync(values.extract, `${JSON.stringify(extract, null, 1)}\n`);
    console.log(`Extract written to ${values.extract}`);
    return 0;
  }
  const db = prisma();
  try {
    const report = await loadWorkbookExtract(db, extract, {
      mode: values.apply ? 'apply' : 'dry-run',
      methodologyOnly: values['methodology-only'],
      ...(values.today ? { today: values.today } : {}),
    });
    writeFileSync(values.report!, renderReport(report));
    writeFileSync(values.report!.replace(/\.md$/, '') + '.json', `${JSON.stringify(report, null, 2)}\n`);
    console.log(renderReport(report));
    return report.ok ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
