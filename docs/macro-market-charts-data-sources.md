# 宏观市场分析 (Macro Market) — Chart Data Sources & Debug Runbook

Reference for debugging "the chart is not updating" issues on the
`/ma/dashboard/macro-market` page. Documents, for every chart: the API route, the
DB table / file it reads, the script that produces that data, and the upstream
data source (akshare / Choice-EmQuant / Tushare).

Last updated: 2026-07-12.

---

## 1. Page / component layout

- Page: `app/ma/dashboard/macro-market/page.tsx`
- Section wrapper: `app/ma/dashboard/macro-market/market-prediction-section.tsx`
- Three logical groups:
  1. **PCA 聚类模型** (PCA cluster model)
  2. **经济体制相似性** (Regime similarity)
  3. **货币+信用 周期模型** (Money + credit cycle)

All chart APIs are `force-dynamic` and fetched with `cache: "no-store"`, so once the
underlying **DB / file is fresh, a page refresh (or the 刷新 button) shows new data**.
If the DB is stale, the problem is upstream in the Python ETL, not the frontend.

---

## 2. Chart → data → source map

### Group A — PCA 聚类模型

| Chart (component) | API route | Reads from | Produced by | Source |
|---|---|---|---|---|
| 当前市场状态预测 `current-market-prediction-chart` | `/ma/api/macro/current-market-prediction` | table `current_market_prediction` (trade_date, cluster, pc1, pc2, freq) | `scripts/ma/predict_market_cluster.py` | **derived** (GMM/PCA model) |
| 经济象限 `economic-quadrant-chart` | `/ma/api/macro/current-market-prediction` | same table | same | derived |
| PCA 双标图 `pca-biplot-chart` | `/ma/api/macro/pca-biplot` (+ prediction route) | file `data/pca_loadings.json` | `scripts/ma/export_pca_loadings.py` | derived (static, regen rarely) |
| 各资产收益 `asset-returns-chart` | `/ma/api/macro/asset-returns` | tables `raw_etf_daily`, `raw_nhci_daily` (+ `data/pca_loadings.json` for favored asset) | `get_etf_prices.py`, `get_nanhua_index.py` | **Choice/EmQuant** |
| 预测时序 `prediction-timeseries-chart` | `/ma/api/macro/current-market-prediction` | `current_market_prediction` | `predict_market_cluster.py` | derived |

Model inputs for `predict_market_cluster.py`:
- `raw_etf_daily` (field `ORIGINALUNIT`, 6 ETFs: 510300/510500/511010/511220/511880/518880 .SH)
  — **Choice/EmQuant** `c.csd(ticker, "ORIGINALUNIT", ...)` in `scripts/ma/get_etf_prices.py`
- `raw_nhci_daily` (NHCI.NH close)
  — **Choice/EmQuant** `c.csd("NHCI.NH", "CLOSE", ...)` in `scripts/ma/get_nanhua_index.py`
- Models: `economy/models/{scaler,pca,gmm}.joblib`
- Prediction uses **inner join + dropna** across all 6 ETFs + NHCI, so a date only
  gets a prediction when *every* input is present that day.

### Group B — 经济体制相似性 (Regime similarity)

| Chart | API route | Reads from | Produced by | Source |
|---|---|---|---|---|
| 前20相似月份 / 当前宏观特征指纹 / 历史时序 `regime-similarity-chart` | `/ma/api/macro/regime-similarity` | tables `regime_current_zscores`, `regime_similarity_top`, `regime_all_distances` | `scripts/ma/calc_regime_similarity.py` | **derived** |

`calc_regime_similarity.py` reads table `macro_indicators_monthly`, which holds 7 indicators
(populated by `scripts/ma/fetch_regime_indicators.py`):

| Indicator (column) | Meaning | Source | Function |
|---|---|---|---|
| `pmi` | 制造业PMI | akshare | `ak.macro_china_pmi()` |
| `m1` | M1同比 | akshare | `ak.macro_china_money_supply()` |
| `cpi` | CPI同比 | akshare | `ak.macro_china_cpi()` |
| `yield_10y` / `spread_10y1y` | 10Y收益率 / 10Y-1Y利差 | akshare | `ak.bond_china_yield()` |
| `nhci` | 南华工业品指数 | akshare | `ak.spot_hist_nhci_em(...)` (fallback: `raw_nhci_daily`) |
| **`afre`** | **社融存量同比** | **Choice/EmQuant** | **`c.edb("EMM00191807", ...)` via nightly `afre` step** |

`scripts/ma/fetch_afre_monthly.py` refreshes
`similar_regime/data/china_afre_stock_yoy_monthly.csv` (and the money-credit copy).
`fetch_regime_indicators.py` then loads that CSV into `macro_indicators_monthly`.

> The regime model picks `current_month` = the latest month where **all 7 indicators**
> are non-null. So if any single indicator lags (historically `afre`), the whole chart
> freezes at that lagging month.

### Group C — 货币+信用 周期模型 (Money + credit cycle)

| Chart | API route | Reads from | Produced by | Source |
|---|---|---|---|---|
| 历史走势 / 象限分布 / 状态空间 / 逻辑判定 `money-credit-chart` | `/ma/api/macro/money-credit` | table `money_credit_cycle` | `scripts/ma/calc_money_credit.py` | **derived** |

`calc_money_credit.py` reads from DB:
- `macro_indicators_monthly.afre` — social financing (same Choice `EMM00191807` series as above)
- `shibor_3m_monthly.shibor_3m_close` — SHIBOR 3M, **akshare** via `scripts/ma/fetch_shibor_3m.py`

---

## 3. Nightly ETL pipeline

Orchestrator: `scripts/ma/nightly_etl.py`. Relevant steps (run via `--step <name>`):

| Step name | Function | Output |
|---|---|---|
| `nhci` | `get_nanhua_index.py` (Choice) | `raw_nhci_daily` |
| `etf_prices` | `get_etf_prices.py` (Choice) — **gap-fills** from last PCA-ETF max → trade_date | `raw_etf_daily` |
| `predict_market_cluster` / `_weekly` / `_monthly` | `predict_market_cluster.py` | `current_market_prediction` |
| `afre` | `fetch_afre_monthly.py` (Choice EDB) | AFRE CSVs under `similar_regime/data/` + `money_credit/data/` |
| `regime_indicators` | `fetch_regime_indicators.py` (akshare + AFRE CSV) | `macro_indicators_monthly` |
| `regime_similarity` | `calc_regime_similarity.py` | `regime_*` tables |
| `shibor_3m` | `fetch_shibor_3m.py` (akshare) | `shibor_3m_monthly` |
| `money_credit` | `calc_money_credit.py` | `money_credit_cycle` |

**Python interpreter:** child scripts use `_resolve_python_exe()` — `PYTHON_EXE` env,
else project `.venv`, else system python. Cron should source `.choice_env.sh` and/or set
`PYTHON_EXE` to the venv that has `joblib` + `scikit-learn` (see `scripts/ma/requirements.txt`).

---

## 4. Incident log & fixes

### Incident #1 (2026-06-28) — Regime similarity & Money-credit frozen at 2026-02

**Symptom:** both charts stuck at current month `2026-02` while the date was 2026-06.

**Root cause:** `afre` (社融存量同比) was the only stale indicator in
`macro_indicators_monthly` (latest `2026-02`; all others `2026-05`/`2026-06`). Source is
**Choice** `c.edb("EMM00191807", ...)`. The AFRE CSV simply was never refreshed (no nightly
step), so it was frozen since ~early March.

**Fix:** wired nightly step `afre` → `fetch_afre_monthly.py`. Manual catch-up:
```bash
py -3 scripts/ma/fetch_afre_monthly.py
py -3 scripts/ma/fetch_regime_indicators.py
py -3 scripts/ma/calc_regime_similarity.py
py -3 scripts/ma/calc_money_credit.py
```

### Incident #2 (2026-06-28) — PCA cluster charts frozen at 2026-06-18

**Symptom:** 当前市场状态预测 / 经济象限 / PCA双标图 (cluster-based) stuck at `2026-06-18`.
(资产收益 chart was fine — it reads raw prices directly.)

**Root cause:** Raw inputs fresh; derived `current_market_prediction` stale — predict step
had not run.

**Fix:**
```bash
py -3 -u scripts/ma/predict_market_cluster.py --freq daily   2026-06-17 2026-06-27
py -3 -u scripts/ma/predict_market_cluster.py --freq weekly  2026-06-01 2026-06-27
py -3 -u scripts/ma/predict_market_cluster.py --freq monthly 2026-06-01 2026-06-27
```

### Incident #3 (2026-07-12) — PCA charts frozen at 2026-07-03

**Symptom:** PCA scatter / 经济象限 / biplot scores / timeseries stuck at `2026-07-03`
while today was 2026-07-12. Asset returns already showed through `2026-07-10`.

**Root cause:** Nightly cron used system `python3` **without `joblib`**. Every night since
~2026-07-05, `predict_market_cluster*` failed with
`{'error': 'joblib not installed. Run: pip install joblib'}` while `nhci` / `etf_prices`
still succeeded. Raw tables were current; derived table was not.

**Fix (code):**
1. `_resolve_python_exe()` prefers project `.venv` for child scripts
2. `scripts/ma/requirements.txt` + `setup_db.sh` installs joblib/sklearn and writes
   `PYTHON_EXE` / cron that sources `.choice_env.sh`
3. `etf_prices` gap-fills missed days (not single-day only)
4. `afre` step added for regime / money-credit

**Immediate catch-up (already run):**
```bash
py -3 -u scripts/ma/predict_market_cluster.py --freq daily   2026-07-04 2026-07-10
py -3 -u scripts/ma/predict_market_cluster.py --freq weekly  2026-07-01 2026-07-10
py -3 -u scripts/ma/predict_market_cluster.py --freq monthly 2026-07-01 2026-07-10
```

**Server follow-up (required for durable nightly):**
```bash
# on the Linux host
cd /root/new_market_project   # or PROJECT_ROOT
.venv/bin/python3 -m pip install -r scripts/ma/requirements.txt
# ensure crontab uses .venv and sources .choice_env.sh (re-run setup_db.sh or edit cron)
grep PYTHON_EXE .env .choice_env.sh
```

⚠️ sklearn version: models trained with **1.8.0**; pin close to that in the ETL venv
(`scikit-learn>=1.7,<1.9` in requirements).

---

## 5. Debug runbook ("chart not updating")

1. **Identify the chart's DB table / file** from the map in §2.
2. **Check freshness** — connect with the same env loading the scripts use
   (`DATABASE_URL` from `.env.local`/`.env`) and query the max date, e.g.:
   ```sql
   -- regime / money-credit
   SELECT col, max(month) FROM macro_indicators_monthly ...;  -- per indicator
   SELECT max(month) FROM money_credit_cycle;
   SELECT max(run_date), max(current_month) FROM regime_current_zscores;
   -- PCA
   SELECT freq, max(trade_date) FROM current_market_prediction GROUP BY freq;
   SELECT ticker, max(trade_date) FROM raw_etf_daily WHERE field='ORIGINALUNIT' GROUP BY ticker;
   SELECT max(trade_date) FROM raw_nhci_daily;
   -- ETL health
   SELECT step_name, status, finished_at, error_message
   FROM pipeline_runs
   WHERE job_name='nightly_etl' AND step_name LIKE 'predict_market_cluster%'
   ORDER BY finished_at DESC LIMIT 20;
   ```
3. **Classify the failure:**
   - **Raw table stale** → upstream fetch failed. Identify source from §2.
   - **Raw table fresh but derived table stale** → predict/compute step failed
     (check `pipeline_runs.error_message` — often missing `joblib` / wrong Python).
   - **Regime/money-credit stuck** → check **`afre`** first, then akshare indicators.
4. **Re-run the dependent derived steps** after refreshing raw data.
5. **Refresh the page** — `no-store` APIs will serve the new data immediately.

### Quick "which source failed" cheat sheet
- Charts stuck but raw `raw_etf_daily`/`raw_nhci_daily` fresh → **predict step** (derived / joblib).
- Regime/money-credit stuck at an old month → check **`afre`** first (Choice `c.edb` `EMM00191807`),
  then the akshare indicators.
- Everything stuck on the same recent date → likely the **whole nightly ETL** stopped
  (check the scheduler / `pipeline_runs` / `/var/log/market_etl.log`).
