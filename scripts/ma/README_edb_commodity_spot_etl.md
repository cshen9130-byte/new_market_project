# EDB commodity spot ETL (国君「基差」)

## Purpose
Physical commodity **spot** prices via Choice `c.edb` for Futures Style factor **基差** (`report_basis_spot`), calibrated offline to **GTJAQH012.WI**.

Near–far term structure stays on `report_basis` UI **期限基差** (calib **GTJAQH004.WI**).

## Table
`raw_edb_commodity_spot_daily` — migration `scripts/db/029_create_raw_edb_commodity_spot_daily.sql`

## Catalog
`data/edb_commodity_spot_catalog.json` (product → EMI → name/source/unit). Expand via 妙想 `mx_macro_data`.

## Fetch
```bash
# on EmQuant host (server historically ~/new_market_project):
export PYTHONPATH=/root/new_market_project/EMQuantAPI_Python/EMQuantAPI_Python/python3
python3 scripts/ma/fetch_edb_commodity_spot_daily.py 2024-01-02 2026-10-28 --upsert
```

Nightly step: `edb_commodity_spot` in `nightly_etl.py`.

## Live factor
Loaded as `commoditySpot` on day panels. REPORT_FIT knobs: `basisSpot*`.
Wind GTJAQH012 = calib only (`USE_WIND_GTJAQH=false`).
