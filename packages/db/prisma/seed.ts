/** pnpm --filter @crowdaxe/db seed          development seed (roles, settings, parameter set 1.1, test deals)
 *  pnpm --filter @crowdaxe/db seed -- --reference-only   roles and settings only (safe for production) */
import { PrismaClient } from '@prisma/client';
import { renderReport, seedDevelopment, seedReferenceData } from '../src/index.js';

const db = new PrismaClient();
try {
  if (process.argv.includes('--reference-only')) {
    await seedReferenceData(db);
    console.log('Roles and default settings are in place.');
  } else {
    const report = await seedDevelopment(db);
    console.log(renderReport(report));
    if (!report.ok) process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
