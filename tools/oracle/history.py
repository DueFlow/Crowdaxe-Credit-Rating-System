"""Python port of modActivity.RecalculateDeal / RecalculateBlacklist with an as-of date."""
import datetime
import openpyxl, os

HERE = os.path.dirname(os.path.abspath(__file__))
STATUSES = ['Repaid on time', 'Repaid late, max DPD 1-30', 'Repaid late, 31-90', 'Restructured', 'Defaulted',
            'Live, current', 'Live, in arrears']


def d(v):
    if isinstance(v, datetime.datetime): return v.date()
    return v


def load_events():
    wb = openpyxl.load_workbook(os.environ['CRS_WORKBOOK'], data_only=True)
    ws = wb['Deal Activity']
    ev = []
    for r in ws.iter_rows(min_row=5, values_only=True):
        if not r[1]: continue
        ev.append(dict(id=r[1], reg=r[2], name=r[3], deal=r[4], event=r[5], date=d(r[6]), due=d(r[7]),
                       amt_due=r[8], amt_paid=r[9], late=r[10], notes=r[11], entered=r[12]))
    return ev


def deal_history(events, today, event_cutoff=None):
    """today = the date VBA's Date() returns when RecalculateDeal runs.
    event_cutoff: only events with event date <= cutoff are known."""
    evs = [e for e in events if event_cutoff is None or e['date'] <= event_cutoff]
    deals = []
    for e in evs:
        if e['deal'] and e['deal'] not in deals: deals.append(e['deal'])
    out = {}
    for deal in deals:
        rows = [e for e in evs if (e['deal'] or '').strip().lower() == deal.strip().lower()]
        n = 0; reg = ''; nm = ''; disb = None; mat = None; amt = None; maxdpd = 0
        has_def = has_restr = has_rep = in_arr = False
        for e in rows:
            if not reg: reg = e['reg']
            if e['name']: nm = e['name']
            t = e['event']
            if t == 'Disbursement':
                n += 1
                if e['date']:
                    disb = e['date'] if disb is None or e['date'] < disb else disb
                if e['due']: mat = e['due']
                if isinstance(e['amt_paid'], (int, float)): amt = (amt or 0) + e['amt_paid']
            elif t == 'Payment received':
                n += 1
                if isinstance(e['late'], (int, float)): maxdpd = max(maxdpd, int(e['late']))
            elif t == 'Payment missed':
                n += 1
                cured = False
                for j in rows:
                    if j['event'] == 'Payment received' and j['date'] and e['date'] and j['date'] >= e['date']:
                        if not e['due'] or not j['due'] or j['due'] == e['due']:
                            cured = True
                if not cured:
                    in_arr = True
                    dpd = (today - (e['due'] or e['date'])).days
                    maxdpd = max(maxdpd, dpd)
                elif isinstance(e['late'], (int, float)):
                    maxdpd = max(maxdpd, int(e['late']))
            elif t == 'Restructured':
                n += 1; has_restr = True
            elif t in ('Default', 'Written off'):
                n += 1; has_def = True
            elif t == 'Repaid in full (transaction completed)':
                n += 1; has_rep = True
        if n == 0: continue
        if has_def or maxdpd > 90: st = STATUSES[4]
        elif has_restr: st = STATUSES[3]
        elif has_rep:
            st = STATUSES[0] if maxdpd == 0 else STATUSES[1] if maxdpd <= 30 else STATUSES[2]
        elif in_arr: st = STATUSES[6]
        else: st = STATUSES[5]
        out[deal] = dict(reg=reg, name=nm, deal=deal, disb=disb, mat=mat, amt=amt, status=st, maxdpd=maxdpd)
    return out


def blacklist(events, event_cutoff=None):
    evs = [e for e in events if event_cutoff is None or e['date'] <= event_cutoff]
    regs = []
    for e in evs:
        if e['reg'] and e['reg'] not in regs: regs.append(e['reg'])
    out = {}
    for reg in regs:
        last = None; last_ev = None; since = None; reason = None
        for e in evs:
            if e['reg'] == reg and e['event'] in ('Blacklisted', 'Blacklist lifted'):
                if last is None or e['date'] >= last:
                    last = e['date']; last_ev = e['event']
                    if last_ev == 'Blacklisted': since = last; reason = e['notes']
        if last_ev:
            out[reg] = dict(status='Active' if last_ev == 'Blacklisted' else 'Lifted', since=since, reason=reason)
    return out


if __name__ == '__main__':
    ev = load_events()
    # Reproduce the stored Deal History: each deal was last recalculated on the date in its Notes column
    for deal, upd in [('CX-2026-001', datetime.date(2026, 7, 17)), ('CX-2026-002', datetime.date(2026, 9, 24)),
                      ('CX-2026-003', datetime.date(2026, 10, 30)), ('CX-2026-004', datetime.date(2026, 10, 16)),
                      ('CX-2026-005', datetime.date(2026, 11, 4))]:
        h = deal_history(ev, upd)
        print(deal, h[deal]['status'], h[deal]['maxdpd'], h[deal]['amt'], h[deal]['disb'], h[deal]['mat'])
    print('as of today 13 Nov 2026:')
    for k, v in deal_history(ev, datetime.date(2026, 11, 13)).items(): print(' ', k, v['status'], v['maxdpd'])
    print(blacklist(ev))
