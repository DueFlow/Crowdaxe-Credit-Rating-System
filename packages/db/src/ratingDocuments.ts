/**
 * Writing rating documents (inputs, history snapshot, engine result) with full double precision.
 *
 * Prisma's JSON write path rounds numbers to 15 significant digits (0.10000000000000002 becomes 0.1), which
 * would make a stored result differ, in the last bit, from what the engine produced and from a re-run.
 * These helpers send the exact JSON text and cast it to jsonb in SQL; reading back through Prisma is exact.
 * Always use them for rating documents.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export async function insertRatingInput(
  db: Db,
  ratingRef: string,
  inputs: unknown,
  historySnapshot: unknown,
  updatedById?: string | null,
) {
  await db.$executeRaw`
    INSERT INTO rating_inputs (rating_ref, inputs, history_snapshot, revision, updated_at, updated_by)
    VALUES (${ratingRef}::uuid, ${JSON.stringify(inputs)}::jsonb, ${JSON.stringify(historySnapshot)}::jsonb, 1, now(), ${updatedById ?? null}::uuid)`;
}

export async function updateRatingInput(
  db: Db,
  ratingRef: string,
  inputs: unknown,
  historySnapshot: unknown,
  updatedById?: string | null,
) {
  await db.$executeRaw`
    UPDATE rating_inputs SET inputs = ${JSON.stringify(inputs)}::jsonb, history_snapshot = ${JSON.stringify(historySnapshot)}::jsonb,
      revision = revision + 1, updated_at = now(), updated_by = ${updatedById ?? null}::uuid
    WHERE rating_ref = ${ratingRef}::uuid`;
}

export async function upsertRatingResult(db: Db, ratingRef: string, result: unknown, engineVersion: string) {
  await db.$executeRaw`
    INSERT INTO rating_results (rating_ref, result, engine_version, computed_at)
    VALUES (${ratingRef}::uuid, ${JSON.stringify(result)}::jsonb, ${engineVersion}, now())
    ON CONFLICT (rating_ref) DO UPDATE SET result = EXCLUDED.result, engine_version = EXCLUDED.engine_version, computed_at = now()`;
}
