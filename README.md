# Arbitra Platform

Arbitra-UI has two primary views: **Stock Picker** (`/`) and **Crypto Scanner**
(`/oscillators`). Both are research-only, with no order execution. The platform
also retains the Great Data Oasis private control plane for Elijah's Ravens
historical Massive acquisitions, its PostgreSQL catalog and fenced job ledger.

The Stock Picker keeps:

- A date picker limited to the 30 most recent dates containing valid parent setups
- Exact-date eligible assets under four nested methodologies: SMC + PPO, ATR(10), BB(40), and EMA(20)
- ATR, Bollinger Band, and EMA gate readings for each selected asset
- Yahoo Finance company summaries, industries, employee counts, headquarters, and source links
- Suggested pullback entry and target exit prices derived from the selected asset's signal close
- Coverage, stale-row, missing-history, analysis-failure, and quality-rejection counts
- A responsive phone layout with stock and date selectors

The Crypto Scanner replaces the old ETF, RSI/Godmode crypto and oscillator-watch
groupings. It uses the frozen divergence-oscillator catalog, preserving all 230
raw/XGBoost winners and explicit unavailable states. Select a setup to open its
details; parameters, model features, provenance and research notes stay closed
until requested. Historical ranking is never displayed as a current BUY/SELL.

Legacy source components, snapshots, ingestion endpoints and research artifacts
remain retained but are not mounted in the main two-view interface. This does
not stop existing Railway workers or schedules. Oasis database, catalog,
ingestion and migration configuration remain in force as documented below.

This integration merges UI and proxy code only. It does not deploy the private
Python inference service, frozen models or candle archives. Live scanning still
requires that separately configured backend; merging or building this UI alone
does not make it available. No production Railway deployment, database migration
or Sites publication is performed by this merge.

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

The retained **Historical data acquisition** backend queues resumable unadjusted
one-minute Massive jobs for the top 10, top 50, an explicit ticker set, or the
confirmed current SPY universe. The platform owns job intent and progress; the
provider-facing Python worker remains in the Arbitra repository behind the
`arbitra-ingest-us-equities` extraction seam. Its console component is retained
but is not mounted in the main two-view interface; the following describes the
retained control plane and its configuration, not a new scanner dependency.

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

### Retained legacy oscillator watch

`npm run sync:data` still maintains `app/data/oscillator-alpha-watch.json` for the
retained research workflow, but the home page no longer imports or renders it.
Its producer/ingest checks remain tested. Old root-render tests are explicitly
marked retired, not described as stale-build skips.

`npm run build` now verifies the immutable Crypto Scanner catalog without
refreshing market data or requiring private model files. Use the dedicated
`npm run sync:frozen-oscillators` only when that pinned catalog must be copied.

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

## Crypto Scanner: frozen divergence oscillators

`/oscillators` displays the approved mixed top ten per asset: 230 entries across
23 assets, including 172 raw and 58 XGBoost-backed setups. Williams %R is excluded.
It keeps historical rankings separate from live entry admission and shows exact
parameters, ordered features, fold policies and model hashes. Native model files
remain on the private Python service, not under `public/`.

The scanner opens on **BTCUSDT via Binance**. The asset dropdown displays the
pair including its quote, while internal asset identity stays `BTC`. Asset and venue selectors remain
changeable; the API's legacy omitted-venue default remains Binance.

### Market signal wire (36-hour feed)

A ticker directly under the Crypto Scanner heading aggregates accepted signals
from all 23 frozen assets and every timeframe represented in their 230 saved
setups. This does not create new asset/timeframe models. Green LONG and red SHORT
cards show asset/pair, oscillator, timeframe, price at the signal's candle close,
signal time, and whether the event is active or historical. Clicking a card
selects its asset and setup. Only signals within the inclusive trailing 36 hours
are displayed; rejected, future and mismatched events are excluded. Historical
cards never revive an expired or cancelled active signal. The source journal
returns at most 200 events per asset, so this is a capped recent feed, not a claim
of exhaustive signal history.

The long-lived Node launcher owns `/api/frozen-oscillators/market?venue=binance`.
It scans immediately at startup, then on UTC quarter-hours plus ten seconds for
candle finalization. Binance runs while the server is running, even without an
open browser. Other supported venues scan for 30 minutes after their last viewer
request. All viewers share a single sequential upstream queue, capped to the four
venues; browser cache/progress reads every 15 seconds do not trigger additional
inference in the same scan cycle. Slow scans coalesce missed cycles rather than
overlap; scan completion is not guaranteed within 15 minutes during provider
timeouts. Coverage distinguishes pending, unavailable and stale assets from
fresh results. Directional breadth counts distinct assets over the 36-hour feed,
not committee votes, positions or the entire crypto market.

Cards use the selected timezone, support pause/hover/focus inspection and honor
reduced-motion preferences. Pausing reveals a Bitcoin steering wheel: hold its
gold handle and drag clockwise/counterclockwise to browse in either direction.
Arrow keys and Page Up/Down are alternatives. Pointer capture and seam-aware
angles prevent jumps; resuming retains the steered animation position. With
reduced motion, the wheel scrolls the stationary cards normally.

Price comes from the validated history event's `marketCondition.close`, whose
`as_of_utc` must equal its signal time. A `marketSnapshot` quote is a fallback only
when its candle close exactly equals the signal time. Older historical entries
never receive a newer quote, and their signal-time prices remain visible even
when the current feed is unavailable. Missing signal prices stay unavailable.
The
worker-only development/preview route returns an explicit unavailable response;
use `npm start` for background scheduling. The scheduler/cache is process-local,
so use the existing single UI replica. It does not replace the persistent signal
journal or fix the separate candle-archive refresh requirement.

Validation (no provider requests or training):

```powershell
node --test tests/frozen-oscillator-market.test.mjs tests/signal-market.test.mjs tests/crypto-signal-ticker-ui.test.mjs tests/ticker-wheel.test.mjs tests/frozen-oscillator-proxy.test.mjs tests/frozen-oscillator-ui.test.mjs
```

### Frozen catalog and live service setup

The dedicated sync authenticates the fixed catalog and does not rewrite existing
stock/crypto snapshots or the older oscillator-watch projection:

```powershell
npm.cmd run sync:frozen-oscillators
npm.cmd run build
$env:ARBITRA_OSCILLATOR_SERVICE_URL = 'http://127.0.0.1:8766'
npm.cmd start
```

Start the Python service from the sibling Arbitra root with its local environment:

```powershell
.\.venv\Scripts\python.exe -B scripts/serve_frozen_oscillators.py --check
.\.venv\Scripts\python.exe -B scripts/serve_frozen_oscillators.py --host 127.0.0.1 --port 8766
```

The Node launcher proxies `/api/frozen-oscillators/live?asset=ETH&venue=kraken` to the private
service. Use `npm start` for this live integration; the Vinext development
Worker does not automatically inherit private Node environment variables.
For Railway, use a `*.railway.internal` service origin and the same
`ARBITRA_OSCILLATOR_SERVICE_TOKEN` on both services. The Python service requires
a 24+ character non-whitespace ASCII token on non-loopback binds. Never put that
token in browser-visible environment variables. Required source data, dependency
and deployment prerequisites are documented in the sibling Arbitra
`docs/oscillator-ui-freeze-20260913.md`.

The **Data venue** selector routes only public spot market data: Binance/USDT,
Kraken/USD, Coinbase/USD or OKX/USDT. Omission of `venue` defaults to Binance for
older clients. Asset and venue must be allowlisted; unsupported pairs are refused
after exact product-metadata checks, without a different quote or venue fallback.
Changing either selection clears the previous signal immediately. Provider HTTP451
blocks remain isolated to that venue until service restart.

The engine keeps fold3 models and policies unchanged. Binance retains its
authenticated original prefix; alternate venues use a separately initialized,
append-only prefix. Alternate predictions are explicitly **unvalidated
cross-venue observations**. All displayed historical returns remain Binance
USDT results. Without an authenticated archive, initial public history is bounded:
up to 720 closed 15m bars on Kraken and up to 1200 on Coinbase/OKX. Each alternate
entry needs 200 complete parent bars plus native feature/structural warmup;
higher timeframes remain unavailable until enough same-venue history is present.

The sibling Python service can seed completed same-venue history from a portable
candle bundle configured with `ARBITRA_OSCILLATOR_CANDLE_MANIFEST` and its paired
`ARBITRA_OSCILLATOR_CANDLE_MANIFEST_SHA256`. The completed local Kraken backfills
are in that private bundle, not this UI repository or the browser catalog. Gaps
are not filled, Coinbase futures never substitute for Coinbase spot, and the
Binance frozen prefix is not overwritten. Candles fetched after the packaged
cutoff remain in memory and are lost on restart; the authenticated archive can
be reloaded. The separate signal-evaluation journal below survives restarts when
its storage is persistent. Neither the bundle nor this merge establishes
cross-venue profitability. See the sibling Arbitra
`docs/oscillator-ui-candle-bundle-20260914.md` for backend archive prerequisites.

Old raw pulses are not new entries. An accepted entry can remain visible as a
separately labelled recent signal under the display-only rule below; raw opposite
exits do not require XGB admission. The service never places orders. Real ETH checks fetched closed
candles and scored eligible models through Kraken, Coinbase and OKX; Binance
still returned HTTP451 locally. These checks do not establish all-asset coverage
or profitability on the new venues. Sites and Railway production were not deployed.

```powershell
node --test tests/frozen-oscillator-proxy.test.mjs tests/frozen-oscillator-ui.test.mjs tests/rendered-html.test.mjs
```

### Signal diagnostics and history

The entry column distinguishes a latest-close **BUY/SELL** from **Recent BUY/SELL**.
`current_signal` still means a newly accepted entry on the latest closed native
15-minute candle, regardless of oscillator timeframe. The server's separate
`recent_signal` retains an accepted entry for `max(60, timeframeMinutes)` minutes:
30m and 1h setups get 60 minutes, 2h setups get 120 minutes, and so on. This is
display retention, not a new entry, position, execution rule, or additional
profitability evidence; frozen models, admission policies and backtests do not
change.

The window starts at `decision_utc`, when the signal candle closed, not the
request/evaluation time. Expiry is exclusive: a 12:00 UTC signal with a 60-minute
window is no longer recent at 13:00 UTC. The table and selected-setup details show
decision age and expiry in the selected timezone. A later opposite **raw** pulse
cancels the retained entry even if XGB rejects that opposite entry. A rejected same-direction pulse
does not reset its age or expiry. The latest raw event and its admission may
therefore differ from the retained accepted entry; the details label them
separately.

The UI validates the server's direction, timezone-aware timestamps, exact
timeframe-derived lifetime and latest-close marker. An absent, null, malformed,
future or expired `recent_signal` does not produce a recent badge. The historical
list is never used to revive one. Neither an unavailable row nor a stale or
unavailable feed can assert a latest or recent badge: the existing guards still
require an evaluation and completed candles no older than 17 minutes, allowing
the 15-minute scan cadence plus a small completion allowance. Freshness is distinct from signal age, so a longer recency
window does not permit stale market data.

The existing 15-second render tick advances age and removes expired badges;
quarter-hour polling (ten seconds after the close) receives cancellations and
newly accepted entries. Selecting another asset/venue, resuming a visible tab,
or pressing Refresh also requests the selected asset. There is no
intrabar calculation. A cancellation appears after the next completed poll, and
background-tab throttling can delay repainting. Active-entry counts include both
latest-close and recent badges, split explicitly; saved history is counted
separately.

The live table distinguishes a quiet close, XGB rejection, ineligible events,
insufficient same-venue warm-up and inference failure. It displays actual versus
required parent-candle counts and the last raw pulse. An all-unavailable response
retains these diagnostics instead of being discarded by the UI.

The Historical signals section filters by timeframe and accepted entries versus
all raw signals. Rows show the asset/pair/venue, oscillator/version, signal-close
timestamp and evaluation timestamp (stored in UTC, displayed in the selected
timezone), admission and market conditions at the signal close. Trend uses
native close/EMA20/EMA50 alignment; context includes
bar/1h/24h price changes, Wilder ATR14 as percent of close, trailing 96 per-15m
return volatility and current volume / previous 20-bar mean. These descriptive
fields are not added to frozen model inputs.

Observed rows were evaluated on their latest native close. Reconstructed rows
are evaluated later using the frozen fold3 checkpoint; they are not prior live
calls, positions or backtest performance. On a Binance outage the service may
replay only authenticated Binance cache candles into history, prominently dated,
without asserting any current entry or switching venue. The proxy deliberately
preserves history inside a 503/unavailable envelope. The screen also retains its
last loaded history on a transport failure while suppressing live signals.

The Python service journals evaluations in SQLite by default at
`work/oscillator-live/signal-history.sqlite3`. Configure the Python service's
`ARBITRA_OSCILLATOR_HISTORY_DB` on a persistent Railway volume before deploying
there; no UI secret or Sites binding is needed. First evaluations are immutable;
observed evidence takes display precedence over a later replay of the same event.
Alternative prefix initializations remain distinct. No trades are recorded or sent.

Only the selected/requested asset is evaluated. Replay is bounded to seven days
and 50 raw events per setup; the screen returns the latest 200 saved events per
asset/venue. Empty history is not proof that a strategy never signalled. Existing
warm-up limits still apply. Local implementation only; Sites remains unchanged.

### Scanner display timezone

The scanner's Timezone selector defaults to **Automatic**, detecting the
browser's IANA timezone after mounting. A manual choice is saved only in that
browser under `arbitra.oscillators.timeZone`; choose Automatic to return to the
browser default. The manual menu contains 30 curated choices: UTC and common
USA, Europe, Central America and South America timezones, ordered by region.
Invalid or no-longer-listed saved settings fall back to Automatic without
expanding the menu. Automatic still detects a browser outside those regions.
Blocked browser storage does not prevent an in-memory choice.

The choice applies to candle freshness timestamps, latest raw signals, accepted
entry/expiry details, historical signals and evaluation times, history coverage,
and the frozen-at timestamp. Dates include their date-specific UTC offset, so
daylight-saving transitions and fractional offsets remain unambiguous. Signal
ages, expiry instants, ordering, model inputs, API requests and stored UTC values
are unchanged. UTC is used during server rendering until browser detection;
the manual list does not depend on browser-wide timezone enumeration. Unsupported
choices are omitted on older Intl runtimes, and recognized aliases map back to
their shortlisted zone.

Validate with `node --test tests/oscillator-timezones.test.mjs
tests/frozen-oscillator-ui.test.mjs tests/frozen-oscillator-proxy.test.mjs`.
This is local UI behavior; no Railway or Sites deployment is implied.

Historical signal rows from the current calendar day are bold; other days are
neutral grey with normal font weight, including their smaller detail text.
The day is computed from the original signal timestamp in the selected timezone,
not the evaluation/replay timestamp or a rolling 24-hour window. The existing
15-second render tick updates the styling after local midnight; changing the
timezone updates it immediately. This does not change signal admission, recency,
history filtering or stored UTC data.

The top ranked table's **Latest raw signal** column uses the same rule for both
BUY/SELL text and its timestamp: today is bold; other days are neutral grey.
Classification uses `latest_raw_event.decision_utc` in the selected timezone.
It does not alter the live-entry badge or imply that a raw event was accepted
by XGBoost. Missing or untrusted raw events remain an unstyled dash.

The Eastern option is labeled **Florida / New York — Eastern Time** and keeps
the existing `America/New_York` identity and daylight-saving rules. Most Florida
uses this option; the western Panhandle uses Central Time (`America/Chicago`).
This is a display label, not an additional timezone or a fixed UTC offset.
