/** Date helpers for the database layer: ISO dates ↔ PostgreSQL DATE (UTC midnight) and Harare local time. */

export const toDbDate = (iso: string | null | undefined): Date | null =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null;
export const fromDbDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** A workbook date-time ("2026-01-12T10:14:22", Harare local time, UTC+2 all year) as an instant. */
export function harareToInstant(local: string | null | undefined): Date | null {
  if (!local) return null;
  const t = local.length === 10 ? `${local}T00:00:00` : local;
  return new Date(`${t}+02:00`);
}

/** Today's date in Harare. */
export function harareToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}
