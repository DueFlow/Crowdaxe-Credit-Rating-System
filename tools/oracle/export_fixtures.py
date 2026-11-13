"""Export the workbook's TestCases, saved ratings, Deal Activity and Deal History as engine test fixtures.

Usage: CRS_WORKBOOK=... python3 export_fixtures.py <out_dir>
Writes testcases.json, saved-ratings.json, deal-activity.json, deal-history.json.
"""
import json, os, sys, datetime
import openpyxl

out = sys.argv[1]
wb = openpyxl.load_workbook(os.environ['CRS_WORKBOOK'], data_only=True)


def j(x):
    if isinstance(x, datetime.datetime):
        return x.date().isoformat() if x.time() == datetime.time(0) else x.isoformat(timespec='seconds')
    if isinstance(x, datetime.date):
        return x.isoformat()
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def dump(name, obj):
    with open(os.path.join(out, name), 'w') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write('\n')


# TestCases: rows (Case, Kind, Key, Value, Tolerance), kept as in the sheet
ws = wb['TestCases']
rows = [dict(case=r[1], kind=r[2], key=r[3], value=r[4], tolerance=j(r[5])) for r in ws.iter_rows(min_row=6, values_only=True) if r[1]]
dump('testcases.json', dict(source='TestCases sheet, Workbook 1.1', note='Kinds: Title, Use, Input, Param, History, Expect (modSelfTest)', rows=rows))

# Saved ratings: Ratings row + RatingInputs
rt = wb['Ratings']
hdr = [c for c in next(rt.iter_rows(min_row=5, max_row=5, values_only=True))][1:]
inputs = {}
for r in wb['RatingInputs'].iter_rows(min_row=6, values_only=True):
    if r[1]: inputs.setdefault(r[1], {})[r[2]] = r[3]
ratings = []
for r in rt.iter_rows(min_row=6, values_only=True):
    if not r[1]: continue
    row = {h: j(v) for h, v in zip(hdr, r[1:])}
    ratings.append(dict(ratingsRow=row, inputs=inputs[row['Rating ID']]))
dump('saved-ratings.json', dict(source='Ratings and RatingInputs sheets, Workbook 1.1', ratings=ratings))

# Deal Activity events
acts = []
for r in wb['Deal Activity'].iter_rows(min_row=5, values_only=True):
    if not r[1]: continue
    acts.append(dict(entryId=r[1], regNo=r[2], borrowerName=r[3], dealId=r[4], event=r[5], eventDate=j(r[6]),
                     dueDate=j(r[7]), amountDue=j(r[8]), amountPaid=j(r[9]), daysLate=j(r[10]), notes=r[11],
                     enteredOn=j(r[12]), enteredBy=r[13]))
dump('deal-activity.json', dict(source='Deal Activity sheet, Workbook 1.1', events=acts))

# Deal History and Blacklist as stored (to check the derivation)
dh = []
for r in wb['Deal History'].iter_rows(min_row=6, values_only=True):
    if not r[1]: continue
    dh.append(dict(regNo=r[1], borrowerName=r[2], dealId=r[3], facilityType=r[4], amount=j(r[5]),
                   disbursementDate=j(r[6]), maturityDate=j(r[7]), status=r[8], maxDpd=j(r[9]), notes=r[10]))
bl = []
for r in wb['Blacklist'].iter_rows(min_row=9, values_only=True):
    if not r[1]: continue
    bl.append(dict(regNo=r[1], borrowerName=r[2], status=r[3], blacklistedOn=j(r[4]), reason=r[5], liftedOn=j(r[6]), updated=j(r[7])))
dump('deal-history.json', dict(source='Deal History and Blacklist sheets, Workbook 1.1', dealHistory=dh, blacklist=bl))
