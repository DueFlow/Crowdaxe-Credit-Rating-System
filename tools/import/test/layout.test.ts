/** The reader refuses a workbook that is not the CRS workbook, or whose layout has changed. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readWorkbook, WorkbookLayoutError } from '../src/readWorkbook.js';

async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<string> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const path = join(mkdtempSync(join(tmpdir(), 'crs-')), 'test.xlsx');
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  return path;
}

describe('workbook layout checks', () => {
  it('refuses a workbook without the CRS sheets', async () => {
    const p = await workbook((wb) => wb.addWorksheet('Sheet1'));
    await expect(readWorkbook(p)).rejects.toThrow(WorkbookLayoutError);
    await expect(readWorkbook(p)).rejects.toThrow(
      'Sheet "Parameters" not found: is this the Crowdaxe CRS workbook?',
    );
  });
  it('refuses a Parameters sheet whose headers have moved', async () => {
    const p = await workbook((wb) => {
      const ws = wb.addWorksheet('Parameters');
      ws.getCell('B5').value = 'Parameter';
    });
    await expect(readWorkbook(p)).rejects.toThrow(
      /Sheet "Parameters" row 5: expected headers Name, Value, Unit, Methodology, Note/,
    );
  });
});
