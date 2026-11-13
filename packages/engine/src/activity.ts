/**
 * Deal Activity → Deal History and Blacklist (methodology-spec.md section 13), override rate (section 14)
 * and Deal IDs (section 20). Pure functions: the caller passes the events and the as-of date.
 *
 * Approved change D-02: the as-of date is "today" whenever the history is read, so days past due on an
 * unpaid instalment keep growing and a deal moves to Defaulted after 90 days without anyone touching it.
 * The workbook only recalculated when an event was added; passing the recalculation date reproduces it.
 */
import { z } from 'zod';
import { daysBetween, fmtPercent, isIsoDate } from './excel.js';
import { regNoKey } from './inputs.js';

export const EVENT_TYPES = [
  'Disbursement',
  'Payment received',
  'Payment missed',
  'Restructured',
  'Default',
  'Repaid in full (transaction completed)',
  'Written off',
  'Blacklisted',
  'Blacklist lifted',
  'Note',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const isoDate = z.string().refine(isIsoDate, 'Use a valid date in the form yyyy-mm-dd');

export const activityEventSchema = z.object({
  entryId: z.string(),
  regNo: z.string(),
  borrowerName: z.string().nullable().default(null),
  dealId: z.string().nullable().default(null),
  event: z.enum(EVENT_TYPES),
  eventDate: isoDate,
  dueDate: isoDate.nullable().default(null),
  amountDue: z.number().nullable().default(null),
  amountPaid: z.number().nullable().default(null),
  daysLate: z.number().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

/** Deal History statuses in the workbook's list order (`lst_HistStatus`). */
export const HISTORY_STATUSES = [
  'Repaid on time',
  'Repaid late, max DPD 1-30',
  'Repaid late, 31-90',
  'Restructured',
  'Defaulted',
  'Live, current',
  'Live, in arrears',
] as const;

const NEEDS_DEAL = (e: EventType) => !(e === 'Blacklisted' || e === 'Blacklist lifted' || e === 'Note');
const same = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export interface NewEventInput {
  regNo: string | null;
  dealId: string | null;
  event: string | null;
  eventDate: string | null;
  dueDate: string | null;
  amountPaid: number | null;
  notes: string | null;
}

/**
 * Validation of a new Deal Activity entry (`modActivity.AddActivity`). Returns the problems in plain
 * English; empty means the entry can be saved. `ownerOfDeal` is the registration number the Deal ID
 * already belongs to, if any.
 */
export function validateActivityEvent(e: NewEventInput, today: string, ownerOfDeal: string | null): string[] {
  const msg: string[] = [];
  const ev = e.event as EventType | null;
  if (!e.regNo?.trim()) msg.push('Enter the company registration number.');
  if (!ev) msg.push('Choose the event.');
  if (!e.eventDate || !isIsoDate(e.eventDate)) msg.push('Enter the event date.');
  if (ev && NEEDS_DEAL(ev) && !e.dealId?.trim()) msg.push('Enter the Deal ID.');
  if ((ev === 'Payment received' || ev === 'Payment missed') && !(e.dueDate && isIsoDate(e.dueDate)))
    msg.push('Enter the date the payment was due.');
  if (ev === 'Payment received' && e.amountPaid === null) msg.push('Enter the amount paid.');
  if (ev === 'Disbursement' && e.amountPaid === null) msg.push('Enter the amount disbursed.');
  if ((ev === 'Blacklisted' || ev === 'Blacklist lifted') && !e.notes?.trim())
    msg.push('Give the reason in Notes.');
  if (e.dealId?.trim() && ownerOfDeal && regNoKey(ownerOfDeal) !== regNoKey(e.regNo))
    msg.push(`Deal ${e.dealId.trim()} belongs to registration number ${ownerOfDeal}.`);
  if (e.eventDate && isIsoDate(e.eventDate) && daysBetween(today, e.eventDate) > 1)
    msg.push('The event date is in the future.');
  return msg;
}

/** Days late for Payment received and Payment missed: event date − due date, never negative. */
export function daysLate(event: string, eventDate: string, dueDate: string | null): number | null {
  if ((event !== 'Payment received' && event !== 'Payment missed') || !dueDate) return null;
  return Math.max(0, daysBetween(dueDate, eventDate));
}

export interface DerivedHistoryRow {
  regNo: string;
  borrowerName: string | null;
  dealId: string;
  disbursementDate: string | null;
  maturityDate: string | null;
  amount: number | null;
  status: (typeof HISTORY_STATUSES)[number];
  maxDpd: number;
}

/** One deal's Deal History row from its events (`RecalculateDeal`), as at `asOf`. Null if only notes. */
export function deriveDeal(events: ActivityEvent[], dealId: string, asOf: string): DerivedHistoryRow | null {
  const rows = events.filter((e) => same(e.dealId, dealId) && e.eventDate <= asOf);
  let n = 0;
  let regNo = '';
  let name: string | null = null;
  let disb: string | null = null;
  let mat: string | null = null;
  let amount: number | null = null;
  let maxDpd = 0;
  let hasDefault = false;
  let hasRestr = false;
  let hasRepaid = false;
  let inArrears = false;
  for (const e of rows) {
    if (!regNo) regNo = e.regNo;
    if (e.borrowerName) name = e.borrowerName;
    switch (e.event) {
      case 'Disbursement':
        n++;
        if (disb === null || e.eventDate < disb) disb = e.eventDate;
        if (e.dueDate) mat = e.dueDate;
        if (e.amountPaid !== null) amount = (amount ?? 0) + e.amountPaid;
        break;
      case 'Payment received':
        n++;
        if (e.daysLate !== null) maxDpd = Math.max(maxDpd, Math.trunc(e.daysLate));
        break;
      case 'Payment missed': {
        n++;
        const cured = rows.some(
          (p) =>
            p.event === 'Payment received' &&
            p.eventDate >= e.eventDate &&
            (!e.dueDate || !p.dueDate || p.dueDate === e.dueDate),
        );
        if (!cured) {
          inArrears = true;
          maxDpd = Math.max(maxDpd, daysBetween(e.dueDate ?? e.eventDate, asOf));
        } else if (e.daysLate !== null) maxDpd = Math.max(maxDpd, Math.trunc(e.daysLate));
        break;
      }
      case 'Restructured':
        n++;
        hasRestr = true;
        break;
      case 'Default':
      case 'Written off':
        n++;
        hasDefault = true;
        break;
      case 'Repaid in full (transaction completed)':
        n++;
        hasRepaid = true;
        break;
      default:
        break;
    }
  }
  if (n === 0) return null;
  let status: DerivedHistoryRow['status'];
  if (hasDefault || maxDpd > 90) status = 'Defaulted';
  else if (hasRestr) status = 'Restructured';
  else if (hasRepaid)
    status =
      maxDpd === 0 ? 'Repaid on time' : maxDpd <= 30 ? 'Repaid late, max DPD 1-30' : 'Repaid late, 31-90';
  else if (inArrears) status = 'Live, in arrears';
  else status = 'Live, current';
  return {
    regNo,
    borrowerName: name,
    dealId: rows[0]!.dealId!,
    disbursementDate: disb,
    maturityDate: mat,
    amount,
    status,
    maxDpd,
  };
}

/** Deal History for every deal in the events, as at `asOf` (first-seen order, like the workbook). */
export function deriveDealHistory(events: ActivityEvent[], asOf: string): DerivedHistoryRow[] {
  const seen: string[] = [];
  for (const e of events)
    if (e.dealId?.trim() && e.eventDate <= asOf && !seen.some((s) => same(s, e.dealId)))
      seen.push(e.dealId.trim());
  return seen.map((id) => deriveDeal(events, id, asOf)).filter((r): r is DerivedHistoryRow => r !== null);
}

export interface BlacklistRow {
  regNo: string;
  borrowerName: string | null;
  status: 'Active' | 'Lifted';
  blacklistedOn: string | null;
  reason: string | null;
  liftedOn: string | null;
}

/** Blacklist from Blacklisted / Blacklist lifted events (`RecalculateBlacklist`), as at `asOf`. */
export function deriveBlacklist(events: ActivityEvent[], asOf: string): BlacklistRow[] {
  const regs: string[] = [];
  for (const e of events)
    if (e.eventDate <= asOf && !regs.some((r) => regNoKey(r) === regNoKey(e.regNo))) regs.push(e.regNo);
  const out: BlacklistRow[] = [];
  for (const reg of regs) {
    let last: ActivityEvent | null = null;
    let since: string | null = null;
    let reason: string | null = null;
    let name: string | null = null;
    for (const e of events) {
      if (regNoKey(e.regNo) !== regNoKey(reg) || e.eventDate > asOf) continue;
      if (e.borrowerName) name = e.borrowerName;
      if (e.event !== 'Blacklisted' && e.event !== 'Blacklist lifted') continue;
      if (last === null || e.eventDate >= last.eventDate) {
        last = e;
        if (e.event === 'Blacklisted') {
          since = e.eventDate;
          reason = e.notes;
        }
      }
    }
    if (!last) continue;
    out.push({
      regNo: reg.trim(),
      borrowerName: name,
      status: last.event === 'Blacklisted' ? 'Active' : 'Lifted',
      blacklistedOn: since,
      reason,
      liftedOn: last.event === 'Blacklist lifted' ? last.eventDate : null,
    });
  }
  return out;
}

export interface RatingForOverrideRate {
  ratingDate: string;
  status: string;
  overridden: boolean;
}

/** Year-to-date override rate (Override Log, `ovr_Rate`, `ovr_RateText`). */
export function overrideRate(
  ratings: RatingForOverrideRate[],
  today: string,
  yearStartMonth: number,
  trigger: number,
): {
  yearStart: string;
  finals: number;
  overridden: number;
  rate: number;
  aboveTrigger: boolean;
  text: string;
} {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const yearStart = `${m < yearStartMonth ? y - 1 : y}-${String(yearStartMonth).padStart(2, '0')}-01`;
  const finals = ratings.filter((r) => r.status === 'Final' && r.ratingDate >= yearStart);
  const overridden = finals.filter((r) => r.overridden).length;
  const rate = finals.length === 0 ? 0 : overridden / finals.length;
  const text =
    `${fmtPercent(rate, 1)} (${overridden} of ${finals.length} ratings this year)` +
    (rate > trigger ? ` - above the ${fmtPercent(trigger, 0)} trigger` : '');
  return { yearStart, finals: finals.length, overridden, rate, aboveTrigger: rate > trigger, text };
}

/** Next Deal ID for a year: CX-yyyy-nnn after the highest used (`modRating.NextDealID`). */
export function nextDealId(existing: string[], year: number): string {
  const prefix = `CX-${year}-`;
  let best = 0;
  for (const id of existing)
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > best) best = n;
    }
  return `${prefix}${String(best + 1).padStart(3, '0')}`;
}

/**
 * Rating ID R-yyyymmdd-hhnnss in Crowdaxe's local time, with -n appended if taken (`modRating.NewRatingID`).
 */
export function newRatingId(
  timestamp: Date,
  taken: (id: string) => boolean,
  timeZone = 'Africa/Harare',
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(timestamp)
      .map((x) => [x.type, x.value]),
  );
  const base = `R-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  let id = base;
  for (let n = 1; taken(id); n++) id = `${base}-${n}`;
  return id;
}
