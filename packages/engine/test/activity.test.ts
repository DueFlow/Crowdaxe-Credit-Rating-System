/** Deal Activity → Deal History and Blacklist, checked against the workbook's stored tables. */
import { describe, expect, it } from 'vitest';
import {
  type ActivityEvent,
  activityEventSchema,
  daysLate,
  deriveBlacklist,
  deriveDeal,
  deriveDealHistory,
  newRatingId,
  nextDealId,
  overrideRate,
  validateActivityEvent,
} from '../src/index.js';
import { fixture } from './helpers.js';

const events: ActivityEvent[] = fixture<{ events: unknown[] }>('deal-activity.json').events.map((e) =>
  activityEventSchema.parse(e),
);
const stored = fixture<{ dealHistory: Record<string, unknown>[]; blacklist: Record<string, unknown>[] }>(
  'deal-history.json',
);
const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};
const updatedOn = (note: string) => {
  const m = /updated (\d{2}) (\w{3}) (\d{4})/.exec(note)!;
  return `${m[3]}-${MONTHS[m[2]!]}-${m[1]}`;
};

describe('Deal History derivation (modActivity.RecalculateDeal)', () => {
  it('reproduces every stored Deal History row when run on the date it was last recalculated', () => {
    expect(stored.dealHistory).toHaveLength(5);
    for (const row of stored.dealHistory) {
      const d = deriveDeal(events, String(row['dealId']), updatedOn(String(row['notes'])))!;
      expect(d.status, String(row['dealId'])).toBe(row['status']);
      expect(d.maxDpd).toBe(row['maxDpd']);
      expect(d.amount).toBe(row['amount']);
      expect(d.disbursementDate).toBe(row['disbursementDate']);
      expect(d.maturityDate).toBe(row['maturityDate']);
      expect(d.regNo).toBe(row['regNo']);
      expect(d.borrowerName).toBe(row['borrowerName']);
    }
  });

  it('is live: unpaid instalments keep ageing (D-02)', () => {
    expect(deriveDeal(events, 'CX-2026-003', '2026-11-13')!.maxDpd).toBe(172);
    expect(deriveDeal(events, 'CX-2026-005', '2026-11-13')).toMatchObject({
      status: 'Live, in arrears',
      maxDpd: 10,
    });
    // an unpaid instalment passing 90 days past due turns the deal into a default without a new event
    expect(deriveDeal(events, 'CX-2026-005', '2027-02-02')!.status).toBe('Defaulted');
  });

  it('lists deals in first-seen order and ignores events after the as-of date', () => {
    expect(deriveDealHistory(events, '2026-11-13').map((d) => d.dealId)).toEqual([
      'CX-2026-001',
      'CX-2026-002',
      'CX-2026-003',
      'CX-2026-004',
      'CX-2026-005',
    ]);
    expect(deriveDealHistory(events, '2026-02-15').map((d) => [d.dealId, d.status])).toEqual([
      ['CX-2026-001', 'Live, current'],
      ['CX-2026-002', 'Live, current'],
    ]);
  });

  it('covers each status rule', () => {
    const ev = (event: string, eventDate: string, extra: Partial<ActivityEvent> = {}): ActivityEvent =>
      activityEventSchema.parse({
        entryId: `x${eventDate}${event}`,
        regNo: '1/2020',
        dealId: 'D',
        event,
        eventDate,
        ...extra,
      });
    const disb = ev('Disbursement', '2026-01-01', { amountPaid: 100, dueDate: '2026-12-31' });
    const run = (...e: ActivityEvent[]) => deriveDeal([disb, ...e], 'D', '2026-06-30')!.status;
    expect(run(ev('Repaid in full (transaction completed)', '2026-06-01'))).toBe('Repaid on time');
    expect(
      run(
        ev('Payment received', '2026-02-10', { dueDate: '2026-02-01', daysLate: 9 }),
        ev('Repaid in full (transaction completed)', '2026-06-01'),
      ),
    ).toBe('Repaid late, max DPD 1-30');
    expect(
      run(
        ev('Payment received', '2026-03-15', { dueDate: '2026-02-01', daysLate: 42 }),
        ev('Repaid in full (transaction completed)', '2026-06-01'),
      ),
    ).toBe('Repaid late, 31-90');
    expect(run(ev('Restructured', '2026-03-01'))).toBe('Restructured');
    expect(run(ev('Written off', '2026-03-01'))).toBe('Defaulted');
    expect(run(ev('Payment missed', '2026-06-02', { dueDate: '2026-06-01' }))).toBe('Live, in arrears');
    // a missed payment with no due date ages from its event date; a later payment of the same instalment cures it
    expect(run(ev('Payment missed', '2026-06-02'))).toBe('Live, in arrears');
    expect(
      run(
        ev('Payment missed', '2026-04-02', { dueDate: '2026-04-01', daysLate: 1 }),
        ev('Payment received', '2026-04-20', { dueDate: '2026-04-01', daysLate: 19 }),
      ),
    ).toBe('Live, current');
    expect(deriveDeal([ev('Note', '2026-01-01')], 'D', '2026-06-30')).toBeNull();
  });
});

describe('Blacklist derivation (modActivity.RecalculateBlacklist)', () => {
  it('reproduces the stored Blacklist', () => {
    const bl = deriveBlacklist(events, '2026-11-13');
    expect(bl).toEqual([
      {
        regNo: stored.blacklist[0]!['regNo'],
        borrowerName: stored.blacklist[0]!['borrowerName'],
        status: 'Active',
        blacklistedOn: stored.blacklist[0]!['blacklistedOn'],
        reason: stored.blacklist[0]!['reason'],
        liftedOn: null,
      },
    ]);
    expect(deriveBlacklist(events, '2026-10-29')).toEqual([]);
  });
  it('takes the latest blacklist event, a later row winning a tie', () => {
    const mk = (event: string, eventDate: string, entryId: string) =>
      activityEventSchema.parse({ entryId, regNo: '9/2020', event, eventDate, notes: 'r' });
    expect(
      deriveBlacklist(
        [mk('Blacklisted', '2026-01-01', 'a'), mk('Blacklist lifted', '2026-02-01', 'b')],
        '2026-03-01',
      )[0],
    ).toMatchObject({ status: 'Lifted', liftedOn: '2026-02-01', blacklistedOn: '2026-01-01' });
    expect(
      deriveBlacklist(
        [mk('Blacklist lifted', '2026-02-01', 'a'), mk('Blacklisted', '2026-02-01', 'b')],
        '2026-03-01',
      )[0]!.status,
    ).toBe('Active');
  });
});

describe('Deal Activity entry rules (modActivity.AddActivity)', () => {
  const base = {
    regNo: '1/2020',
    dealId: 'CX-2026-001',
    event: 'Payment received',
    eventDate: '2026-05-03',
    dueDate: '2026-04-25',
    amountPaid: 10,
    notes: null,
  };
  it('accepts a complete entry and computes days late', () => {
    expect(validateActivityEvent(base, '2026-05-03', '1/2020')).toEqual([]);
    expect(daysLate('Payment received', '2026-05-03', '2026-04-25')).toBe(8);
    expect(daysLate('Payment missed', '2026-04-20', '2026-04-25')).toBe(0);
    expect(daysLate('Disbursement', '2026-04-20', '2026-04-25')).toBeNull();
  });
  it('lists every problem in plain English', () => {
    expect(
      validateActivityEvent(
        { regNo: '', dealId: '', event: null, eventDate: null, dueDate: null, amountPaid: null, notes: null },
        '2026-05-03',
        null,
      ),
    ).toEqual(['Enter the company registration number.', 'Choose the event.', 'Enter the event date.']);
    expect(
      validateActivityEvent(
        { ...base, dealId: '', dueDate: null, amountPaid: null, eventDate: '2026-05-10' },
        '2026-05-03',
        null,
      ),
    ).toEqual([
      'Enter the Deal ID.',
      'Enter the date the payment was due.',
      'Enter the amount paid.',
      'The event date is in the future.',
    ]);
    expect(
      validateActivityEvent({ ...base, event: 'Disbursement', amountPaid: null }, '2026-05-03', '2/2020'),
    ).toEqual(['Enter the amount disbursed.', 'Deal CX-2026-001 belongs to registration number 2/2020.']);
    expect(
      validateActivityEvent({ ...base, event: 'Blacklisted', dealId: null }, '2026-05-03', null),
    ).toEqual(['Give the reason in Notes.']);
  });
});

describe('IDs and the override rate', () => {
  it('next Deal ID follows the highest of the year', () => {
    expect(nextDealId(['CX-2026-001', 'CX-2026-006', 'CX-2025-044', 'other'], 2026)).toBe('CX-2026-007');
    expect(nextDealId([], 2027)).toBe('CX-2027-001');
  });
  it('Rating IDs use Harare time and get a suffix when taken', () => {
    const t = new Date('2026-01-12T08:14:22Z');
    expect(newRatingId(t, () => false)).toBe('R-20260112-101422');
    const taken = new Set(['R-20260112-101422', 'R-20260112-101422-1']);
    expect(newRatingId(t, (id) => taken.has(id))).toBe('R-20260112-101422-2');
  });
  it('override rate matches the Override Log (1 of 7 = 14.3%)', () => {
    const { ratings } = fixture<{ ratings: { ratingsRow: Record<string, string> }[] }>('saved-ratings.json');
    const r = overrideRate(
      ratings.map((x) => ({
        ratingDate: x.ratingsRow['Rating date']!,
        status: x.ratingsRow['Status']!,
        overridden: x.ratingsRow['Overridden'] === 'Yes',
      })),
      '2026-11-13',
      1,
      0.15,
    );
    expect(r).toMatchObject({
      yearStart: '2026-01-01',
      finals: 7,
      overridden: 1,
      aboveTrigger: false,
      text: '14.3% (1 of 7 ratings this year)',
    });
    const r2 = overrideRate(
      [
        { ratingDate: '2026-02-01', status: 'Final', overridden: true },
        { ratingDate: '2025-12-01', status: 'Final', overridden: false },
      ],
      '2026-03-01',
      4,
      0.15,
    );
    expect(r2).toMatchObject({
      yearStart: '2025-04-01',
      rate: 0.5,
      text: '50.0% (1 of 2 ratings this year) - above the 15% trigger',
    });
    expect(overrideRate([], '2026-03-01', 1, 0.15).rate).toBe(0);
  });
});
