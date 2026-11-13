/**
 * Deal History and Blacklist for a rating, derived live from Deal Activity (D-02) plus opening-balance
 * records (D-33), as at a date. The result is the snapshot stored with the rating (D-01).
 */
import {
  type ActivityEvent,
  activityEventSchema,
  deriveBlacklist,
  deriveDealHistory,
  type HistorySnapshot,
  regNoKey,
} from '@crowdaxe/engine';
import type { Prisma, PrismaClient } from '@prisma/client';
import { fromDbDate } from './dates.js';

type Db = PrismaClient | Prisma.TransactionClient;

export function toActivityEvent(e: {
  entryId: string;
  regNo: string;
  borrowerName: string | null;
  dealId: string | null;
  eventType: string;
  eventDate: Date;
  dueDate: Date | null;
  amountDue: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  daysLate: number | null;
  notes: string | null;
}): ActivityEvent {
  return activityEventSchema.parse({
    entryId: e.entryId,
    regNo: e.regNo,
    borrowerName: e.borrowerName,
    dealId: e.dealId,
    event: e.eventType,
    eventDate: fromDbDate(e.eventDate),
    dueDate: fromDbDate(e.dueDate),
    amountDue: e.amountDue === null ? null : Number(e.amountDue),
    amountPaid: e.amountPaid === null ? null : Number(e.amountPaid),
    daysLate: e.daysLate,
    notes: e.notes,
  });
}

/** Snapshot of Deal History rows and blacklist status for the given registration numbers, as at `asOf`. */
export async function historySnapshotFor(
  db: Db,
  regNos: (string | null | undefined)[],
  asOf: string,
): Promise<HistorySnapshot> {
  const keys = [...new Set(regNos.map(regNoKey).filter((k) => k !== ''))];
  if (keys.length === 0) return { asOf, rows: [], blacklist: [] };
  const companies = await db.company.findMany({ where: { regNoKey: { in: keys } }, select: { id: true } });
  const ids = companies.map((c) => c.id);
  const events = (
    await db.dealActivity.findMany({
      where: { companyId: { in: ids }, deletedAt: null },
      orderBy: [{ enteredAt: 'asc' }, { entryId: 'asc' }],
    })
  ).map(toActivityEvent);
  const manual = await db.manualHistoryRecord.findMany({
    where: { companyId: { in: ids }, deletedAt: null },
  });
  const rows = [
    ...deriveDealHistory(events, asOf).map((h) => ({
      regNo: h.regNo,
      dealId: h.dealId,
      status: h.status,
      maturityDate: h.maturityDate,
    })),
    ...manual.map((m) => ({
      regNo: m.regNo,
      dealId: m.dealRef,
      status: m.status,
      maturityDate: fromDbDate(m.maturityDate),
    })),
  ].filter((r) => keys.includes(regNoKey(r.regNo)));
  const blacklist = deriveBlacklist(events, asOf)
    .filter((b) => keys.includes(regNoKey(b.regNo)))
    .map((b) => ({ regNo: b.regNo, status: b.status }));
  return { asOf, rows, blacklist };
}
