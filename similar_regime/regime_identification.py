import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

# ------------------------------
# 1. Read all CSV files
# ------------------------------
pmi      = pd.read_csv(DATA_DIR / 'china_pmi_monthly.csv',                parse_dates=['date'])
afre     = pd.read_csv(DATA_DIR / 'china_afre_stock_yoy_monthly.csv',     parse_dates=['date'])
m1       = pd.read_csv(DATA_DIR / 'china_m1_yoy_monthly.csv',             parse_dates=['date'])
cpi      = pd.read_csv(DATA_DIR / 'china_cpi_yoy_monthly.csv',            parse_dates=['date'])
nhii     = pd.read_csv(DATA_DIR / 'china_nhii_daily.csv',                 parse_dates=['date'])
yield_10y = pd.read_csv(DATA_DIR / 'china_10y_bond_yield_monthly.csv',    parse_dates=['date'])
spread   = pd.read_csv(DATA_DIR / 'china_10y1y_spread_monthly.csv',       parse_dates=['date'])

# ------------------------------
# 2. Normalise dates to month-end
# ------------------------------
def to_month_end(df, col='date'):
    df[col] = pd.to_datetime(df[col]) + pd.offsets.MonthEnd(0)
    return df

pmi       = to_month_end(pmi)
afre      = to_month_end(afre)
m1        = to_month_end(m1)
cpi       = to_month_end(cpi)
yield_10y = to_month_end(yield_10y)
spread    = to_month_end(spread)

# NHII is daily — resample to month-end close
nhii['date'] = pd.to_datetime(nhii['date'])
nhii_monthly = (nhii.set_index('date')['close']
                .resample('ME').last()
                .reset_index())
nhii_monthly = to_month_end(nhii_monthly)

# ------------------------------
# 3. Rename value columns
# ------------------------------
pmi       = pmi.rename(columns={'value': 'pmi'})[['date', 'pmi']]
afre      = afre.rename(columns={'value': 'afre'})[['date', 'afre']]
m1        = m1.rename(columns={'value': 'm1'})[['date', 'm1']]
cpi       = cpi.rename(columns={'value': 'cpi'})[['date', 'cpi']]
yield_10y = yield_10y.rename(columns={'china_10y_yield': 'yield_10y'})[['date', 'yield_10y']]
spread    = spread.rename(columns={'10Y_1Y_spread': 'spread'})[['date', 'spread']]
nhii_monthly = nhii_monthly.rename(columns={'close': 'nhii'})[['date', 'nhii']]

# ------------------------------
# 4. Merge all data (outer join on month-end date)
# ------------------------------
dfs = [pmi, afre, m1, cpi, yield_10y, spread, nhii_monthly]
merged = dfs[0].set_index('date')
for df in dfs[1:]:
    merged = merged.join(df.set_index('date'), how='outer')

# Restrict to from 2006-03-31 onward (when govt-bond yield data starts)
merged = merged.loc['2006-03-31':].copy()

# ------------------------------
# 5. Variable transformations
# ------------------------------
merged['pmi_chg']    = merged['pmi']      - merged['pmi'].shift(12)
merged['yield_chg']  = merged['yield_10y'] - merged['yield_10y'].shift(12)
merged['spread_chg'] = merged['spread']   - merged['spread'].shift(12)
merged['nhii_yoy']   = (merged['nhii'] / merged['nhii'].shift(12) - 1) * 100

vars_list = ['pmi_chg', 'yield_chg', 'spread_chg', 'nhii_yoy', 'afre', 'm1', 'cpi']
merged_clean = merged[vars_list].dropna()

# ------------------------------
# 6. Rolling 10-year (120-month) z-score normalisation
# ------------------------------
def rolling_zscore(series, window=120):
    roll_mean = series.rolling(window, min_periods=window).mean()
    roll_std  = series.rolling(window, min_periods=window).std()
    return ((series - roll_mean) / roll_std).clip(-3, 3)

z_cols = []
for var in vars_list:
    col = var + '_z'
    merged_clean[col] = rolling_zscore(merged_clean[var])
    z_cols.append(col)

merged_clean = merged_clean.dropna(subset=z_cols)

# ------------------------------
# 7. Select current month
# ------------------------------
current_date = pd.Timestamp('2026-02-28')
if current_date not in merged_clean.index:
    available = merged_clean.index[merged_clean.index <= current_date]
    if len(available) == 0:
        raise ValueError("No data available before the requested current date.")
    current_date = available[-1]
print(f"Current analysis month: {current_date.strftime('%Y-%m-%d')}")

current_vec = merged_clean.loc[current_date, z_cols].values

# ------------------------------
# 8. Compute Euclidean distances vs all months > 36 months ago
# ------------------------------
EXCLUDE_MONTHS = 36
earliest_excluded = current_date - pd.DateOffset(months=EXCLUDE_MONTHS)
historical_idx = merged_clean.index[merged_clean.index < earliest_excluded]

distances = []
for dt in historical_idx:
    hist_vec = merged_clean.loc[dt, z_cols].values
    dist = float(np.sqrt(np.sum((current_vec - hist_vec) ** 2)))
    distances.append({'date': dt, 'distance': dist})

distances_df = pd.DataFrame(distances).sort_values('distance').reset_index(drop=True)
top20 = distances_df.head(20).copy()

print("\nTop 20 most similar historical months (ascending distance):")
print(top20.to_string(index=False))

# ------------------------------
# 9. Save results
# ------------------------------
# Save full distance table
distances_df['date'] = distances_df['date'].dt.strftime('%Y-%m')
out_all = DATA_DIR / 'regime_distances.csv'
distances_df.to_csv(out_all, index=False, encoding='utf-8-sig')
print(f"\nFull distance table saved to: {out_all}")

# Save top-20 with raw z-scores appended
top20_dates = top20['date'].tolist()
zscore_rows = merged_clean.loc[top20_dates, z_cols].copy()
zscore_rows.index.name = 'date'
top20_out = top20.copy()
top20_out['date_ts'] = top20_out['date']
top20_out = top20_out.set_index('date_ts')
top20_out = top20_out.join(zscore_rows)
top20_out.index.name = 'date'
top20_out['date'] = top20_out['date'].dt.strftime('%Y-%m')
out_top20 = DATA_DIR / 'regime_top20_similar.csv'
top20_out.to_csv(out_top20, index=False, encoding='utf-8-sig')
print(f"Top-20 table saved to: {out_top20}")

# ------------------------------
# 10. Print current z-scores
# ------------------------------
print(f"\nCurrent month z-scores ({current_date.strftime('%Y-%m')}):")
for var, z in zip(vars_list, current_vec):
    print(f"  {var:15s}: {z:+.4f}")
