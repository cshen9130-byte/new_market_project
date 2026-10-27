# 注册仓单 (FTREGORDERVOL) ETL

## Why
国君 CTA **库存 (GTJAQH007)** fit from -ΔOI proxy was weak. Exchange **注册仓单** is a stronger inventory-related signal for commodities.

## Table

aw_futures_warehouse_receipts_daily
- 	rade_date, wind_code (e.g. AU0.SHF), product, exchange, tregordervol, source

Migration: scripts/db/026_create_raw_futures_warehouse_receipts_daily.sql

## Fetch
scripts/ma/fetch_futures_warehouse_receipts_daily.py

`ash
# server
export PYTHONPATH=/root/new_market_project/EMQuantAPI_Python/EMQuantAPI_Python/python3
cd /root/new_market_project
source .env
python3 scripts/ma/fetch_futures_warehouse_receipts_daily.py --upsert          # last ~5d
python3 scripts/ma/fetch_futures_warehouse_receipts_daily.py 2025-01-02 2026-10-27 --upsert
`

Needs EMQ_USERNAME / EMQ_PASSWORD / DATABASE_URL.


## Schedule
Wired into `nightly_etl.py` as step `warehouse_receipts` (ORDERED_STEPS, FUTURES_STEPS @03:15, MACRO_STEPS).
Incremental from max(trade_date) with overlap, via EmQuant `--upsert`.
Manual: `bash scripts/ma/run_nightly_etl.sh --step warehouse_receipts`

## Live factor
**Wired** into live `report_inventory` (invKind=warehouse; fall back via REPORT_FIT). Was previously not wired into 
eport_inventory yet. Next step: calibrate CS on -Δ% 仓单 (and blends with current -ΔOI) vs GTJAQH007, then behind a REPORT_FIT flag.

## Dry-run snapshot (2026-10-27)
Naive CS L/S on -Δ% FTREGORDERVOL vs GTJAQH007:
- 3m corr_ret ~0.05, corr_lvl ~0.88
- 1y corr_ret ~0.01, corr_lvl ~0.91
Needs scale/knob search before replacing live inventory.
