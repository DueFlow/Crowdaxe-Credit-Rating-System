import type { ReconciliationReport } from './loader.js';

/** The reconciliation report as Markdown (written next to the JSON by the import CLI). */
export function renderReport(r: ReconciliationReport): string {
  const yes = (b: boolean) => (b ? 'Yes' : '**No**');
  const lines = [
    `# Import reconciliation report`,
    '',
    `| | |`,
    `|---|---|`,
    `| Result | ${r.ok ? (r.mode === 'apply' ? 'Imported' : 'Dry run: would import cleanly') : '**Not imported: see errors**'} |`,
    `| Mode | ${r.mode === 'apply' ? 'Apply' : 'Dry run (nothing written)'} |`,
    `| Scope | ${r.scope === 'methodology' ? 'Methodology only' : 'Methodology and records'} |`,
    `| Source | ${r.sourceFile} (SHA-256 ${r.sourceSha256.slice(0, 16)}…) |`,
    `| Workbook / methodology | ${r.workbookVersion} / ${r.methodVersion} |`,
    `| Parameter set | ${r.parameterSet.version}: ${r.parameterSet.action}, status ${r.parameterSet.status} |`,
    `| Run | ${r.startedAt} to ${r.finishedAt} |`,
    '',
    '## Tables',
    '',
    '| Table | Source rows | Inserted | Unchanged | Updated | Refused | In database |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...r.tables.map(
      (t) =>
        `| ${t.table} | ${t.source} | ${t.inserted} | ${t.unchanged} | ${t.updated} | ${t.refused} | ${t.inDatabase} |`,
    ),
    '',
    '## Totals (source against database)',
    '',
    '| Total | Source | Database | Match |',
    '|---|---:|---:|---|',
    ...r.totals.map(
      (t) =>
        `| ${t.name} | ${t.source.toLocaleString('en-GB')} | ${t.database.toLocaleString('en-GB')} | ${yes(t.matches)} |`,
    ),
    '',
    '## Checks',
    '',
    '| Check | Passed | Detail |',
    '|---|---|---|',
    ...r.checks.map((c) => `| ${c.name} | ${yes(c.ok)} | ${c.detail} |`),
  ];
  if (r.warnings.length) lines.push('', '## Warnings', '', ...r.warnings.map((w) => `- ${w}`));
  if (r.errors.length) lines.push('', '## Errors', '', ...r.errors.map((e) => `- ${e}`));
  return `${lines.join('\n')}\n`;
}
