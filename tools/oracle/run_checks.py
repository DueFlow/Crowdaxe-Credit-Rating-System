"""Run the workbook TestCases and re-run saved ratings through LibreOffice."""
import sys, os, json, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import openpyxl
from lo import LO, EPOCH

HERE = os.path.dirname(os.path.abspath(__file__))
wb = openpyxl.load_workbook(os.environ['CRS_WORKBOOK'], data_only=True)


def decode(enc):
    t, b = enc[:2], enc[2:]
    if t == 'N:': return float(b)
    if t == 'E:': return None
    return b


def testcases(lo):
    ws = wb['TestCases']
    rows = [r[1:6] for r in ws.iter_rows(min_row=6, values_only=True) if r[1]]
    cases = list(collections.OrderedDict((r[0], 1) for r in rows))

    def collect(cid, acc, depth=0):
        for r in rows:
            if r[0] == cid and r[1] == 'Use':
                collect(decode(r[3]), acc, depth + 1)
        for r in rows:
            if r[0] == cid and r[1] == 'Input':
                acc[r[2]] = r[3]
        return acc

    orig_params = {}
    dh = lo.sheets.getByName('Deal History')
    first_free = 11
    total = passed = 0
    fails = []
    for cid in cases:
        lo.clear_inputs()
        # remove test history rows
        for rr in range(first_free, first_free + 10):
            for col in 'BCDEFGHIJK':
                dh.getCellRangeByName(f'{col}{rr}').setString('')
        for k, v in orig_params.items():
            lo.set(k, v)
        for k, v in collect(cid, {}).items():
            lo.set(k, v)
        hist_row = first_free
        for r in rows:
            if r[0] != cid: continue
            if r[1] == 'Param':
                if r[2] not in orig_params:
                    c = lo.name_cell(r[2])
                    orig_params[r[2]] = 'S:' + c.getString()
                lo.set(r[2], r[3])
            if r[1] == 'History':
                parts = decode(r[3]).split('~')
                for col, p in zip('BCDEFGHIJK', parts):
                    lo.set_cell(dh.getCellRangeByName(f'{col}{hist_row}'), p)
                hist_row += 1
        lo.calc()
        for r in rows:
            if r[0] == cid and r[1] == 'Expect':
                exp = decode(r[3]); act = lo.get(r[2]); tol = float(r[4]) if r[4] not in (None, '') else 1e-6
                if isinstance(exp, float):
                    ok = isinstance(act, float) and abs(act - exp) <= tol
                else:
                    ok = (act if act is not None else '') == exp
                total += 1; passed += ok
                if not ok: fails.append((cid, r[2], exp, act))
    for rr in range(first_free, first_free + 10):
        for col in 'BCDEFGHIJK':
            dh.getCellRangeByName(f'{col}{rr}').setString('')
    for k, v in orig_params.items():
        lo.set(k, v)
    print(f'TestCases: {passed} of {total} passed')
    for f in fails: print('  FAIL', f)


OUT_KEYS = ['sc_Blended', 'sc_ObligorModel', 'sc_Obligor', 'sc_FacilityModel', 'sc_Facility', 'sc_PD', 'sc_LGD',
            'sc_EAD', 'sc_ELUSD', 'sc_Decision']
RT_COLS = ['Blended score', 'Obligor model', 'Obligor final', 'Facility model', 'Facility final', 'PD', 'LGD',
           'EAD USD', 'EL USD', 'Recommendation']


def ratings(lo, label, extra=None):
    ri = wb['RatingInputs']
    inputs = collections.defaultdict(list)
    for r in ri.iter_rows(min_row=6, values_only=True):
        if r[1]: inputs[r[1]].append((r[2], r[3]))
    rt = wb['Ratings']
    hdr = [c for c in next(rt.iter_rows(min_row=5, max_row=5, values_only=True))]
    res = {}
    for r in rt.iter_rows(min_row=6, values_only=True):
        if not r[1]: continue
        row = dict(zip(hdr, r))
        rid = row['Rating ID']
        lo.clear_inputs()
        for k, v in inputs[rid]:
            lo.set(k, v)
        if extra: extra(lo, row)
        lo.calc()
        diffs = []
        for k, col in zip(OUT_KEYS, RT_COLS):
            a = lo.get(k); e = row[col]
            if isinstance(e, (int, float)) and isinstance(a, float):
                ok = abs(a - e) < 1e-6
            else:
                ok = (a or '') == (e or '')
            if not ok: diffs.append((col, e, a))
        extra_out = {k: lo.get(k) for k in ['sc_HistAdj', 'sc_HistSummary', 'sc_GradeScore', 'sc_AfterOverlays', 'sc_OverlayTotal', 'sc_KO6', 'chk_Summary', 'chk_Counts']}
        res[rid] = (diffs, extra_out)
        print(label, rid, 'MATCH' if not diffs else 'DIFF', diffs, extra_out)
    return res


if __name__ == '__main__':
    lo = LO()
    try:
        testcases(lo)
        ratings(lo, 'current-data')
    finally:
        lo.close()
