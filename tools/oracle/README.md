# LibreOffice parity oracle (development only)

Phase 0 tooling. Loads the original workbook in headless LibreOffice, writes inputs into the input cells, recalculates and reads results. It is an independent check of the specification and will generate golden fixtures for the engine tests in Phase 1. It is never deployed.

Requirements: LibreOffice with Python UNO (`python3 -c "import uno"`), `openpyxl`.

```bash
export CRS_WORKBOOK=/path/to/Crowdaxe_CRS.xlsm
python3 run_checks.py   # 102 TestCases checks, then the 7 saved ratings against the current sheets
python3 run_asat.py     # the 7 saved ratings with Deal History and Blacklist rebuilt as at each rating date
python3 history.py      # Deal Activity -> Deal History / Blacklist derivation, checked against the sheet
```

Fixture generation for the engine tests (Phase 1):

```bash
python3 extract_params.py > ../../packages/engine/fixtures/parameter-set-1.1.json
python3 export_fixtures.py ../../packages/engine/fixtures
python3 generate_golden.py ../../packages/engine/fixtures/parameter-set-1.1.json golden.json 30 20261113
gzip -9 golden.json   # the committed fixture merges two batches; see docs/phase-1-report.md
```

`lo.py` switches LibreOffice to manual calculation and clears and reads cells in blocks (about 0.3 s a case).

Results on 13 November 2026: TestCases 102 of 102; saved ratings 4 of 7 against current sheets, 7 of 7 as at rating date (see `docs/discrepancies.md` D-01).

`input_cells.json` lists the unlocked input cells of the Scorecard, Collateral and Financials sheets (the cells `modRating.InputCells` saves).

The workbook itself is not committed (it contains borrower data).
