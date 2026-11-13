/**
 * Parameter sets in the database ↔ the engine's ParameterSetDoc. Saving then loading returns an identical
 * document (tested), so a rating re-run from the database uses exactly the rules it was saved with.
 */
import { createHash } from 'node:crypto';
import { ParameterSet, type ParameterSetDoc, parameterSetSchema } from '@crowdaxe/engine';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Stable JSON (sorted keys) so the hash does not depend on key order. */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

/** SHA-256 of the canonical document, ignoring its `source` note. */
export function parameterSetHash(doc: ParameterSetDoc): string {
  const { source: _source, ...rest } = doc;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/**
 * Write a parameter set as a DRAFT with all its tables (the database only allows table rows to change
 * while a set is a draft). The caller then moves it on (propose, approve, activate).
 */
export async function createParameterSet(
  db: Db,
  raw: ParameterSetDoc,
  opts: { notes?: string; createdById?: string; clonedFromId?: string } = {},
): Promise<{ id: string; contentHash: string }> {
  const doc = parameterSetSchema.parse(raw);
  const contentHash = parameterSetHash(doc);
  const set = await db.parameterSet.create({
    data: {
      version: doc.version,
      methodVersion: doc.methodVersion,
      workbookVersion: doc.workbookVersion,
      source: doc.source ?? null,
      status: 'DRAFT',
      contentHash,
      notes: opts.notes ?? null,
      createdById: opts.createdById ?? null,
      clonedFromId: opts.clonedFromId ?? null,
    },
  });
  const setId = set.id;
  await db.parameter.createMany({
    data: doc.scalars.map((s, sort) => ({
      setId,
      name: s.name,
      valueNum: typeof s.value === 'number' ? s.value : null,
      valueText: typeof s.value === 'string' ? s.value : null,
      unit: s.unit,
      ref: s.ref,
      note: s.note,
      proposed: s.proposed,
      origin: s.origin ?? null,
      sort,
    })),
  });
  await db.ratingScaleRow.createMany({ data: doc.ratingScale.map((r) => ({ setId, ...r })) });
  await db.overlay.createMany({
    data: doc.overlays.map((o) => ({
      setId,
      ord: o.ord,
      name: o.name,
      maxNotches: o.maxNotches,
      descriptor0: o.descriptors[0] ?? null,
      descriptor1: o.descriptors[1] ?? null,
      descriptor2: o.descriptors[2] ?? null,
    })),
  });
  await db.structure.createMany({ data: doc.structures.map((s, sort) => ({ setId, ...s, sort })) });
  await db.module.createMany({ data: doc.modules.map((m, sort) => ({ setId, ...m, sort })) });
  await db.factor.createMany({
    data: doc.factors.map((f, sort) => ({
      setId,
      sort,
      key: f.key,
      setCode: f.set,
      ord: f.ord,
      pillar: f.pillar,
      profile: f.profile,
      name: f.name,
      weight: f.weight,
      measure: f.measure,
      unit: f.unit,
      type: f.type,
      direction: f.dir,
      scale: f.scale,
      nb: f.nb,
      bounds: f.bounds,
      fFlags: f.fFlags,
      neg: f.neg,
      groupCode: f.group,
      optional: f.optional,
      trackOnly: f.trackOnly,
      role: f.role,
      link: f.link,
      ref: f.ref,
      autoCode: f.auto,
      legacyTopCut: f.legacy?.topCut ?? null,
      legacyBotCut: f.legacy?.botCut ?? null,
      legacyJudge: f.legacy?.judge ?? null,
    })),
  });
  await db.factorDescriptor.createMany({
    data: doc.factors.flatMap((f) =>
      f.descriptors.flatMap((text, i) =>
        text === null ? [] : [{ setId, factorKey: f.key, band: i + 1, text }],
      ),
    ),
  });
  await db.subSector.createMany({
    data: doc.subSectors.map((s, sort) => ({
      setId,
      sort,
      setCode: s.set,
      ord: s.ord,
      name: s.name,
      gradeLow: s.gradeLow,
      gradeHigh: s.gradeHigh,
      special: s.special,
    })),
  });
  await db.collateralHaircut.createMany({
    data: doc.haircuts.map((h, sort) => ({
      setId,
      sort,
      setCode: h.set,
      ord: h.ord,
      name: h.name,
      haircutLow: h.low,
      haircutHigh: h.high,
      crossBorderAddOn: h.crossBorderAddOn,
      ref: h.ref,
      linkedCoreOrd: h.linkedCoreOrd,
    })),
  });
  await db.sectorQuestion.createMany({
    data: doc.questions.map((q, sort) => ({
      setId,
      sort,
      moduleCode: q.module,
      ord: q.ord,
      kind: q.kind,
      question: q.question,
      flagAnswer: q.flagAnswer,
      targetFactorKey: q.target,
      modifierType: q.modifierType,
      modifierValue: q.modifierValue,
      ref: q.ref,
      proposed: q.proposed,
    })),
  });
  await db.stressShock.createMany({
    data: doc.shocks.map((s, sort) => ({
      setId,
      sort,
      moduleCode: s.module,
      ord: s.ord,
      name: s.name,
      sizeText: s.size,
      ref: s.ref,
      costType: s.costType,
      defaultValue: s.defaultValue,
    })),
  });
  await db.listItem.createMany({
    data: Object.entries(doc.lists).flatMap(([listCode, items]) =>
      items.map((label, sort) => ({ setId, listCode, sort, label })),
    ),
  });
  return { id: setId, contentHash };
}

/** Rebuild the engine document of a stored parameter set. */
export async function loadParameterSetDoc(db: Db, setId: string): Promise<ParameterSetDoc> {
  const set = await db.parameterSet.findUniqueOrThrow({
    where: { id: setId },
    include: {
      parameters: { orderBy: { sort: 'asc' } },
      ratingScale: { orderBy: { grade: 'asc' } },
      overlays: { orderBy: { ord: 'asc' } },
      structures: { orderBy: { sort: 'asc' } },
      modules: { orderBy: { sort: 'asc' } },
      factors: { orderBy: { sort: 'asc' } },
      descriptors: true,
      subSectors: { orderBy: { sort: 'asc' } },
      haircuts: { orderBy: { sort: 'asc' } },
      questions: { orderBy: { sort: 'asc' } },
      shocks: { orderBy: { sort: 'asc' } },
      listItems: { orderBy: [{ listCode: 'asc' }, { sort: 'asc' }] },
    },
  });
  const desc = new Map(set.descriptors.map((d) => [`${d.factorKey}|${d.band}`, d.text]));
  const lists: Record<string, string[]> = {};
  for (const li of set.listItems) (lists[li.listCode] ??= []).push(li.label);

  const doc = {
    version: set.version,
    methodVersion: set.methodVersion,
    workbookVersion: set.workbookVersion,
    ...(set.source === null ? {} : { source: set.source }),
    scalars: set.parameters.map((p) => ({
      name: p.name,
      value: p.valueNum ?? p.valueText ?? null,
      unit: p.unit,
      ref: p.ref,
      note: p.note,
      proposed: p.proposed,
      origin: p.origin,
    })),
    ratingScale: set.ratingScale.map(({ setId: _s, ...r }) => r),
    overlays: set.overlays.map((o) => ({
      ord: o.ord,
      name: o.name,
      maxNotches: o.maxNotches,
      descriptors: [o.descriptor0, o.descriptor1, o.descriptor2],
    })),
    structures: set.structures.map(({ setId: _s, sort: _o, ...s }) => s),
    modules: set.modules.map(({ setId: _s, sort: _o, ...m }) => m),
    factors: set.factors.map((f) => ({
      set: f.setCode,
      ord: f.ord,
      key: f.key,
      pillar: f.pillar,
      profile: f.profile,
      name: f.name,
      weight: f.weight,
      measure: f.measure,
      unit: f.unit,
      type: f.type,
      dir: f.direction,
      scale: f.scale,
      nb: f.nb,
      bounds: f.bounds,
      fFlags: f.fFlags,
      neg: f.neg,
      group: f.groupCode,
      optional: f.optional,
      trackOnly: f.trackOnly,
      role: f.role,
      link: f.link,
      descriptors: [1, 2, 3, 4, 5].map((b) => desc.get(`${f.key}|${b}`) ?? null),
      ref: f.ref,
      auto: f.autoCode,
      legacy: { topCut: f.legacyTopCut, botCut: f.legacyBotCut, judge: f.legacyJudge },
    })),
    subSectors: set.subSectors.map((s) => ({
      set: s.setCode,
      ord: s.ord,
      name: s.name,
      gradeLow: s.gradeLow,
      gradeHigh: s.gradeHigh,
      special: s.special,
    })),
    haircuts: set.haircuts.map((h) => ({
      set: h.setCode,
      ord: h.ord,
      name: h.name,
      low: h.haircutLow,
      high: h.haircutHigh,
      crossBorderAddOn: h.crossBorderAddOn,
      ref: h.ref,
      linkedCoreOrd: h.linkedCoreOrd,
    })),
    questions: set.questions.map((q) => ({
      module: q.moduleCode,
      ord: q.ord,
      key: `${q.moduleCode}|${q.ord}`,
      kind: q.kind,
      question: q.question,
      flagAnswer: q.flagAnswer,
      target: q.targetFactorKey,
      modifierType: q.modifierType,
      modifierValue: q.modifierValue,
      ref: q.ref,
      proposed: q.proposed,
    })),
    shocks: set.shocks.map((s) => ({
      module: s.moduleCode,
      ord: s.ord,
      key: `${s.moduleCode}|${s.ord}`,
      name: s.name,
      size: s.sizeText,
      ref: s.ref,
      costType: s.costType,
      defaultValue: s.defaultValue,
    })),
    lists,
  };
  return parameterSetSchema.parse(doc);
}

/** The engine ParameterSet for a stored set. */
export async function loadParameterSet(db: Db, setId: string): Promise<ParameterSet> {
  return ParameterSet.parse(await loadParameterSetDoc(db, setId));
}

export async function getActiveParameterSetId(db: Db): Promise<string | null> {
  const s = await db.parameterSet.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
  return s?.id ?? null;
}

/** Make a set Active (retiring the current one), in one statement order the unique index accepts. */
export async function activateParameterSet(
  db: Db,
  setId: string,
  opts: { effectiveDate: string; activatedById?: string },
): Promise<void> {
  const now = new Date();
  await db.parameterSet.updateMany({
    where: { status: 'ACTIVE', NOT: { id: setId } },
    data: { status: 'RETIRED', retiredAt: now },
  });
  await db.parameterSet.update({
    where: { id: setId },
    data: {
      status: 'ACTIVE',
      effectiveDate: new Date(`${opts.effectiveDate}T00:00:00Z`),
      activatedAt: now,
      activatedById: opts.activatedById ?? null,
    },
  });
}
