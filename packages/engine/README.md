# @crowdaxe/engine

The Crowdaxe Credit Rating System calculation engine: a pure TypeScript port of the `Crowdaxe_CRS.xlsm`
Scorecard, Financials, Collateral, Knockouts and Checks sheets and the Deal Activity routines. No database,
no UI, no clock: inputs in, full result out.

```ts
import { ParameterSet, parseRatingInput, parseHistorySnapshot, rate } from '@crowdaxe/engine';

const params = ParameterSet.parse(parameterSetJson); // validated; throws listing every problem
const input = parseRatingInput(formValues); // every missing field becomes blank
const history = parseHistorySnapshot(snapshot); // Deal History and Blacklist frozen at save (D-01)
const result = rate(input, params, history); // grades, PD, LGD, EL, knockouts, checks, statuses, texts
if (result.canFinalise) {
  /* no Error check, no blocked override, no integrity issue */
}
```

| Module              | Contents                                                                                                        | Spec                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/rate.ts`       | the rating calculation, in the workbook's order                                                                 | methodology-spec.md 2-19 |
| `src/activity.ts`   | Deal Activity → Deal History and Blacklist (as of a date), entry validation, override rate, Deal and Rating IDs | 13, 14, 20               |
| `src/parameters.ts` | parameter set schema and validation, typed accessors                                                            | 21                       |
| `src/inputs.ts`     | rating input and history snapshot schemas                                                                       | data-inventory.md 1      |
| `src/result.ts`     | result types                                                                                                    | data-inventory.md 2      |
| `src/excel.ts`      | Excel ROUND (15 significant digits, half away from zero), EDATE, serial dates, TEXT() formats                   | 1.3                      |
| `src/workbook.ts`   | workbook cells ↔ structured inputs and outputs (importer, parity tests)                                         | data-inventory.md 1      |

## Tests

```bash
pnpm --filter @crowdaxe/engine test           # all suites
pnpm --filter @crowdaxe/engine test:coverage  # with coverage (fails below 95%)
```

Fixtures in `fixtures/` come from the workbook through `tools/oracle` (parameter set 1.1, the TestCases sheet,
the saved ratings, Deal Activity, and 1,080 LibreOffice-recalculated golden cases). See
`docs/phase-1-report.md`.
