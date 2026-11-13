"""LibreOffice UNO harness: load the CRS workbook, write inputs, recalculate, read outputs.
Used only in Phase 0 as an independent oracle to check the spec and saved ratings."""
import json, os, subprocess, time, datetime, sys
import uno
from com.sun.star.beans import PropertyValue

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.environ.get('CRS_WORKBOOK') or sys.exit('Set CRS_WORKBOOK to the path of Crowdaxe_CRS.xlsm')
INPUTS = json.load(open(os.path.join(HERE, 'input_cells.json')))
EPOCH = datetime.date(1899, 12, 30)


def prop(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p


class LO:
    def __init__(self, port=2002):
        self.proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--nologo', '--norestore',
                                      f'--accept=socket,host=localhost,port={port};urp;'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        for _ in range(60):
            try:
                self.ctx = resolver.resolve(f'uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext')
                break
            except Exception:
                time.sleep(0.5)
        smgr = self.ctx.ServiceManager
        self.desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', self.ctx)
        url = uno.systemPathToFileUrl(os.path.abspath(WB))
        self.doc = self.desktop.loadComponentFromURL(url, '_blank', 0, (prop('Hidden', True), prop('MacroExecutionMode', 0)))
        self.sheets = self.doc.Sheets

    def cell(self, key):
        sh, addr = key.split('!')
        return self.sheets.getByName(sh).getCellRangeByName(addr)

    def name_cell(self, name):
        nr = self.doc.NamedRanges.getByName(name)
        return nr.getReferredCells().getCellByPosition(0, 0)

    def clear_inputs(self):
        for sh, cells in INPUTS.items():
            s = self.sheets.getByName(sh)
            for a in cells:
                s.getCellRangeByName(a).setString('')

    def set(self, key, enc):
        c = self.cell(key) if '!' in key else self.name_cell(key)
        self.set_cell(c, enc)

    @staticmethod
    def set_cell(c, enc):
        t, body = enc[:2], enc[2:]
        if t == 'E:':
            c.setString('')
        elif t == 'N:':
            c.setValue(float(body))
        elif t == 'D:':
            d = datetime.date(int(body[:4]), int(body[5:7]), int(body[8:10]))
            c.setValue((d - EPOCH).days)
        elif t == 'B:':
            c.setValue(1 if body == 'True' else 0)
        else:
            c.setString(body)

    def calc(self):
        self.doc.calculateAll()

    def get(self, key):
        c = self.cell(key) if '!' in key else self.name_cell(key)
        return self.val(c)

    @staticmethod
    def val(c):
        from com.sun.star.table.CellContentType import EMPTY, VALUE, TEXT, FORMULA
        t = c.getType()
        if t == EMPTY:
            return None
        if t == VALUE:
            return c.getValue()
        if t == TEXT:
            return c.getString()
        # formula: result type
        if c.getError() != 0:
            return '#ERR%d' % c.getError()
        from com.sun.star.sheet.FormulaResult import VALUE as FV
        if c.FormulaResultType2 == FV:
            return c.getValue()
        s = c.getString()
        return s if s != '' else None

    def close(self):
        try:
            self.doc.close(True)
        except Exception:
            pass
        self.proc.terminate()
