# Crowdaxe Credit Rating System

Web application replacing `Crowdaxe_CRS.xlsm` (Workbook 1.1, Methodology 1.1). Work in progress by phase; see [docs/README.md](docs/README.md).

| Part                                                         | Status                                   |
| ------------------------------------------------------------ | ---------------------------------------- |
| `packages/engine`: calculation engine                        | Phase 1: parity with the workbook proven |
| `packages/db`: schema, migrations, loader, seed              | Phase 2                                  |
| `tools/import`: workbook importer with reconciliation report | Phase 2                                  |
| `apps/web`: the application                                  | Phases 3 to 6                            |

Development (Node 22, pnpm 10, PostgreSQL 16):

```bash
pnpm install
docker compose up -d db
cp .env.example packages/db/.env   # then set DATABASE_URL and DIRECT_URL to the local database
pnpm --filter @crowdaxe/db migrate:deploy
pnpm --filter @crowdaxe/db seed
pnpm test
```

Full setup and deployment guides follow in Phases 7 and 8.
