"""Extract parameter set 1.1 from the workbook into the engine's ParameterSet JSON shape.

Usage: CRS_WORKBOOK=... python3 extract_params.py > packages/engine/fixtures/parameter-set-1.1.json
The Phase 2 TypeScript importer must produce the same document (a test compares them).
"""
import json, os, sys
import openpyxl

wb = openpyxl.load_workbook(os.environ['CRS_WORKBOOK'], data_only=True)
P = wb['Parameters']; M = wb['Modules']; L = wb['Lists']


def v(x):
    if isinstance(x, str):
        x = x.strip()
        return x if x != '' else None
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def n(x):
    x = v(x)
    return x if isinstance(x, (int, float)) else None


def proposed(ref):
    return bool(ref) and 'PROPOSED' in str(ref)


scalars = []
for r in range(6, 58):
    name = v(P.cell(r, 2).value)
    if not name or name == 'Output_PDFFolder':
        continue
    ref = v(P.cell(r, 5).value)
    scalars.append(dict(name=name, value=v(P.cell(r, 3).value), unit=v(P.cell(r, 4).value), ref=ref,
                        note=v(P.cell(r, 6).value), proposed=proposed(ref), origin='Parameters sheet'))

# Values that were literals in formulas, or outside the Parameters sheet (discrepancies D-07, D-22, D-23)
added = [
    ('Interp_NB4_A1', 4.5, 'num', 's4.2', 'Interpolation anchor at boundary b1 (4-boundary factors)'),
    ('Interp_NB4_A2', 3.5, 'num', 's4.2', 'Interpolation anchor at boundary b2 (4-boundary factors)'),
    ('Interp_NB4_A3', 2.5, 'num', 's4.2', 'Interpolation anchor at boundary b3 (4-boundary factors)'),
    ('Interp_NB4_A4', 1.5, 'num', 's4.2', 'Interpolation anchor at boundary b4 (4-boundary factors)'),
    ('Interp_NB2_A1', 4, 'num', 's4.2', 'Interpolation anchor at boundary b1 (2-boundary factors)'),
    ('Interp_NB2_A2', 2, 'num', 's4.2', 'Interpolation anchor at boundary b2 (2-boundary factors)'),
    ('Tol_ScoreOverride', 0.005, 'num', None, 'A score differing from the calculated score by more than this is an override'),
    ('Tol_Weights', 0.000001, 'num', None, 'Tolerance for pillar weights summing to 100%'),
    ('Tol_ShockValue', 0.000001, 'num', None, 'A shock value differing from the default by more than this needs a reason'),
    ('Tol_Haircut', 0.00001, 'num', None, 'Tolerance for haircut range and midpoint tests'),
    ('Overlay_InfoQuality_Ord', 2, 'num', 's7.1', 'Which Zimbabwe overlay is information quality (data check 7 compares it with the accounts type)'),
    ('KO6_Enabled', wb['Blacklist']['C4'].value, 'text', None, 'Blacklisting stops a new rating (knockout KO6); was Blacklist!C4'),
    ('Txt_KO6', 'Decline (knockout: company blacklisted by Crowdaxe)', 'text', None, 'Was the defined name Txt_KO6'),
    ('KO6_CheckBorrowerOnPF', 'No', 'text', None, 'Project finance: also check the borrower registration number for KO6 (D-23; No = workbook behaviour)'),
]
for name, val, unit, ref, note in added:
    scalars.append(dict(name=name, value=val, unit=unit, ref=ref, note=note, proposed=False, origin='added in Phase 1'))

rating_scale = [dict(grade=v(P.cell(r, 2).value), description=v(P.cell(r, 3).value), cxScale=v(P.cell(r, 4).value),
                     pd=v(P.cell(r, 5).value), appetite=v(P.cell(r, 6).value), reviewMonths=v(P.cell(r, 7).value),
                     reviewCycle=v(P.cell(r, 8).value)) for r in range(61, 71)]
overlays = [dict(ord=v(P.cell(r, 2).value), name=v(P.cell(r, 3).value), maxNotches=v(P.cell(r, 4).value),
                 descriptors=[v(P.cell(r, 5).value), v(P.cell(r, 6).value), v(P.cell(r, 7).value)]) for r in range(74, 79)]
structures = [dict(code=v(P.cell(r, 2).value), track=v(P.cell(r, 3).value), name=v(P.cell(r, 4).value),
                   minNotch=v(P.cell(r, 5).value), maxNotch=v(P.cell(r, 6).value), selfLiquidating=v(P.cell(r, 7).value) == 1,
                   offtake=v(P.cell(r, 8).value) == 1, ref=v(P.cell(r, 9).value), conditions=v(P.cell(r, 10).value),
                   proposed=proposed(P.cell(r, 9).value) or 'PROPOSED' in str(P.cell(r, 4).value)) for r in range(82, 92)]

modules = []
for r in range(6, 18):
    if not M.cell(r, 2).value: continue
    modules.append(dict(code=v(M.cell(r, 2).value), name=v(M.cell(r, 3).value), track=v(M.cell(r, 4).value),
                        factorSet=v(M.cell(r, 5).value), subSectorSet=v(M.cell(r, 6).value),
                        haircutSet=v(M.cell(r, 7).value), ref=v(M.cell(r, 8).value)))

hdr = [c.value for c in M[21]]
col = {h: i for i, h in enumerate(hdr) if h}
factors = []
for r in range(22, 154):
    row = [c.value for c in M[r]]
    g = lambda h: v(row[col[h]])
    if not g('Key'): continue
    nb = n(g('NB')) or 0
    factors.append(dict(
        set=g('Set'), ord=g('Ord'), key=g('Key'), pillar=g('Pillar'), profile=g('Profile'), name=g('Factor'),
        weight=n(g('Weight')), measure=g('Measure'), unit=g('Unit'), type=g('Type'), dir=g('Dir'),
        scale=n(g('Scale')), nb=nb, bounds=[n(g(f'b{k}')) for k in range(1, nb + 1)],
        fFlags=[n(g(f'f{k}')) or 0 for k in range(1, nb + 1)], neg=(n(g('Neg')) == 1), group=g('Group'),
        optional=(n(g('Optional')) == 1), trackOnly=g('TrackOnly'), role=g('Role'), link=g('Link'),
        descriptors=[g(f'T{k}') for k in range(1, 6)], ref=g('Ref'), auto=g('Auto'),
        legacy=dict(topCut=n(g('TopCut')), botCut=n(g('BotCut')), judge=n(g('Judge')))))

sub_sectors = []
for r in range(158, 202):
    if not M.cell(r, 2).value: continue
    sub_sectors.append(dict(set=v(M.cell(r, 2).value), ord=v(M.cell(r, 3).value), name=v(M.cell(r, 5).value),
                            gradeLow=n(M.cell(r, 6).value), gradeHigh=n(M.cell(r, 7).value), special=v(M.cell(r, 8).value)))

# Linked haircut rows are formulas pointing at the CORE row: record the link
wf = openpyxl.load_workbook(os.environ['CRS_WORKBOOK'])
MF = wf['Modules']
core_by_row = {}
for r in range(206, 318):
    if M.cell(r, 2).value == 'CORE': core_by_row[r] = M.cell(r, 3).value
haircuts = []
for r in range(206, 318):
    if not M.cell(r, 2).value: continue
    f = MF.cell(r, 6).value
    linked = None
    if isinstance(f, str) and f.startswith('=F'):
        linked = core_by_row[int(f[2:])]
    haircuts.append(dict(set=v(M.cell(r, 2).value), ord=v(M.cell(r, 3).value), name=v(M.cell(r, 5).value),
                         low=n(M.cell(r, 6).value), high=n(M.cell(r, 7).value), crossBorderAddOn=n(M.cell(r, 8).value) or 0,
                         ref=v(M.cell(r, 9).value), linkedCoreOrd=linked))

questions = []
for r in range(322, 379):
    if not M.cell(r, 2).value: continue
    ref = v(M.cell(r, 11).value)
    questions.append(dict(module=v(M.cell(r, 2).value), ord=v(M.cell(r, 3).value), key=v(M.cell(r, 4).value),
                          kind=v(M.cell(r, 5).value), question=v(M.cell(r, 6).value), flagAnswer=v(M.cell(r, 7).value),
                          target=v(M.cell(r, 8).value), modifierType=v(M.cell(r, 9).value),
                          modifierValue=n(M.cell(r, 10).value), ref=ref, proposed=proposed(ref)))

shocks = []
for r in range(383, 448):
    if not M.cell(r, 2).value: continue
    shocks.append(dict(module=v(M.cell(r, 2).value), ord=v(M.cell(r, 3).value), key=v(M.cell(r, 4).value),
                       name=v(M.cell(r, 5).value), size=v(M.cell(r, 6).value), ref=v(M.cell(r, 7).value),
                       costType=v(M.cell(r, 8).value), defaultValue=n(M.cell(r, 9).value) or 0))

lists = {}
for c in range(2, 15):
    code = L.cell(5, c).value
    if not code: continue
    items = [v(L.cell(r, c).value) for r in range(6, 17)]
    lists[code] = [str(x) if not isinstance(x, str) else x for x in items if x is not None]
lists['act_EventTypes'] = [v(wb['Deal Activity'].cell(r, 16).value) for r in range(5, 15)]

doc = dict(version='1.1', methodVersion='1.1', workbookVersion='1.1', source='Crowdaxe_CRS.xlsm',
           scalars=scalars, ratingScale=rating_scale, overlays=overlays, structures=structures, modules=modules,
           factors=factors, subSectors=sub_sectors, haircuts=haircuts, questions=questions, shocks=shocks, lists=lists)
json.dump(doc, sys.stdout, indent=1, ensure_ascii=False)
sys.stdout.write('\n')
