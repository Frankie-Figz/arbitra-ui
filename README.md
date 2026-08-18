# Arbitra Platform

Arbitra Platform shows research-only market setups and now owns the private
control plane for Elijah's Ravens historical Massive acquisitions. The screen
keeps signal evidence, data-job state and downloadable immutable artifacts
together without implying order authority.

The focused release includes:

- A date picker limited to the 30 most recent dates containing valid parent setups
- Exact-date eligible assets under four nested methodologies: SMC + PPO, ATR(10), BB(40), and EMA(20)
- ATR, Bollinger Band, and EMA gate readings for each selected asset
- Yahoo Finance company summaries, industries, employee counts, headquarters, and source links
- Clickable 10 × 10 pullback/target heatmaps
- Diagonally split pullback-versus-target validation cells once the complete outcome window has matured
- Suggested pullback entry and target exit prices derived from the selected asset's signal close
- Coverage, stale-row, missing-history, analysis-failure, and quality-rejection counts
- A responsive phone layout with swipeable methodology and asset selectors

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run sync:data
npm run dev
```

## Local production preview

Build and start the optimized interface at `http://127.0.0.1:3001`:

```bash
npm run build
npm start
```

The local launcher resolves URL paths through Node's cross-platform path APIs
and serves the generated browser assets directly, so the same command works on
Windows, macOS, and Linux.

## Historical data jobs

The **Historical data acquisition** console queues resumable unadjusted
one-minute Massive jobs for the top 10, top 50, an explicit ticker set, or the
confirmed current SPY universe. The platform owns job intent and progress; the
provider-facing Python worker remains in the Arbitra repository behind the
`arbitra-ingest-us-equities` extraction seam.

```text
browser administrator
  -> arbitra-platform job API + Great Data Oasis PostgreSQL ledger
  -> Railway-private worker API
  -> Elijah's Ravens worker -> Massive + State Street
  -> private Railway Bucket
  -> 15-minute presigned browser download
```

The browser administrator token stays in React memory and is never written to
local storage. The worker uses a separate token over Railway's private network.
The Massive key belongs only to the worker and must not be added to this UI
service.

For local development, copy the variable names from `.env.example` into an
ignored `.env` or your shell. The Node launcher reads:

- `ARBITRA_DATABASE_URL` — Railway-private PostgreSQL connection for the
  versioned data catalog and fenced job ledger. The service refuses startup if
  the exact Great Data Oasis migration set is absent or unexpected.
- `ARBITRA_INGEST_DATABASE_URL` — optional second PostgreSQL login granted only
  `oasis_ingest`. The API login should receive `oasis_api`; omitting the worker
  URL reuses the API connection only for backward-compatible local setup.
- `ARBITRA_DATA_JOBS_ROOT` — local compatibility ledger used only when no
  PostgreSQL URL is configured. Existing JSON jobs remain historical evidence;
  they are not silently rewritten into database rows.
- `ARBITRA_PLATFORM_JOB_TOKEN` — bearer secret entered by the administrator in
  the private console.
- `ARBITRA_DATA_WORKER_TOKEN` — distinct bearer secret shared only with the
  worker.
- `BUCKET_NAME`, `BUCKET_ENDPOINT`, `BUCKET_REGION`,
  `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY` — credentials for the same
  private bucket used by the worker.
- `BUCKET_FORCE_PATH_STYLE=true` — only for legacy buckets whose Railway
  Credentials tab explicitly requires path-style URLs.

In Railway, bind the two database URLs to separate `oasis_api` and
`oasis_ingest` logins on the private PostgreSQL service, and apply the versioned
migrations from the Arbitra repository before starting the UI. Retain the
private Railway Bucket and map its provided `BUCKET`, `ENDPOINT`,
`REGION`, `ACCESS_KEY_ID`, and `SECRET_ACCESS_KEY` variables to the names above.
The API emits a presigned GET only after a job reaches `completed`; neither
bucket credentials nor the Massive key are returned to the browser. Keep one
worker replica until the fenced restart smoke has passed.

The read-only `/api/data-catalog/v1` surface resolves registered dataset IDs,
quality assessments, upstream evidence/unavailable ledgers, experiment
references and parameter locks directly from PostgreSQL. It never discovers
records by listing the bucket. Dataset downloads use the same bounded presigner
as historical job artifacts.

The worker-only `/internal/data-jobs/:id/admit` route accepts a bounded, strict
Oasis publication under the current lease fence. It transactionally registers
catalog identities, content locators, dataset versions, parent relationships,
quality assessments and artifacts. `/complete-manifest` succeeds only after the
result record and object acknowledgements exist. The legacy `/complete` route is
retained for old jobs and remains visibly labelled `legacy_unadmitted`.

Useful local checks are:

```powershell
npm.cmd test
npm.cmd run build
$env:ARBITRA_DATA_JOBS_ROOT = "$PWD\work\data-jobs"
$env:ARBITRA_PLATFORM_JOB_TOKEN = "local-admin"
$env:ARBITRA_DATA_WORKER_TOKEN = "local-worker"
npm.cmd start
```

The full current-constituent selection requires a second visible confirmation.
Do not use it as the first deployment smoke; queue a one-ticker completed-date
job, verify its manifest and bundle, then run the top-ten two-year pilot.

## Updating the interface from Arbitra

The UI reads a generated snapshot at `public/data/arbitra-snapshot.json`. Refresh it after a daily scanner run or matrix artifact changes:

```bash
npm run sync:data
```

By default, the synchronizer reads a sibling repository named `Arbitra`. Point it elsewhere with `ARBITRA_REPO`:

```bash
ARBITRA_REPO=/path/to/Arbitra npm run sync:data
```

The sync task indexes:

- `artifacts/yahoo-liquidity-sniper/*/report.json`
- `artifacts/yahoo-liquidity-sniper/*/latest-scan.csv`
- `artifacts/liquidity-ppo-atr-pullback-target-grid-v1/platform-full-*/confirmation-unfiltered-*.csv`
- `docs/ppo-pullback-playbook/data/{atr10,atr10-bb40,atr10-ema20}-*.csv`
- `public/data/arbitra-daily-history.json`, when the historical builder has generated it

For routine stock-selector refreshes, Arbitra's single Railway Yahoo worker sends an accepted snapshot to the UI over Railway's private network after whole-market coverage and freshness gates pass. The Railway UI stores it atomically at `ARBITRA_RUNTIME_SNAPSHOT_PATH` (default `/data/arbitra-snapshot.json`) on its own mounted volume and refreshes the browser feed without changing the protected production branch. `ARBITRA_UI_INGEST_TOKEN` must contain the same secret on the selector and UI services. Failed, stale, holiday, unauthenticated, or under-covered scans leave the last accepted selector untouched. The bundled `public/data/arbitra-snapshot.json` remains the local and Sites fallback. The worker remains research-only and cannot submit orders.

Hourly OKX crypto refreshes use the separate Railway-private `/internal/crypto-selector-snapshot` contract and `ARBITRA_UI_CRYPTO_INGEST_TOKEN`. That endpoint accepts only the research-only crypto surface; it cannot replace stock datasets, profiles, ETF evidence, or model evidence. Stock publications preserve the current crypto surface, and both mutation paths are serialized before atomically replacing the runtime file.

Only green signals whose candle date exactly matches the selected date are eligible. ATR is the parent gate for the BB and EMA variants; BB or EMA never creates a setup on its own. The matrix supplies historical context for a chosen pullback and target, not a forecast or an order.

To rebuild the July 1 onward history and refresh missing Yahoo profiles, run the builder with Arbitra's Python environment before synchronizing the final snapshot:

```powershell
..\Arbitra\.venv\Scripts\python.exe scripts\build-daily-history.py `
  --start-date 2026-07-01 `
  --end-date 2026-08-10
npm run sync:data
```

Realized matrix cells are emitted only after enough completed candles exist for the entire five-candle entry window and the slowest possible twenty-candle post-fill target window. The lower-left triangle reports whether the pullback filled; the upper-right reports whether the matching target-price mark was reached. When no pullback fills, the target mark is still evaluated from the hypothetical pullback price across the complete twenty-five-candle window. Green means achieved and red means missed; immature outcomes are never painted red.

## Validation

```bash
npm run build
npm test
```

This interface is research-only. It does not grant deployment or order authority.
