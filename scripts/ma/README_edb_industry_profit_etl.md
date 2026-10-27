# Industry profit / margin ETL (利润)

## API
Choice `c.edb` (not `csd`) for EMI/EMM processing & smelting margins.

## Table
`raw_edb_industry_profit_daily`

## Script
`scripts/ma/fetch_edb_industry_profit_daily.py`

Confirmed codes loaded:
| EMI | product | name |
|---|---|---|
| EMI02082690 | ZN | 锌锭利润 |
| EMI02082698 | RB | 螺纹钢毛利 |
| EMI01961310 | AL | 电解铝毛利 |
| EMI02082720 | TA | PTA毛利 |
| EMI01775921 | PF | 聚酯切片周度生产毛利 |

## Missing (add when Choice codes confirmed)
CU / HC / I / J / JM / MA / PP / L / V / EG / AU / AG / BU / RU / M / Y / P / CF / SR …

## Note
CLOSE / OI / VOLUME already in `raw_futures_contracts_daily` / `raw_akshare_futures_daily` — not duplicated.
Live `report_profit` formula not switched yet.

## Schedule
Wired into `nightly_etl.py` as step `edb_industry_profit` (ORDERED_STEPS, FUTURES_STEPS @03:15, MACRO_STEPS).
Incremental from max(trade_date) with overlap, via EmQuant `--upsert`.
Manual: `bash scripts/ma/run_nightly_etl.sh --step edb_industry_profit`


## Added 2026-10-27
- EMI02082699 毛利:电解铜 → CU
- EMM01855422 现货:中国铜冶炼厂:粗炼费TC → CU
Live default still `carryMom` (EDB alone still weak vs GTJAQH009).

## Expand 2026-10-27
- Catalog now **13** EMI codes (ZN/RB/AL/TA/PF/CU/HC/V/SA/M).
- Live default remains **`carryMom`**: edb/edbBlend improve breadth but do not clearly beat carryMom on 3m corr_ret+score (edb alone still weak).

## Pass2 2026-10-27
- +3 codes (EB/BR/PX margins) → **16** total, **13** products.
- Live remains carryMom; edbBlend still not a clear corr_ret+score win.
