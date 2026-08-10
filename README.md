# Arbitra UI

Arbitra UI is the research-facing interface for the Arbitra project. It keeps presentation and deployment separate from model training while preserving the identities that make financial evidence comparable: model family, direction, barrier, horizon, candle interval, objective, evidence period, features, and protected references.

The first release includes:

- An interactive registry of all 18 biblical model baskets
- Binary classifier validation and selection metrics by LONG/SHORT, BPS, and horizon
- Jacob’s excursion-hazard ladder without mixing Brier loss with classifier F1
- Registered feature manifests and protected reference identities
- A daily Liquidity Sniper research-candidate view
- Refined Python and optimized TradingView indicator inventories
- Scheduled evidence lanes and explicit coverage gaps

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run sync:data
npm run dev
```

## Updating the interface from Arbitra

The UI reads a generated snapshot at `public/data/arbitra-snapshot.json`. Refresh it after model definitions or indexed artifacts change:

```bash
npm run sync:data
```

By default, the synchronizer reads a sibling repository named `Arbitra`. Point it elsewhere with `ARBITRA_REPO`:

```bash
ARBITRA_REPO=/path/to/Arbitra npm run sync:data
```

The sync task currently indexes:

- `config/models/*.json`
- `artifacts/all-generation-governments/governments.json`
- `artifacts/requested-daily-governments/summary.json`
- `artifacts/parameterized-retraining/summary.json`
- `artifacts/jacob/registered-ablation/*/ablation.json`

The daily scanner panel is a seeded research snapshot until its scheduled export is added to this same contract. Missing candle sizes and evaluation cells are displayed as unavailable, never as zero.

## Validation

```bash
npm run build
npm test
```

This interface is research-only. It does not grant deployment or order authority.
