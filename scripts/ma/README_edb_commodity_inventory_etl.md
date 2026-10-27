# EDB commodity inventory ETL

## Table
`raw_edb_commodity_inventory_daily` — Choice `c.edb` social/exchange inventory (China preferred over LME).

Migration: `scripts/db/028_create_raw_edb_commodity_inventory_daily.sql`

## Codes (from 妙想 mx_macro_data 2026-10-27)
| code | product | note | priority |
|------|---------|------|----------|
| EMI01801745 | AL | 库存:铝(日) | 10 |
| EMM01787346 | ZN | 库存:锌(日) | 10 |
| EMI02082804 | CU | 市场库存:电解铜 | 20 |
| EMI00339785 | RB | 国内钢铁社会库存:螺纹钢 | 20 |
| EMI00339789 | HC | 国内钢铁社会库存:热轧 | 20 |
| EMI00069041 / EMM01500532 / EMM00635193 | AL | weekly/SHFE | 30-45 |
| EMI00069039 / EMM00635252 | ZN | weekly | 30-45 |
| EMM01787478 / EMI01801600 | AL/ZN | LME (stored, excluded from live primary) | 80 |

## Fetch
```bash
python3 scripts/ma/fetch_edb_commodity_inventory_daily.py 2025-01-02 2026-10-27 --upsert
```
Nightly step: `edb_commodity_inventory` in `nightly_etl.py`.

## Live factor
Loaded into panels as `socialInv`. REPORT_FIT `invKind=social|socialBlend` available.
**Default remains `warehouse` (FTREGORDERVOL)** — 2026-10-27 calib: pure social (5 products) negative corr_ret; socialBlend < warehouse.
Need more China inventory EMI breadth before flipping live default.

## Expand 2026-10-27
- Catalog now **42** EMI/EMM codes across **22** products (CU/AL/ZN/PB/NI/SN/RB/HC/I/J/JM/TA/EG/MA/SA/UR/RU/FG/SP/FU/LU/P).
- Live `REPORT_FIT.invKind` flipped to **`social`** (L=5, top=0.25, scale=0.2): 3m corr_ret **0.422** vs warehouse **0.358** vs GTJAQH007.
- `warehouse` / `socialBlend` remain available flags. No PM2 redeploy during workday.

## Pass2 2026-10-27
- +16 codes → **58** total, **32** products (added BU/FU denser, L/EB/PX/BR/SC/NR/AG/AU/Y).
- social L5 vs GTJAQH007 improved further: 3m corr_ret **0.465** (was 0.422), 1y corr_lvl **0.897** (was 0.423).
- REPORT_FIT unchanged (already invKind=social).
