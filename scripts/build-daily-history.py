"""Build the compact daily-long history consumed by Arbitra UI.

The builder evaluates each local Yahoo candle history once, preserves the
causal signal and gate definitions from Arbitra, and stores realized matrix
outcomes only when the complete 5-candle fill plus 20-candle target window has
matured. Yahoo company profiles are cached in the generated payload.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from typing import Any
from urllib.parse import quote

import numpy as np
import pandas as pd


UI_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARBITRA_ROOT = UI_ROOT.parent / "Arbitra"
DEFAULT_SCRAPPY_ROOT = UI_ROOT.parent / "scrappy"
PULLBACK_PERCENTAGES = tuple(float(value) for value in np.arange(0.5, 5.01, 0.5))
TARGET_PERCENTAGES = PULLBACK_PERCENTAGES
ENTRY_WINDOW = 5
TARGET_WINDOW = 20


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arbitra-root", type=Path, default=DEFAULT_ARBITRA_ROOT)
    parser.add_argument("--history-root", type=Path, default=DEFAULT_SCRAPPY_ROOT / "data" / "prices")
    parser.add_argument(
        "--asset-list",
        type=Path,
        action="append",
        default=None,
        help="Repeat for each platform universe CSV.",
    )
    parser.add_argument("--start-date", default="2026-07-01")
    parser.add_argument("--end-date", default="2026-08-10")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--profile-workers", type=int, default=4)
    parser.add_argument("--max-assets", type=int)
    parser.add_argument("--skip-profiles", action="store_true")
    parser.add_argument(
        "--output",
        type=Path,
        default=UI_ROOT / "public" / "data" / "arbitra-daily-history.json",
    )
    return parser.parse_args()


def _configure_arbitra_imports(arbitra_root: Path) -> None:
    resolved = str(arbitra_root.resolve())
    if resolved not in sys.path:
        sys.path.insert(0, resolved)


def _iso_date(value: object) -> str:
    return pd.Timestamp(value).date().isoformat()


def _json_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _realized_outcomes(frame: pd.DataFrame, signal_position: int) -> list[dict[str, object]]:
    """Evaluate the exact matrix contract for one fully matured signal."""

    open_values = frame["open"].to_numpy(float)
    high_values = frame["high"].to_numpy(float)
    low_values = frame["low"].to_numpy(float)
    close_values = frame["close"].to_numpy(float)
    index = frame.index
    outcomes: list[dict[str, object]] = []

    for pullback_percent in PULLBACK_PERCENTAGES:
        limit_price = close_values[signal_position] * (1.0 - pullback_percent / 100.0)
        fill_start = signal_position + 1
        fill_end = signal_position + ENTRY_WINDOW
        candidates = np.flatnonzero(low_values[fill_start : fill_end + 1] <= limit_price)
        filled = bool(len(candidates))
        fill_position = fill_start + int(candidates[0]) if filled else None
        entry_price = (
            min(open_values[fill_position], limit_price)
            if fill_position is not None
            else None
        )

        for target_percent in TARGET_PERCENTAGES:
            target_hit = False
            target_date: str | None = None
            target_price: float | None = None
            if fill_position is not None and entry_price is not None:
                target_price = entry_price * (1.0 + target_percent / 100.0)
                target_start = fill_position + 1
                target_end = fill_position + TARGET_WINDOW
                hits = np.flatnonzero(
                    high_values[target_start : target_end + 1] >= target_price
                )
                if len(hits):
                    target_hit = True
                    target_date = _iso_date(index[target_start + int(hits[0])])
            outcomes.append(
                {
                    "pullbackPercent": pullback_percent,
                    "targetPercent": target_percent,
                    "filled": filled,
                    "targetHit": target_hit,
                    "fillDate": _iso_date(index[fill_position]) if fill_position is not None else None,
                    "entryPrice": _json_number(entry_price),
                    "targetPrice": _json_number(target_price),
                    "targetDate": target_date,
                }
            )
    return outcomes


def _analyze_asset(task: tuple[dict[str, object], str, str, str, str]) -> dict[str, object]:
    asset, history_root, arbitra_root, start_date, end_date = task
    _configure_arbitra_imports(Path(arbitra_root))
    import ta
    from arbitra_liquidity_sniper import PPO_FAST, PPO_SIGNAL, PPO_SLOW
    from arbitra_ppo_playbook import compute_ppo_playbook_context
    from arbitra_tradability import evaluate_tradability
    from arbitra_tv_indicators.base import validated_ohlcv
    from arbitra_tv_indicators.refined import LiquiditySweepIndicator
    from arbitra_tv_indicators.specs import LiquiditySweepSpec

    symbol = str(asset["symbol"])
    family = str(asset["instrument_family"])
    path = Path(history_root) / family / f"{symbol}.parquet"
    if not path.is_file():
        return {"status": "history_missing", "symbol": symbol}

    try:
        frame = pd.read_parquet(path)
        frame["date"] = pd.to_datetime(frame["date"], utc=True, errors="coerce")
        cutoff = pd.Timestamp(end_date, tz="UTC")
        frame = (
            frame.dropna(subset=["date"])
            .loc[lambda value: value["date"] <= cutoff]
            .set_index("date")
            .sort_index()
        )
        if frame.empty:
            return {"status": "analysis_failed", "symbol": symbol, "error": "empty history"}

        frame = validated_ohlcv(frame)
        start = pd.Timestamp(start_date, tz="UTC")
        exact_dates = [
            _iso_date(value)
            for value in frame.index[(frame.index >= start) & (frame.index <= cutoff)]
        ]
        # PPO needs every prior close for its expanding median, but liquidity
        # only needs levels still alive at the first requested date. Restricting
        # that stateful calculation to its exact 521-row causal window makes a
        # multi-date universe refresh practical without changing the signal.
        ppo_histogram = ta.momentum.ppo_hist(
            frame["close"],
            window_slow=PPO_SLOW,
            window_fast=PPO_FAST,
            window_sign=PPO_SIGNAL,
            fillna=False,
        )
        ppo_prior_median = ppo_histogram.expanding(min_periods=100).median().shift(1)
        first_requested = int(frame.index.searchsorted(start, side="left"))
        last_requested = int(frame.index.searchsorted(cutoff, side="right")) - 1
        liquidity_spec = LiquiditySweepSpec()
        state_rows = (
            liquidity_spec.expiry_bars
            + liquidity_spec.pivot_left
            + liquidity_spec.pivot_right
            + 1
        )
        liquidity_start = max(0, first_requested - state_rows + 1)
        liquidity_slice = frame.iloc[liquidity_start : last_requested + 1]
        liquidity = LiquiditySweepIndicator(liquidity_spec).compute(liquidity_slice)
        accepted_above = pd.Series(False, index=frame.index)
        accepted_above.loc[liquidity.index] = liquidity["tv.liquidity.accepted_above"].eq(1.0)
        primary_signal = (
            accepted_above
            & ppo_histogram.lt(ppo_prior_median)
            & ppo_histogram.notna()
            & ppo_prior_median.notna()
        )
        positions = np.flatnonzero(
            primary_signal.to_numpy(bool)
            & (frame.index >= start)
            & (frame.index <= cutoff)
        )
        green: list[dict[str, object]] = []
        rejected_dates: list[str] = []

        for raw_position in positions:
            position = int(raw_position)
            signal_date = _iso_date(frame.index[position])
            quality = evaluate_tradability(frame, position)
            if not bool(quality["tradability_pass"]):
                rejected_dates.append(signal_date)
                continue
            context = compute_ppo_playbook_context(frame, position)
            atr_pass = bool(context["atr10_pass"])
            bb_pass = bool(context["bollinger_width_40_pass"])
            ema_pass = bool(context["ema20_distance_pass"])
            methodologies = ["smc-ppo"]
            if atr_pass:
                methodologies.append("smc-ppo-atr10")
                if bb_pass:
                    methodologies.append("smc-ppo-atr10-bb40")
                if ema_pass:
                    methodologies.append("smc-ppo-atr10-ema20")

            evaluation_mature = position + ENTRY_WINDOW + TARGET_WINDOW < len(frame)
            green.append(
                {
                    "symbol": symbol,
                    "name": str(asset.get("name", "")),
                    "instrumentFamily": family,
                    "exchange": str(asset.get("exchange", "")),
                    "signalDate": signal_date,
                    "close": _json_number(frame["close"].iloc[position]),
                    "ppo": _json_number(ppo_histogram.iloc[position]),
                    "ppoPriorMedian": _json_number(ppo_prior_median.iloc[position]),
                    "atr10Percent": _json_number(context["atr10_percent"]),
                    "atr10ThresholdPercent": _json_number(context["atr10_prior_q70_percent"]),
                    "atr10Pass": atr_pass,
                    "bb40Width": _json_number(context["bollinger_width_40"]),
                    "bb40Threshold": _json_number(context["bollinger_width_40_prior_q80"]),
                    "bb40Pass": bb_pass,
                    "ema20DistancePercent": _json_number(context["ema20_distance_percent"]),
                    "ema20ThresholdPercent": _json_number(context["ema20_distance_prior_q90_percent"]),
                    "ema20Pass": ema_pass,
                    "ema5": _json_number(context["ema5"]),
                    "ema10": _json_number(context["ema10"]),
                    "ema20": _json_number(context["ema20"]),
                    "ema50": _json_number(context["ema50"]),
                    "emaBullStack": bool(context["ema_bull_stack_5_10_20_50"]),
                    "launchWatch": bool(context["launch_discontinuity_watch"]),
                    "methodologies": methodologies,
                    "evaluationMature": evaluation_mature,
                    "evaluationThrough": (
                        _iso_date(frame.index[position + ENTRY_WINDOW + TARGET_WINDOW])
                        if evaluation_mature
                        else None
                    ),
                    "realizedOutcomes": (
                        _realized_outcomes(frame, position) if evaluation_mature else []
                    ),
                }
            )

        return {
            "status": "ok",
            "symbol": symbol,
            "exactDates": exact_dates,
            "rejectedDates": rejected_dates,
            "assets": green,
        }
    except Exception as exc:  # Keep one broken symbol from blocking the universe.
        return {
            "status": "analysis_failed",
            "symbol": symbol,
            "error": f"{type(exc).__name__}: {exc}",
        }


def _fetch_yahoo_profile(symbol: str) -> tuple[str, dict[str, object]]:
    import yfinance as yf

    fetched_at = datetime.now(timezone.utc).isoformat()
    source_url = f"https://finance.yahoo.com/quote/{quote(symbol, safe='-._^=')}/profile/"
    try:
        info = yf.Ticker(symbol).get_info()
        description = str(info.get("longBusinessSummary") or "").strip()
        profile = {
            "symbol": symbol,
            "longName": info.get("longName") or info.get("shortName") or symbol,
            "description": description,
            "employees": info.get("fullTimeEmployees"),
            "city": info.get("city"),
            "state": info.get("state"),
            "country": info.get("country"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "website": info.get("website"),
            "source": "Yahoo Finance",
            "sourceUrl": source_url,
            "fetchedAt": fetched_at,
            "available": bool(description or info.get("industry") or info.get("city")),
        }
    except Exception:
        profile = {
            "symbol": symbol,
            "longName": symbol,
            "description": "",
            "employees": None,
            "city": None,
            "state": None,
            "country": None,
            "sector": None,
            "industry": None,
            "website": None,
            "source": "Yahoo Finance",
            "sourceUrl": source_url,
            "fetchedAt": fetched_at,
            "available": False,
        }
    return symbol, profile


def _dates(start_date: str, end_date: str) -> list[str]:
    current = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if current > end:
        raise ValueError("start-date must not be after end-date")
    values: list[str] = []
    while current <= end:
        values.append(current.isoformat())
        current += timedelta(days=1)
    return values


def main() -> int:
    args = parse_args()
    if not 1 <= args.workers <= 16:
        raise SystemExit("--workers must be between 1 and 16")
    if not 1 <= args.profile_workers <= 8:
        raise SystemExit("--profile-workers must be between 1 and 8")
    arbitra_root = args.arbitra_root.resolve()
    _configure_arbitra_imports(arbitra_root)
    from arbitra_platform_asset_list import load_platform_asset_list

    asset_lists = args.asset_list or [
        DEFAULT_SCRAPPY_ROOT / "data" / "universe" / "us_stocks.csv",
        DEFAULT_SCRAPPY_ROOT / "data" / "universe" / "crypto_usd.csv",
    ]
    universes = [load_platform_asset_list(path.resolve()).universe for path in asset_lists]
    universe = pd.concat(universes, ignore_index=True).drop_duplicates("symbol", keep="first")
    if args.max_assets:
        universe = universe.head(args.max_assets)
    rows = universe.to_dict("records")
    date_values = _dates(args.start_date, args.end_date)
    date_set = set(date_values)
    exact_counts = {value: 0 for value in date_values}
    rejected_counts = {value: 0 for value in date_values}
    assets_by_date: dict[str, list[dict[str, object]]] = {value: [] for value in date_values}
    missing = 0
    failed = 0
    failures: list[dict[str, str]] = []
    tasks = (
        (asset, str(args.history_root.resolve()), str(arbitra_root), args.start_date, args.end_date)
        for asset in rows
    )

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        for index, result in enumerate(executor.map(_analyze_asset, tasks, chunksize=12), start=1):
            status = result["status"]
            if status == "history_missing":
                missing += 1
            elif status == "analysis_failed":
                failed += 1
                failures.append({"symbol": str(result["symbol"]), "error": str(result.get("error", ""))})
            else:
                for value in result["exactDates"]:
                    if value in date_set:
                        exact_counts[value] += 1
                for value in result["rejectedDates"]:
                    if value in date_set:
                        rejected_counts[value] += 1
                for asset in result["assets"]:
                    assets_by_date[str(asset["signalDate"])].append(asset)
            if index % 250 == 0 or index == len(rows):
                print(f"Analyzed {index:,} / {len(rows):,} assets", flush=True)

    unique_stock_symbols = sorted(
        {
            str(asset["symbol"])
            for values in assets_by_date.values()
            for asset in values
            if asset["instrumentFamily"] == "stock"
        }
    )
    existing_profiles: dict[str, Any] = {}
    if args.output.is_file():
        try:
            existing_profiles = json.loads(args.output.read_text(encoding="utf-8")).get("profiles", {})
        except (json.JSONDecodeError, OSError):
            existing_profiles = {}
    profiles = {symbol: existing_profiles[symbol] for symbol in unique_stock_symbols if symbol in existing_profiles}
    missing_profiles = [symbol for symbol in unique_stock_symbols if symbol not in profiles]
    if not args.skip_profiles and missing_profiles:
        print(f"Fetching {len(missing_profiles):,} Yahoo company profiles", flush=True)
        with ThreadPoolExecutor(max_workers=args.profile_workers) as executor:
            futures = {executor.submit(_fetch_yahoo_profile, symbol): symbol for symbol in missing_profiles}
            for completed, future in enumerate(as_completed(futures), start=1):
                symbol, profile = future.result()
                profiles[symbol] = profile
                if completed % 25 == 0 or completed == len(futures):
                    print(f"Fetched {completed:,} / {len(futures):,} profiles", flush=True)

    generated_at = datetime.now(timezone.utc).isoformat()
    datasets: list[dict[str, object]] = []
    for value in reversed(date_values):
        assets = sorted(
            assets_by_date[value],
            key=lambda item: (
                -len(item["methodologies"]),
                -int(bool(item["launchWatch"])),
                str(item["symbol"]),
            ),
        )
        exact = exact_counts[value]
        datasets.append(
            {
                "date": value,
                "generatedAt": generated_at,
                "sourceRun": f"causal-history-{args.start_date}-{args.end_date}",
                "universe": len(rows),
                "exactDateAnalyzed": exact,
                "staleAnalyzed": max(0, len(rows) - exact - missing - failed),
                "historyMissing": missing,
                "analysisFailed": failed,
                "qualityRejected": rejected_counts[value],
                "assets": assets,
            }
        )

    payload = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "startDate": args.start_date,
        "endDate": args.end_date,
        "universe": len(rows),
        "profiles": dict(sorted(profiles.items())),
        "datasets": datasets,
        "failures": failures,
        "evaluation": {
            "entryWindowCompletedCandles": ENTRY_WINDOW,
            "targetWindowCompletedCandlesAfterFill": TARGET_WINDOW,
            "fillCandleTargetAllowed": False,
            "stopUsed": False,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    signal_count = sum(len(dataset["assets"]) for dataset in datasets)
    mature_count = sum(
        int(bool(asset["evaluationMature"]))
        for dataset in datasets
        for asset in dataset["assets"]
    )
    print(
        f"Wrote {len(datasets)} dates, {signal_count} eligible signals, "
        f"{mature_count} matured outcomes, and {len(profiles)} profiles to {args.output}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
