import sys, os, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lo import LO, EPOCH
from history import load_events, deal_history, blacklist
import run_checks

ev = load_events()

def inject(lo, row):
    asof = row['Rating date'].date()
    dh = lo.sheets.getByName('Deal History'); bl = lo.sheets.getByName('Blacklist')
    for r in range(6, 20):
        for c in 'BCDEFGHIJK': dh.getCellRangeByName(f'{c}{r}').setString('')
    for r in range(9, 15):
        for c in 'BCDEFGH': bl.getCellRangeByName(f'{c}{r}').setString('')
    for i, h in enumerate(deal_history(ev, asof, asof).values()):
        r = 6 + i
        dh.getCellRangeByName(f'B{r}').setString(h['reg'])
        dh.getCellRangeByName(f'D{r}').setString(h['deal'])
        if h['mat']: dh.getCellRangeByName(f'H{r}').setValue((h['mat'] - EPOCH).days)
        dh.getCellRangeByName(f'I{r}').setString(h['status'])
    for i, (reg, b) in enumerate(blacklist(ev, asof).items()):
        bl.getCellRangeByName(f'B{9+i}').setString(reg)
        bl.getCellRangeByName(f'D{9+i}').setString(b['status'])

lo = LO(port=2003)
try:
    run_checks.ratings(lo, 'as-at', inject)
finally:
    lo.close()
