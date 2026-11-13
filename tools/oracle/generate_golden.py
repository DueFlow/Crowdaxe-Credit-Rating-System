"""Generate golden parity fixtures: random and boundary-value ratings recalculated by LibreOffice.

Usage: CRS_WORKBOOK=... python3 generate_golden.py <parameter-set.json> <out.json> [random_per_module] [seed]

Each case holds the input cells, any parameter changes, the Deal History and Blacklist rows used, and every
non-blank output cell the engine maps (packages/engine/src/workbook.ts resultToWorkbookCells). The engine
test runs each case and compares cell by cell; a cell missing from a case's outputs is expected blank.
"""
import json, random, sys, os, datetime, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lo import LO, EPOCH

PS = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
PER_MODULE = int(sys.argv[3]) if len(sys.argv) > 3 else 30
rnd = random.Random(int(sys.argv[4]) if len(sys.argv) > 4 else 20261113)

modules = PS['modules']
factors = PS['factors']
by_set = lambda s: sorted([f for f in factors if f['set'] == s], key=lambda f: f['ord'])
statuses = PS['lists']['lst_HistStatus']
accounts = PS['lists']['lst_Accounts']
fac_types = PS['lists']['lst_FacilityType']
statements = PS['lists']['lst_Statements']

# ---------------------------------------------------------------------------- output cells
OUT_CELLS = []
S = lambda c: OUT_CELLS.append('Scorecard!' + c)
for c in ['C11', 'C14', 'D14', 'D10', 'C18']: S(c)
for r in range(38, 68):
    for c in 'EHILOP': S(f'{c}{r}')
    S(f'AZ{r}')
for r in range(71, 83): S(f'P{r}')
for r in range(86, 94): S(f'I{r}'); S(f'P{r}')
for c in ['C96', 'C97', 'C98', 'C99', 'C100', 'C101', 'C102', 'C103', 'C104', 'F98', 'C105', 'C106']: S(c)
for r in range(109, 114): S(f'C{r}'); S(f'P{r}')
for c in ['C114', 'C115', 'C119'] + [f'C{r}' for r in range(120, 130)] + ['P129', 'C133', 'C134', 'C135', 'C137', 'C138',
          'C142', 'C144', 'C145', 'C147', 'C148', 'C149', 'C150', 'C151', 'C152', 'C154', 'C155', 'C164', 'C165',
          'C167', 'C168', 'C169', 'C171', 'C174', 'C175', 'C176', 'C177', 'C178', 'C179']: S(c)
OUT_CELLS += [f'Financials!H{r}' for r in range(6, 26)]
for r in range(9, 24): OUT_CELLS += [f'Collateral!{c}{r}' for c in 'EFIJK']
OUT_CELLS += [f'Collateral!D{r}' for r in range(25, 31)]
for r in range(8, 21): OUT_CELLS += [f'Checks!D{r}', f'Checks!E{r}']
OUT_CELLS += ['Checks!D4', 'Checks!E4', 'Blacklist!C5', 'Knockouts!F9', 'Knockouts!F10']

# ---------------------------------------------------------------------------- random inputs
CLEAN = {'on': False}
GAPS = {0.02, 0.03, 0.04, 0.05, 0.06, 0.12}


def chance(p):
    """In clean mode, the small probabilities used to leave gaps or errors are switched off."""
    if CLEAN['on'] and p in GAPS:
        return False
    return rnd.random() < p
def money(lo, hi): return round(rnd.uniform(lo, hi), rnd.choice([0, 0, 2]))
def rdate(): return (datetime.date(2025, 1, 1) + datetime.timedelta(days=rnd.randint(0, 900))).isoformat()
def words(): return rnd.choice(['Bank statements reviewed', 'Site visit', 'Audited accounts 2025', 'Management interview', 'Contract seen'])

REGS = ['3187/2011', '6642/2016', '2259/2013', 'GOLD-1', 'GOLD-2', 'GOLD-3']


def metric_value(f):
    b = f['bounds']
    choice = rnd.random()
    span = abs(b[0] - b[-1]) or 1
    if CLEAN['on'] and rnd.random() < 0.6:
        strength = CLEAN['strength']
        lo, hi = (b[-1], b[0]) if f['dir'] == 'H' else (b[0], b[-1])
        x = lo + (hi - lo) * strength if f['dir'] == 'H' else hi - (hi - lo) * strength
        x += rnd.uniform(-0.1, 0.1) * span
    elif choice < 0.25:
        x = rnd.choice(b)  # exactly on a boundary
    elif choice < 0.4:
        x = rnd.choice(b) + rnd.choice([-1, 1]) * span * rnd.choice([1e-9, 1e-6, 0.001])
    elif choice < 0.85:
        lo, hi = min(b) - span * 0.6, max(b) + span * 0.6
        x = rnd.uniform(lo, hi)
    elif choice < 0.92:
        x = -1 if f['dir'] == 'L' else rnd.uniform(-span, 0)
    else:
        x = 0
    if f['unit'] in ('USD',): x = round(x)
    elif rnd.random() < 0.5: x = round(x, 4)
    return x


def random_case(mod, boundary=None, clean=False):
    CLEAN['on'] = clean
    CLEAN['strength'] = rnd.uniform(0.25, 1.0)
    cells = {}
    code = mod['code']; track = mod['track']; pf = track == 'Project finance'
    put = lambda k, v: cells.__setitem__(k, v)
    sc = lambda c, v: put('Scorecard!' + c, v)
    sc('C6', f"CX-2026-{rnd.randint(1, 999):03d}")
    sc('C7', 'Golden Test Borrower (Pvt) Ltd')
    reg = rnd.choice(REGS)
    if not chance(0.03): sc('C8', reg)
    sc('C9', 'Review' if chance(0.2) else 'New')
    sc('C10', code)
    sc('C12', 'Yes' if (pf and chance(0.8)) or chance(0.1) else 'No')
    sc('C13', 'Yes' if chance(0.15) else 'No')
    if not chance(0.03): sc('C15', rnd.choice(fac_types))
    amount = money(10_000, 2_000_000)
    if not chance(0.03): sc('C16', amount)
    if chance(0.2): sc('C17', money(10_000, 2_000_000))
    if not chance(0.03): sc('C19', rnd.choice([3, 6, 12, 24, 36, 60]))
    if not chance(0.02): sc('C20', rdate())
    if not chance(0.02): sc('C21', 'Golden Analyst')
    if not chance(0.03): sc('C23', statements[1] if chance(0.1) else statements[0])
    if not chance(0.03): sc('C24', rnd.choice(accounts))
    ss = [s for s in PS['subSectors'] if s['set'] == mod['subSectorSet']]
    if ss and not chance(0.05): sc('C25', rnd.choice(ss)['name'] if not chance(0.03) else 'Not a listed sub-sector')
    r = rnd.random()
    if r < 0.5: sc('C26', rnd.randint(1, 10))
    elif r < 0.7: sc('C26', 'Ungraded international buyer')
    if code == 'PF-REN' or chance(0.05):
        off = [s for s in PS['subSectors'] if s['set'] == 'B7P']
        sc('C27', rnd.choice(off)['name'])
    if code == 'B5' or chance(0.05): sc('C28', round(rnd.uniform(0.5, 1.05), 3) if not chance(0.1) else 0.85)
    if pf and not chance(0.1): sc('C29', rnd.choice(REGS))
    if not chance(0.03): sc('C30', 'Yes' if (not CLEAN['on'] and chance(0.05)) else 'No')
    if chance(0.3): sc('C31', rnd.choice(['Yes', 'No']))
    if pf or chance(0.05):
        sc('C32', rnd.choice(['Yes', 'No', 'No']))
        if chance(0.5): sc('C33', rnd.randint(1, 10))
        sc('C34', rnd.choice(['Yes', 'No', 'No']))

    # Financials
    fin = lambda c, v: put('Financials!' + c, v)
    if not pf or chance(0.3):
        for col in 'CDE':
            if col == 'E' or chance(0.7):
                rev = money(100_000, 20_000_000)
                fin(f'{col}6', rev)
                fin(f'{col}7', round(rev * rnd.uniform(-0.1, 0.35)) if not chance(0.05) else 0)
        for c, lo, hi in [('E10', 0, 5e6), ('E11', 0, 2e6), ('E12', 1e4, 5e6), ('E13', 0, 3e6), ('E14', -5e5, 8e6),
                          ('E20', 0, 3e5), ('E21', 0, 4e5), ('E22', -1e5, 3e5), ('E23', 0, 6e5), ('E24', 0, 2e6),
                          ('E27', 0, 2e7), ('E28', 0, 2e6), ('E29', 1e5, 5e6)]:
            if not chance(0.12): fin(c, money(lo, hi))
        if code == 'B5' or chance(0.1): fin('E15', money(5e5, 3e7))
        if chance(0.3): fin('E18', money(1e5, 2e7))
        if chance(0.3): fin('E19', money(-1e5, 4e6))
        if chance(0.6): fin('E30', round(rnd.uniform(0, 0.7), 2))
        if chance(0.7): fin('E31', round(rnd.uniform(0.2, 0.8), 2))

    # Factors
    grid = by_set(mod['factorSet']) + by_set('CORE')
    for i, f in enumerate(grid):
        row = 38 + i
        if f['type'] == 'Numeric':
            if boundary is not None:
                b = f['bounds']; k, kind = boundary
                base = b[min(k, len(b) - 1)]
                span = abs(b[0] - b[-1]) or 1
                x = {'on': base, 'above': base + span * 1e-7, 'below': base - span * 1e-7,
                     'far-strong': (b[0] + span) if f['dir'] == 'H' else b[0] - span,
                     'far-weak': (b[-1] - span) if f['dir'] == 'H' else b[-1] + span,
                     'mid': (b[0] + b[1]) / 2}[kind]
                sc(f'G{row}', x)
            elif not (f['auto'] and not pf and chance(0.6)) and not chance(0.05):
                sc(f'G{row}', metric_value(f))
            if chance(0.1):
                sc(f'J{row}', round(rnd.uniform(1, 5), rnd.choice([0, 1, 2])))
                if chance(0.6): sc(f'N{row}', words())
            elif chance(0.1): sc(f'N{row}', words())
        elif f['type'] == 'Descriptor':
            if CLEAN['on']:
                sc(f'J{row}', max(2, min(5, round(1 + 4 * CLEAN['strength'] + rnd.choice([-1, 0, 0, 1])))))
            elif not chance(0.04): sc(f'J{row}', rnd.randint(1, 5) if not chance(0.04) else 2.5)
            if not chance(0.12): sc(f'N{row}', words())
        elif f['type'] in ('SubSector', 'Offtaker'):
            if chance(0.1):
                sc(f'J{row}', round(rnd.uniform(1, 5), 2))
                if chance(0.6): sc(f'N{row}', words())
        if f['optional'] and chance(0.35): sc(f'K{row}', 'Yes')

    # Questions
    for i, q in enumerate(sorted([q for q in PS['questions'] if q['module'] == code], key=lambda q: q['ord'])):
        r = 71 + i
        if not chance(0.06): sc(f'G{r}', rnd.choice(['Yes', 'No', 'No', 'N/A']) if q['kind'] != 'Modifier' else rnd.choice(['Yes', 'No']))
        if CLEAN['on'] or chance(0.6): sc(f'N{r}', 'Explained')
    # Shocks
    for i, s in enumerate(sorted([s for s in PS['shocks'] if s['module'] == code], key=lambda s: s['ord'])):
        r = 86 + i
        u = rnd.random()
        if u < 0.7: sc(f'G{r}', 'Yes')
        elif u < 0.92: sc(f'G{r}', 'No')
        if chance(0.15) and s['costType'] != 'Info': sc(f'H{r}', s['defaultValue'] * rnd.choice([0.5, 1, 1.5]) if s['costType'] != 'Delay' else rnd.choice([30, 60, 90, 120]))
        if CLEAN['on'] or chance(0.5): sc(f'N{r}', 'Reason')
    # Overlays
    for o in PS['overlays']:
        r = 108 + o['ord']
        if chance(0.1): continue
        n = rnd.randint(0, o['maxNotches'])
        if chance(0.03): n = o['maxNotches'] + 1
        sc(f'E{r}', n)
        if n > 0 and chance(0.88): sc(f'N{r}', 'Overlay reason')
    if chance(0.3): sc('N129', 'Character justified')
    # Structure
    sts = [s for s in PS['structures'] if s['track'] == track]
    if not chance(0.05):
        st = rnd.choice(sts)
        sc('C141', st['name'])
        n = rnd.randint(st['minNotch'], st['maxNotch'])
        if chance(0.05): n = st['maxNotch'] + 1
        if not chance(0.05): sc('C143', n)
        if CLEAN['on'] or chance(0.5): sc('C146', 'Structure reason')
    # Collateral
    hcs = [h for h in PS['haircuts'] if h['set'] == mod['haircutSet']]
    for i in range(rnd.choice([0, 0, 1, 1, 2, 3, 4, 6])):
        r = 9 + i
        h = rnd.choice(hcs)
        put(f'Collateral!C{r}', h['name'] if not chance(0.03) else 'Unlisted collateral')
        if not chance(0.05): put(f'Collateral!D{r}', money(5_000, 1_500_000))
        u = rnd.random()
        if u < 0.15: put(f'Collateral!G{r}', round(rnd.uniform(h['low'], h['high']), 3))
        elif u < 0.2: put(f'Collateral!G{r}', min(1, h['high'] + 0.1))
        if code == 'B4' and chance(0.4): put(f'Collateral!H{r}', 'Yes')
        if CLEAN['on'] or chance(0.5): put(f'Collateral!L{r}', 'Note')
    # Override
    if chance(0.18):
        if chance(0.6): sc('C136', rnd.randint(1, 10))
        if chance(0.6): sc('C153', rnd.randint(1, 10))
        if CLEAN['on'] or chance(0.75): sc('C158', 'Override reason')
        if chance(0.5): sc('C159', 'IC Member'); sc('C160', rdate())
    if chance(0.2): sc('C170', round(rnd.uniform(0.05, 0.3), 3))

    params = {}
    if chance(0.12): params['Hist_Enabled'] = 'No'
    if chance(0.2): params.update(Price_CostOfFunds=0.08, Price_OperatingCost=0.03, Price_TargetMargin=0.04)
    if chance(0.1): params['Hist_LookbackYears'] = rnd.choice([1, 2])
    if chance(0.1): params['LGD_CapAtUnsecured'] = 'No'
    if chance(0.1): params['KO6_Enabled'] = 'No'

    hist = []
    regs = [reg, cells.get('Scorecard!C29')]
    for _ in range(rnd.choice([0, 0, 1, 2, 3, 4, 5])):
        hist.append(dict(regNo=rnd.choice([x for x in regs if x] or REGS), dealId=f'H-{rnd.randint(1, 99)}',
                         status=rnd.choice(statuses), maturityDate=rdate() if not chance(0.1) else None))
    bl = []
    if chance(0.15):
        bl.append(dict(regNo=rnd.choice([x for x in regs if x] or REGS), status=rnd.choice(['Active', 'Active', 'Lifted'])))
    return cells, params, hist, bl


# ---------------------------------------------------------------------------- run through LibreOffice
def serial(iso):
    y, m, d = map(int, iso.split('-'))
    return (datetime.date(y, m, d) - EPOCH).days


DATE_CELLS = {'Scorecard!C20', 'Scorecard!C160'}


def enc(k, v):
    if k in DATE_CELLS: return f'D:{v}'
    if isinstance(v, (int, float)): return f'N:{v!r}'
    return f'S:{v}'


def main():
    lo = LO(port=2011)
    try:
        dh = lo.sheets.getByName('Deal History'); bls = lo.sheets.getByName('Blacklist')
        param_cells = {}
        for name in ['Hist_Enabled', 'Price_CostOfFunds', 'Price_OperatingCost', 'Price_TargetMargin',
                     'Hist_LookbackYears', 'LGD_CapAtUnsecured']:
            param_cells[name] = lo.name_cell(name)
        param_cells['KO6_Enabled'] = bls.getCellRangeByName('C4')
        orig = {k: (c.getType(), c.getValue(), c.getString()) for k, c in param_cells.items()}

        def restore_params():
            from com.sun.star.table.CellContentType import EMPTY, VALUE
            for k, c in param_cells.items():
                t, v, s = orig[k]
                if t == EMPTY: c.setString('')
                elif t == VALUE: c.setValue(v)
                else: c.setString(s)

        plan = []
        for mod in modules:
            for n in range(PER_MODULE): plan.append((mod, None, n % 2 == 1))
            for k in range(4):
                for kind in ['on', 'above', 'below']: plan.append((mod, (k, kind), False))
            for kind in ['far-strong', 'far-weak', 'mid']: plan.append((mod, (0, kind), False))
        cases = []
        t0 = time.time()
        for i, (mod, boundary, clean) in enumerate(plan):
            cells, params, hist, bl = random_case(mod, boundary, clean)
            lo.clear_inputs_fast()
            restore_params()
            dh.getCellRangeByName('B6:K40').clearContents(7)
            bls.getCellRangeByName('B9:H20').clearContents(7)
            for k, v in cells.items(): lo.set(k, enc(k, v))
            for k, v in params.items():
                c = param_cells[k]
                c.setValue(v) if isinstance(v, (int, float)) else c.setString(v)
            for j, h in enumerate(hist):
                r = 6 + j
                dh.getCellRangeByName(f'B{r}').setString(h['regNo'])
                dh.getCellRangeByName(f'D{r}').setString(h['dealId'])
                if h['maturityDate']: dh.getCellRangeByName(f'H{r}').setValue(serial(h['maturityDate']))
                dh.getCellRangeByName(f'I{r}').setString(h['status'])
            for j, b in enumerate(bl):
                bls.getCellRangeByName(f'B{9 + j}').setString(b['regNo'])
                bls.getCellRangeByName(f'D{9 + j}').setString(b['status'])
            lo.calc()
            blocks = {sh: lo.read_block(sh) for sh in ('Scorecard', 'Financials', 'Collateral', 'Checks', 'Blacklist', 'Knockouts')}
            outputs = {}
            for k in OUT_CELLS:
                sh, a = k.split('!')
                v = blocks[sh].get(a)
                if v is not None and v != '': outputs[k] = v
            cases.append(dict(id=f'G{i + 1:04d}', module=mod['code'], profile='clean' if clean else 'random', boundary=None if boundary is None else f'b{boundary[0] + 1} {boundary[1]}',
                              inputs=cells, params=params, history=hist, blacklist=bl, outputs=outputs))
            if (i + 1) % 50 == 0:
                print(f'{i + 1}/{len(plan)} cases, {time.time() - t0:.0f}s', flush=True)
        with open(OUT, 'w') as f:
            json.dump(dict(source='LibreOffice recalculation of Crowdaxe_CRS.xlsm (tools/oracle/generate_golden.py)',
                           generated=datetime.date.today().isoformat(), outputCells=OUT_CELLS, cases=cases), f, ensure_ascii=False)
        print('done', len(cases))
    finally:
        lo.close()


if __name__ == '__main__':
    main()
