/**
 * Load a WorkbookExtract into the database (docs/architecture.md section 11).
 *
 * - One transaction. In dry-run mode everything is written and checked, the report is produced, and the
 *   transaction is rolled back, so a dry run reports exactly what an import would do.
 * - Re-runnable: records are matched on natural keys (parameter set version, registration number, Deal ID,
 *   Entry ID, Rating ID). Existing records are left unchanged; a parameter set with the same version but
 *   different content is refused.
 * - Every saved rating is re-run through the engine with Deal History as at its rating date, and is only
 *   imported if the engine reproduces the workbook's saved results.
 */
import {
  type ActivityEvent,
  activityEventSchema,
  deriveBlacklist,
  deriveDeal,
  deriveDealHistory,
  ENGINE_VERSION,
  excelGeneral,
  inputFromWorkbookCells,
  ParameterSet,
  parseHistorySnapshot,
  rate,
  type RatingResult,
  regNoKey,
} from '@crowdaxe/engine';
import type { Prisma, PrismaClient } from '@prisma/client';
import { harareToday, harareToInstant, toDbDate } from './dates.js';
import { extractSchema, type RatingsRow, type WorkbookExtract } from './extract.js';
import { activateParameterSet, createParameterSet, parameterSetHash } from './parameterSets.js';
import { insertRatingInput, upsertRatingResult } from './ratingDocuments.js';

export type ImportMode = 'dry-run' | 'apply';

export interface TableReconciliation {
  table: string;
  source: number;
  inserted: number;
  unchanged: number;
  updated: number;
  refused: number;
  inDatabase: number;
}

export interface ReconciliationReport {
  mode: ImportMode;
  scope: 'methodology' | 'all';
  sourceFile: string;
  sourceSha256: string;
  workbookVersion: string;
  methodVersion: string;
  startedAt: string;
  finishedAt: string;
  parameterSet: { version: string; status: string; action: 'created' | 'unchanged'; contentHash: string };
  tables: TableReconciliation[];
  totals: { name: string; source: number; database: number; matches: boolean }[];
  checks: { name: string; ok: boolean; detail: string }[];
  warnings: string[];
  errors: string[];
  ok: boolean;
}

export interface LoadOptions {
  mode: ImportMode;
  /** Import only the methodology (parameter set): use for production, where the workbook's deals are test data. */
  methodologyOnly?: boolean;
  /** Date used for "today" (Deal History of the current sheets, effective date). Defaults to today in Harare. */
  today?: string;
  /** Record source: workbook import (default) or development seed. */
  source?: 'WORKBOOK_IMPORT' | 'SEED';
  importedById?: string;
}

class DryRunRollback extends Error {}

type Tx = Prisma.TransactionClient;

const COMPARE: [keyof RatingsRow, (r: RatingResult) => number | string | null][] = [
  ['Blended score', (r) => r.blendedScore],
  ['Obligor model', (r) => r.obligor.model],
  ['Obligor final', (r) => r.obligor.final],
  ['Facility model', (r) => r.facility.model],
  ['Facility final', (r) => r.facility.final],
  ['PD', (r) => r.pd],
  ['LGD', (r) => r.collateral.lgd],
  ['EAD USD', (r) => r.deal.ead],
  ['EL USD', (r) => r.elUsd],
  ['Recommendation', (r) => r.recommendation],
  ['Overridden', (r) => (r.override.applied ? 'Yes' : 'No')],
];

const sameNum = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

export async function loadWorkbookExtract(
  db: PrismaClient,
  rawExtract: WorkbookExtract,
  opts: LoadOptions,
): Promise<ReconciliationReport> {
  const extract = extractSchema.parse(rawExtract);
  const today = opts.today ?? harareToday();
  const source = opts.source ?? 'WORKBOOK_IMPORT';
  const report: ReconciliationReport = {
    mode: opts.mode,
    scope: opts.methodologyOnly ? 'methodology' : 'all',
    sourceFile: extract.source.file,
    sourceSha256: extract.source.sha256,
    workbookVersion: extract.source.workbookVersion,
    methodVersion: extract.source.methodVersion,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    parameterSet: { version: extract.parameterSet.version, status: '', action: 'unchanged', contentHash: '' },
    tables: [],
    totals: [],
    checks: [],
    warnings: [],
    errors: [],
    ok: false,
  };
  const table = (name: string, sourceCount: number): TableReconciliation => {
    const t = {
      table: name,
      source: sourceCount,
      inserted: 0,
      unchanged: 0,
      updated: 0,
      refused: 0,
      inDatabase: 0,
    };
    report.tables.push(t);
    return t;
  };

  try {
    await db.$transaction(
      async (tx) => {
        const ps = await loadParameterSetStep(tx, extract, report, today);
        if (!opts.methodologyOnly) await loadRecords(tx, extract, ps, report, table, { source, today });
        report.ok = report.errors.length === 0 && report.checks.every((c) => c.ok);
        if (opts.mode === 'apply') {
          if (!report.ok) throw new Error('Import refused: see the errors and failed checks in the report');
          report.finishedAt = new Date().toISOString();
          await tx.importRun.create({
            data: {
              mode: opts.mode,
              sourceFile: extract.source.file,
              sourceSha256: extract.source.sha256,
              status: 'applied',
              finishedAt: new Date(),
              report: report as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.auditLog.create({
            data: {
              userId: opts.importedById ?? null,
              action: 'import.workbook',
              entityType: 'import',
              entityId: extract.source.sha256,
              after: { scope: report.scope, tables: report.tables } as unknown as Prisma.InputJsonValue,
            },
          });
        } else {
          throw new DryRunRollback();
        }
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) {
      if (report.errors.length === 0) report.errors.push(e instanceof Error ? e.message : String(e));
      report.ok = false;
    }
  }
  report.finishedAt ||= new Date().toISOString();
  return report;
}

// ---------------------------------------------------------------------------------------------
// Parameter set
// ---------------------------------------------------------------------------------------------

async function loadParameterSetStep(
  tx: Tx,
  extract: WorkbookExtract,
  report: ReconciliationReport,
  today: string,
) {
  const doc = extract.parameterSet;
  const hash = parameterSetHash(doc);
  report.parameterSet.contentHash = hash;
  const existing = await tx.parameterSet.findUnique({ where: { version: doc.version } });
  let id: string;
  if (existing) {
    if (existing.contentHash !== hash)
      throw new Error(
        `Parameter set ${doc.version} is already in the database with different rules. A changed methodology must ` +
          `carry a new Method_Version in the workbook, or be made as a new draft in Admin.`,
      );
    id = existing.id;
    report.parameterSet.status = existing.status;
  } else {
    id = (await createParameterSet(tx, doc, { notes: `Imported from ${extract.source.file}` })).id;
    report.parameterSet.action = 'created';
    // The first methodology becomes Active; later versions wait for IC approval in Admin.
    const active = await tx.parameterSet.findFirst({ where: { status: 'ACTIVE' } });
    if (!active) {
      await activateParameterSet(tx, id, { effectiveDate: today });
      report.parameterSet.status = 'ACTIVE';
    } else {
      await tx.parameterSet.update({ where: { id }, data: { status: 'PROPOSED', proposedAt: new Date() } });
      report.parameterSet.status = 'PROPOSED';
      report.warnings.push(
        `Parameter set ${doc.version} imported as PROPOSED; ${active.version} stays Active until an IC Approver activates the new set.`,
      );
    }
  }
  const proposedRows =
    doc.scalars.filter((s) => s.proposed).length +
    doc.structures.filter((s) => s.proposed).length +
    doc.questions.filter((q) => q.proposed).length;
  report.checks.push({
    name: 'Parameter set validates',
    ok: ParameterSet.validate(doc).length === 0,
    detail: `${doc.scalars.length} parameters, ${doc.modules.length} modules, ${doc.factors.length} factors, ${doc.subSectors.length} sub-sectors, ${doc.haircuts.length} haircuts, ${doc.questions.length} questions, ${doc.shocks.length} shocks; ${proposedRows} rows marked PROPOSED`,
  });
  return { id, engine: ParameterSet.parse(doc) };
}

// ---------------------------------------------------------------------------------------------
// Companies, deals, activity, ratings, overrides, changelog
// ---------------------------------------------------------------------------------------------

async function loadRecords(
  tx: Tx,
  extract: WorkbookExtract,
  ps: { id: string; engine: ParameterSet },
  report: ReconciliationReport,
  table: (name: string, n: number) => TableReconciliation,
  ctx: { source: 'WORKBOOK_IMPORT' | 'SEED'; today: string },
) {
  const events: ActivityEvent[] = extract.activity.map((e) => activityEventSchema.parse(e));

  // Companies: every registration number seen; name = latest seen (Deal Activity, then Deal History, then Ratings)
  const names = new Map<string, { regNo: string; name: string | null }>();
  const see = (reg: string | null, name: string | null) => {
    if (!reg) return;
    const k = regNoKey(reg);
    const cur = names.get(k);
    names.set(k, { regNo: cur?.regNo ?? reg.trim(), name: name ?? cur?.name ?? null });
  };
  for (const r of extract.ratings) see(r.ratingsRow['Reg number'], r.ratingsRow.Borrower);
  for (const h of extract.dealHistory) see(h.regNo, h.borrowerName);
  for (const b of extract.blacklist) see(b.regNo, b.borrowerName);
  for (const e of extract.activity) see(e.regNo, e.borrowerName);
  const sponsorRegs = extract.ratings.map((r) => r.inputs['Scorecard!C29']?.replace(/^S:/, '') ?? null);
  for (const s of sponsorRegs) see(s, null);
  const tCo = table('companies', names.size);
  const companyId = new Map<string, string>();
  for (const [key, { regNo, name }] of names) {
    const found = await tx.company.findUnique({ where: { regNoKey: key } });
    if (found) {
      tCo.unchanged++;
      companyId.set(key, found.id);
    } else {
      const c = await tx.company.create({
        data: { regNo, regNoKey: key, name: name ?? regNo, source: ctx.source },
      });
      tCo.inserted++;
      companyId.set(key, c.id);
    }
  }
  const coId = (reg: string | null) => (reg ? companyId.get(regNoKey(reg)) : undefined);

  // Deals: from the Ratings rows (latest rating per deal) and the Pipeline Register (stage)
  const dealIds = [
    ...new Set([
      ...extract.ratings.map((r) => r.ratingsRow['Deal ID']),
      ...extract.pipeline.map((p) => p.dealId),
    ]),
  ];
  const tDeals = table('deals', dealIds.length);
  const dealRef = new Map<string, string>();
  for (const id of dealIds) {
    const found = await tx.deal.findUnique({ where: { dealId: id } });
    if (found) {
      tDeals.unchanged++;
      dealRef.set(id, found.id);
      continue;
    }
    const rs = extract.ratings.filter((r) => r.ratingsRow['Deal ID'] === id);
    const latest = rs[rs.length - 1];
    const pipe = extract.pipeline.find((p) => p.dealId === id);
    const reg = latest?.ratingsRow['Reg number'] ?? null;
    const company = coId(reg);
    if (!company) {
      tDeals.refused++;
      report.errors.push(`Deal ${id}: no registration number found, cannot link it to a company`);
      continue;
    }
    const inp = latest?.inputs ?? {};
    const sponsor = inp['Scorecard!C29']?.replace(/^S:/, '') ?? null;
    const amount = latest?.inputs['Scorecard!C16']
      ? Number(latest.inputs['Scorecard!C16'].replace(/^N:/, ''))
      : (pipe?.amount ?? null);
    const tenor = inp['Scorecard!C19']?.startsWith('N:') ? Number(inp['Scorecard!C19'].slice(2)) : null;
    const d = await tx.deal.create({
      data: {
        dealId: id,
        companyId: company,
        sponsorCompanyId: coId(sponsor) ?? null,
        facilityType: pipe?.facility ?? inp['Scorecard!C15']?.replace(/^S:/, '') ?? null,
        amount,
        tenorMonths: tenor,
        moduleCode: latest?.ratingsRow.Module ?? pipe?.sectorModule?.split(' - ')[0] ?? null,
        track: latest?.ratingsRow.Track ?? pipe?.track ?? null,
        stage: pipe?.stage ?? 'Pipeline Deals',
        legacyPdfPath: pipe?.pdfPath ?? null,
        source: ctx.source,
      },
    });
    tDeals.inserted++;
    dealRef.set(id, d.id);
  }

  // Deal Activity
  const tAct = table('deal_activity', extract.activity.length);
  for (const e of extract.activity) {
    if (await tx.dealActivity.findUnique({ where: { entryId: e.entryId } })) {
      tAct.unchanged++;
      continue;
    }
    const company = coId(e.regNo)!;
    await tx.dealActivity.create({
      data: {
        entryId: e.entryId,
        companyId: company,
        regNo: e.regNo,
        borrowerName: e.borrowerName,
        dealRef: e.dealId ? (dealRef.get(e.dealId) ?? null) : null,
        dealId: e.dealId,
        eventType: e.event,
        eventDate: toDbDate(e.eventDate)!,
        dueDate: toDbDate(e.dueDate),
        amountDue: e.amountDue,
        amountPaid: e.amountPaid,
        daysLate: e.daysLate,
        notes: e.notes,
        enteredAt: harareToInstant(e.enteredOn) ?? new Date(),
        enteredByText: e.enteredBy,
        source: ctx.source,
      },
    });
    tAct.inserted++;
  }

  // The stored Deal History and Blacklist must be what the events derive (as of each row's recalculation date)
  const dhMismatch: string[] = [];
  for (const h of extract.dealHistory) {
    const m = /updated (\d{2}) (\w{3}) (\d{4})/.exec(h.notes ?? '');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const asOf = m ? `${m[3]}-${String(months.indexOf(m[2]!) + 1).padStart(2, '0')}-${m[1]}` : ctx.today;
    const d = h.dealId ? deriveDeal(events, h.dealId, asOf) : null;
    if (
      !d ||
      d.status !== h.status ||
      d.maxDpd !== h.maxDpd ||
      d.maturityDate !== h.maturityDate ||
      d.regNo !== h.regNo
    )
      dhMismatch.push(
        `${h.dealId ?? h.regNo}: sheet "${h.status}" (${h.maxDpd} DPD), derived "${d?.status ?? 'none'}" (${d?.maxDpd ?? '-'} DPD)`,
      );
  }
  report.checks.push({
    name: 'Deal History sheet = derived from Deal Activity',
    ok: dhMismatch.length === 0,
    detail: dhMismatch.length
      ? dhMismatch.join('; ')
      : `${extract.dealHistory.length} of ${extract.dealHistory.length} rows reproduced`,
  });
  if (dhMismatch.length)
    report.warnings.push(
      'Deal History rows that do not come from Deal Activity are not imported; record them as opening-balance history (D-33).',
    );
  const blNow = deriveBlacklist(events, ctx.today);
  const blMismatch = extract.blacklist.filter(
    (b) => !blNow.some((x) => regNoKey(x.regNo) === regNoKey(b.regNo) && x.status === b.status),
  );
  report.checks.push({
    name: 'Blacklist sheet = derived from Deal Activity',
    ok: blMismatch.length === 0,
    detail: blMismatch.length
      ? blMismatch.map((b) => `${b.regNo} ${b.status}`).join('; ')
      : `${extract.blacklist.length} of ${extract.blacklist.length} entries reproduced (${blNow.filter((b) => b.status === 'Active').length} active today)`,
  });

  // Ratings: re-run each through the engine with history as at its rating date, then store
  const tR = table('ratings', extract.ratings.length);
  const tIn = table('rating_inputs', extract.ratings.length);
  const tRes = table('rating_results', extract.ratings.length);
  const tChk = table('rating_checks', extract.ratings.length * ps.engine.num('Checks_Total'));
  const ratingRef = new Map<string, { id: string; result: RatingResult }>();
  for (const { ratingsRow: row, inputs } of extract.ratings) {
    const rid = row['Rating ID'];
    const existing = await tx.rating.findUnique({ where: { ratingId: rid }, include: { result: true } });
    const { input, warnings } = inputFromWorkbookCells(inputs, ps.engine);
    for (const w of warnings) report.warnings.push(`${rid}: ${w}`);
    const asOf = row['Rating date'] ?? ctx.today;
    const regs = [input.deal.regNo, input.deal.sponsorRegNo].filter((x): x is string => !!x).map(regNoKey);
    const snapshot = parseHistorySnapshot({
      asOf,
      rows: deriveDealHistory(events, asOf)
        .filter((h) => regs.includes(regNoKey(h.regNo)))
        .map((h) => ({ regNo: h.regNo, dealId: h.dealId, status: h.status, maturityDate: h.maturityDate })),
      blacklist: deriveBlacklist(events, asOf)
        .filter((b) => regs.includes(regNoKey(b.regNo)))
        .map((b) => ({ regNo: b.regNo, status: b.status })),
    });
    const result = rate(input, ps.engine, snapshot);
    const diffs = COMPARE.flatMap(([col, get]) => {
      const saved = row[col] as number | string | null;
      const now = get(result);
      const ok =
        typeof saved === 'number' || typeof now === 'number'
          ? sameNum(saved as number | null, now as number | null)
          : (saved ?? null) === (now ?? null);
      const show = (x: unknown) => (typeof x === 'number' ? excelGeneral(x) : JSON.stringify(x));
      return ok ? [] : [`${col}: workbook ${show(saved)}, engine ${show(now)}`];
    });
    if (row['Methodology version'] !== ps.engine.doc.methodVersion)
      diffs.push(
        `saved under methodology ${row['Methodology version']}, importing with ${ps.engine.doc.methodVersion}`,
      );
    if (diffs.length) {
      tR.refused++;
      tIn.refused++;
      tRes.refused++;
      tChk.refused += ps.engine.num('Checks_Total');
      report.errors.push(`Rating ${rid} does not reproduce: ${diffs.join('; ')}`);
      continue;
    }
    if (existing) {
      tR.unchanged++;
      tIn.unchanged++;
      tRes.unchanged++;
      tChk.unchanged += ps.engine.num('Checks_Total');
      ratingRef.set(rid, { id: existing.id, result });
      continue;
    }
    const isFinal = row.Status === 'Final';
    const savedAt = harareToInstant(row['Saved at']) ?? new Date();
    const deal = dealRef.get(row['Deal ID'])!;
    const created = await tx.rating.create({
      data: {
        ratingId: rid,
        dealRef: deal,
        companyId: coId(row['Reg number'])!,
        ratingType: row['Rating type'] ?? 'New',
        status: 'DRAFT', // set below, after its inputs and results are written
        analystName: row.Analyst,
        reviewerName: row.Reviewer,
        ratingDate: toDbDate(row['Rating date']),
        savedAt,
        finalisedAt: isFinal ? savedAt : null,
        parameterSetId: ps.id,
        methodVersion: ps.engine.doc.methodVersion,
        workbookVersion: extract.source.workbookVersion,
        engineVersion: ENGINE_VERSION,
        inputSchemaVersion: input.schemaVersion,
        source: ctx.source,
        moduleCode: input.deal.moduleCode,
        track: result.deal.track,
        blendedScore: result.blendedScore,
        obligorModel: result.obligor.model,
        obligorFinal: result.obligor.final,
        facilityModel: result.facility.model,
        facilityFinal: result.facility.final,
        pd: result.pd,
        lgd: result.collateral.lgd,
        ead: result.deal.ead,
        elUsd: result.elUsd,
        elPct: result.elPct,
        recommendation: result.recommendation,
        overridden: result.override.applied,
        historyEnabled: row['Deal History on'] === 'Yes',
        reviewCycle: result.reviewCycle,
        nextReviewDate: toDbDate(result.nextReviewDate),
        checksErrors: result.checks.filter((c) => c.status === 'Error').length,
        checksWarnings: result.checks.filter((c) => c.status === 'Warning').length,
        knockouts: Object.entries(result.knockouts)
          .filter(([, v]) => v === 'Knockout' || v === 'Decline')
          .map(([k]) => k),
      },
    });
    await insertRatingInput(tx, created.id, input, snapshot);
    await upsertRatingResult(tx, created.id, result, ENGINE_VERSION);
    await tx.ratingCheck.createMany({
      data: result.checks.map((c) => ({
        ratingRef: created.id,
        checkNo: c.no,
        name: c.name,
        status: c.status,
        detail: c.detail,
      })),
    });
    if (isFinal) await tx.rating.update({ where: { id: created.id }, data: { status: 'FINAL' } });
    tR.inserted++;
    tIn.inserted++;
    tRes.inserted++;
    tChk.inserted += result.checks.length;
    ratingRef.set(rid, { id: created.id, result });
  }
  report.checks.push({
    name: 'Saved ratings reproduce through the engine (history as at rating date)',
    ok: tR.refused === 0,
    detail: `${extract.ratings.length - tR.refused} of ${extract.ratings.length} reproduce exactly`,
  });

  // A newer Final rating of the same deal supersedes the older one (D-04)
  const finals = await tx.rating.findMany({
    where: { status: { in: ['FINAL', 'SUPERSEDED'] } },
    orderBy: [{ ratingDate: 'asc' }, { savedAt: 'asc' }],
    select: { id: true, dealRef: true, status: true, ratingId: true },
  });
  const byDeal = new Map<string, typeof finals>();
  for (const f of finals) byDeal.set(f.dealRef, [...(byDeal.get(f.dealRef) ?? []), f]);
  let superseded = 0;
  for (const list of byDeal.values())
    for (let i = 0; i < list.length - 1; i++)
      if (list[i]!.status === 'FINAL') {
        await tx.rating.update({
          where: { id: list[i]!.id },
          data: { status: 'SUPERSEDED', supersededById: list[i + 1]!.id },
        });
        superseded++;
      }
  if (superseded)
    report.warnings.push(
      `${superseded} older Final rating(s) marked Superseded by a later Final rating of the same deal (D-04).`,
    );

  // Override Log
  const tOv = table('overrides', extract.overrideLog.length);
  const maxNoApproval = ps.engine.num('Ovr_MaxNoApproval');
  for (const o of extract.overrideLog) {
    const r = ratingRef.get(o.ratingId);
    if (!r) {
      tOv.refused++;
      report.errors.push(`Override Log row for ${o.ratingId}: rating not imported`);
      continue;
    }
    const res = o.grade === 'Obligor' ? r.result.obligor : r.result.facility;
    if (res.model !== o.modelGrade || res.final !== o.finalGrade) {
      tOv.refused++;
      report.errors.push(
        `Override Log row for ${o.ratingId} (${o.grade}): log ${o.modelGrade}→${o.finalGrade}, rating ${res.model}→${res.final}`,
      );
      continue;
    }
    if (
      await tx.override.findUnique({
        where: { ratingRef_gradeType: { ratingRef: r.id, gradeType: o.grade } },
      })
    ) {
      tOv.unchanged++;
      continue;
    }
    await tx.override.create({
      data: {
        ratingRef: r.id,
        gradeType: o.grade,
        modelGrade: o.modelGrade,
        finalGrade: o.finalGrade,
        notches: o.notches,
        reason: o.reason ?? '(no reason recorded)',
        loggedOn: toDbDate(o.date) ?? new Date(),
        analystName: o.analyst,
        approvalStatus: Math.abs(o.notches) > maxNoApproval ? 'APPROVED' : 'NOT_REQUIRED',
        approverNameText: o.approvedBy,
        approvalDate: toDbDate(o.approvalDate),
        source: ctx.source,
      },
    });
    tOv.inserted++;
  }
  const overriddenRatings = [...ratingRef.entries()]
    .filter(([, r]) => r.result.override.applied)
    .map(([id]) => id);
  const logged = new Set(extract.overrideLog.map((o) => o.ratingId));
  const unlogged = overriddenRatings.filter((id) => !logged.has(id));
  report.checks.push({
    name: 'Every overridden rating has an Override Log row',
    ok: unlogged.length === 0,
    detail: unlogged.length
      ? `Not in the log: ${unlogged.join(', ')}`
      : `${overriddenRatings.length} overridden rating(s), all logged`,
  });

  // Pipeline Register: the deal rows carry the stage; check the register agrees with the latest Final rating
  const pipeIssues: string[] = [];
  for (const p of extract.pipeline) {
    const latest = [...extract.ratings]
      .reverse()
      .find((r) => r.ratingsRow['Deal ID'] === p.dealId && r.ratingsRow.Status === 'Final');
    if (!latest) continue;
    const res = ratingRef.get(latest.ratingsRow['Rating ID'])?.result;
    if (!res) continue;
    if (
      res.facility.final !== p.facilityGrade ||
      res.obligor.final !== p.obligorGrade ||
      res.recommendation !== p.recommendation
    )
      pipeIssues.push(`${p.dealId}: register shows obligor ${p.obligorGrade}, facility ${p.facilityGrade}`);
  }
  report.checks.push({
    name: 'Pipeline Register agrees with each deal’s latest Final rating',
    ok: pipeIssues.length === 0,
    detail: pipeIssues.length ? pipeIssues.join('; ') : `${extract.pipeline.length} register row(s) agree`,
  });

  // Changelog
  const tCl = table('changelog', extract.changelog.length);
  for (const c of extract.changelog) {
    const found = await tx.changelogEntry.findUnique({
      where: { version_date: { version: c.version, date: c.date } },
    });
    if (found) tCl.unchanged++;
    else {
      await tx.changelogEntry.create({ data: c });
      tCl.inserted++;
    }
  }

  // Row counts in the database (records from this kind of source) and money totals: source against database
  const src = { source: ctx.source };
  tCo.inDatabase = await tx.company.count({ where: src });
  tDeals.inDatabase = await tx.deal.count({ where: src });
  tAct.inDatabase = await tx.dealActivity.count({ where: src });
  tR.inDatabase = await tx.rating.count({ where: src });
  tIn.inDatabase = await tx.ratingInput.count({ where: { rating: src } });
  tRes.inDatabase = await tx.ratingResult.count({ where: { rating: src } });
  tChk.inDatabase = await tx.ratingCheck.count({ where: { rating: src } });
  tOv.inDatabase = await tx.override.count({ where: src });
  tCl.inDatabase = await tx.changelogEntry.count();

  const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
  const dbRatings = await tx.rating.findMany({
    where: { ...src, ratingId: { in: extract.ratings.map((r) => r.ratingsRow['Rating ID']) } },
  });
  const dbAct = await tx.dealActivity.findMany({
    where: { ...src, entryId: { in: extract.activity.map((a) => a.entryId) } },
  });
  const total = (name: string, s: number, d: number) =>
    report.totals.push({ name, source: s, database: d, matches: Math.abs(s - d) <= 0.005 });
  total(
    'Ratings: EL US$',
    sum(extract.ratings.map((r) => r.ratingsRow['EL USD'])),
    sum(dbRatings.map((r) => r.elUsd)),
  );
  total(
    'Ratings: EAD US$',
    sum(extract.ratings.map((r) => r.ratingsRow['EAD USD'])),
    sum(dbRatings.map((r) => r.ead)),
  );
  total(
    'Ratings: facility grades (sum)',
    sum(extract.ratings.map((r) => r.ratingsRow['Facility final'])),
    sum(dbRatings.map((r) => r.facilityFinal)),
  );
  total(
    'Deal Activity: amount paid US$',
    sum(extract.activity.map((a) => a.amountPaid)),
    sum(dbAct.map((a) => (a.amountPaid === null ? 0 : Number(a.amountPaid)))),
  );
  total(
    'Deal Activity: amount due US$',
    sum(extract.activity.map((a) => a.amountDue)),
    sum(dbAct.map((a) => (a.amountDue === null ? 0 : Number(a.amountDue)))),
  );
  for (const t of report.totals)
    if (!t.matches)
      report.errors.push(`Total "${t.name}" differs: source ${t.source}, database ${t.database}`);
  for (const t of report.tables)
    if (t.source !== t.inserted + t.unchanged + t.updated + t.refused)
      report.errors.push(
        `Table ${t.table}: ${t.source} source rows but ${t.inserted + t.unchanged + t.updated + t.refused} accounted for`,
      );
}
