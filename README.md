# Arbitra Daily Longs

Arbitra UI currently has one job: show daily long setups from completed Yahoo Finance candles. The screen keeps the signal date, causal eligibility gates, and historical pullback-to-target evidence together without implying order authority.

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
