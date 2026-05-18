"""
plot_mvc_over30.py
==================
Chart: which products and on which dates their Marginal Vol Contribution (MVC)
       as a share of portfolio VaR exceeded 30%.

Formula (mirrors var-sandbox / risk-report page):
  dv_i(t)      = sigma_i(t)  *  mv_i(t)          # dollar vol (signed)
  portVar(t)   = Σ_i Σ_j dv_i * dv_j * corr_ij   # uses fixed 252-day corr
  mvc_raw_i(t) = |dv_i(t) * Σ_j dv_j(t) * corr_ij|
  mvc_pct_i(t) = mvc_raw_i(t) / Σ_k mvc_raw_k(t) * 100

Parameters:
  VOL_DAYS  = 20    rolling vol window
  CORR_DAYS = 252   fixed correlation window (most recent)
  THRESHOLD = 30    percent
"""

import os
import sys
import math
import numpy as np
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import psycopg2

# ── Config ──────────────────────────────────────────────────────────────────
DB_URL     = "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
VOL_DAYS   = 20
CORR_DAYS  = 252
THRESHOLD  = 30       # percent
MAD_MIN    = 0.06
MAD_K      = 12
MAD_LB     = 40       # lookback for MAD rollover filter

AKSHARE_CODE = {
    "A":"A0.DCE","AD":"AD0.SHF","AG":"AG0.SHF","AL":"AL0.SHF","AO":"AO0.SHF","AP":"AP0.CZC",
    "AU":"AU0.SHF","B":"B0.DCE","BB":"BB0.DCE","BC":"BCM.INE","BR":"BR0.SHF","BU":"BU0.SHF",
    "BZ":"BZ0.DCE","C":"C0.DCE","CF":"CF0.CZC","CJ":"CJ0.CZC","CS":"CS0.DCE","CU":"CU0.SHF",
    "CY":"CY0.CZC","EB":"EB0.DCE","EC":"ECM.INE","EG":"EG0.DCE","FB":"FB0.DCE","FG":"FG0.CZC",
    "FU":"FU0.SHF","HC":"HC0.SHF","I":"I0.DCE","IC":"IC0.CFE","IF":"IF0.CFE","IH":"IH0.CFE",
    "IM":"IM0.CFE","J":"J0.DCE","JD":"JD0.DCE","JM":"JM0.DCE","JR":"JR0.CZC","L":"L0.DCE",
    "LC":"LCM.GFE","LG":"LG0.DCE","LH":"LH0.DCE","LR":"LR0.CZC","LU":"LUM.INE","M":"M0.DCE",
    "MA":"MA0.CZC","NI":"NI0.SHF","NR":"NRM.INE","OI":"OI0.CZC","OP":"OP0.SHF","P":"P0.DCE",
    "PB":"PB0.SHF","PD":"PDM.GFE","PF":"PF0.CZC","PG":"PG0.DCE","PK":"PK0.CZC","PL":"PL0.CZC",
    "PM":"PM0.CZC","PP":"PP0.DCE","PR":"PR0.CZC","PS":"PSM.GFE","PT":"PTM.GFE","PX":"PX0.CZC",
    "RB":"RB0.SHF","RI":"RI0.CZC","RM":"RM0.CZC","RR":"RR0.DCE","RS":"RS0.CZC","RU":"RU0.SHF",
    "SA":"SA0.CZC","SC":"SCM.INE","SF":"SF0.CZC","SH":"SH0.CZC","SI":"SIM.GFE","SM":"SM0.CZC",
    "SN":"SN0.SHF","SP":"SP0.SHF","SR":"SR0.CZC","SS":"SS0.SHF","TA":"TA0.CZC","T":"T0.CFE",
    "TF":"TF0.CFE","TL":"TL0.CFE","TS":"TS0.CFE","UR":"UR0.CZC","V":"V0.DCE","WH":"WH0.CZC",
    "WR":"WR0.SHF","Y":"Y0.DCE","ZC":"ZC0.CZC","ZN":"ZN0.SHF",
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def rolling_std(arr: np.ndarray, window: int) -> np.ndarray:
    """Unbiased rolling std, NaN where insufficient data."""
    result = np.full(len(arr), np.nan)
    for i in range(window - 1, len(arr)):
        win = arr[i - window + 1: i + 1]
        nonzero = win[win != 0]
        if len(nonzero) >= 2:
            result[i] = np.std(nonzero, ddof=1)
    return result


def zero_rollover_spikes(rets: np.ndarray) -> np.ndarray:
    """Zero out contract-rollover spikes using rolling MAD heuristic."""
    out = rets.copy()
    for i in range(MAD_LB, len(rets)):
        win = np.abs(rets[i - MAD_LB: i])
        win_s = np.sort(win)
        med = win_s[len(win_s) // 2]
        devs = np.sort(np.abs(win_s - med))
        mad = devs[len(devs) // 2]
        thr = max(MAD_MIN, med + MAD_K * mad * 1.4826)
        if abs(rets[i]) > thr:
            out[i] = 0.0
    return out


def get_prefix(contract: str) -> str:
    import re
    m = re.match(r'^[A-Za-z]+', contract.strip())
    return m.group(0).upper() if m else contract.upper()


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("Connecting to database...")
    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor()

    # 1. Daily signed MV per product prefix
    print("Fetching daily MV data...")
    cur.execute("""
        SELECT "交易日期"::text AS date,
               UPPER(TRIM("合约")) AS contract,
               SUM(
                 CASE WHEN COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("买持仓"::text,''),',',''),' ',''),'')::numeric,0) > 0
                      THEN  COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("持仓市値"::text,''),',',''),' ',''),'')::numeric,0)
                      ELSE -COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("持仓市値"::text,''),',',''),' ',''),'')::numeric,0)
                 END
               ) AS mv
        FROM mom_position_details
        WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
          AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
          AND TRIM("合约") NOT LIKE '%-%-%'
        GROUP BY "交易日期", UPPER(TRIM("合约"))
        ORDER BY 1
    """)
    mv_rows = cur.fetchall()

    mv_df = pd.DataFrame(mv_rows, columns=["date", "contract", "mv"])
    mv_df["date"] = pd.to_datetime(mv_df["date"])
    mv_df["mv"]   = pd.to_numeric(mv_df["mv"], errors="coerce").fillna(0)
    mv_df["prod"] = mv_df["contract"].apply(get_prefix)

    prod_mv_df = mv_df.groupby(["date","prod"])["mv"].sum().reset_index()

    # 2. Market pct_change for all relevant codes
    all_prods   = sorted(prod_mv_df["prod"].unique())
    ak_codes    = [AKSHARE_CODE[p] for p in all_prods if p in AKSHARE_CODE]
    code_to_prod = {v: k for k, v in AKSHARE_CODE.items()}

    print(f"Found {len(all_prods)} products, fetching market returns for {len(ak_codes)} codes...")
    if not ak_codes:
        print("No AkShare codes found — exiting.")
        sys.exit(1)

    cur.execute("""
        SELECT trade_date::text AS date, code, pct_change
        FROM raw_akshare_futures_daily
        WHERE code = ANY(%s) AND pct_change IS NOT NULL
        ORDER BY trade_date
    """, (ak_codes,))
    pct_rows = cur.fetchall()
    cur.close()
    conn.close()

    pct_df = pd.DataFrame(pct_rows, columns=["date","code","pct"])
    pct_df["date"] = pd.to_datetime(pct_df["date"])
    pct_df["pct"]  = pd.to_numeric(pct_df["pct"], errors="coerce").fillna(0) / 100.0

    # 3. Pivot market returns: rows=dates, cols=ak_code
    pct_pivot = pct_df.pivot_table(index="date", columns="code", values="pct", aggfunc="last").sort_index()
    all_mkt_dates = pct_pivot.index

    # Apply rollover filter to each code
    print("Applying rollover spike filter...")
    clean_pivot = pct_pivot.copy()
    for code in clean_pivot.columns:
        clean_pivot[code] = zero_rollover_spikes(clean_pivot[code].fillna(0).values)

    # 4. Fixed correlation matrix from most recent CORR_DAYS of clean returns
    corr_slice = clean_pivot.iloc[-CORR_DAYS:]
    # Only use prods that have AkShare codes
    valid_prods = [p for p in all_prods if p in AKSHARE_CODE and AKSHARE_CODE[p] in clean_pivot.columns]
    ak_for_valid = [AKSHARE_CODE[p] for p in valid_prods]

    corr_slice_v = corr_slice[ak_for_valid].fillna(0)
    corr_matrix  = corr_slice_v.corr().values  # N×N
    print(f"Correlation matrix: {len(valid_prods)}×{len(valid_prods)}")

    # 5. Compute rolling sigma (20-day) for each valid prod
    print(f"Computing rolling {VOL_DAYS}-day sigma...")
    sigma_dict = {}
    for prod in valid_prods:
        code = AKSHARE_CODE[prod]
        rets = clean_pivot[code].fillna(0).values
        sigma_dict[prod] = rolling_std(rets, VOL_DAYS)
    sigma_df = pd.DataFrame(sigma_dict, index=all_mkt_dates)

    # 6. For each trading date, compute per-product MVC %
    print("Computing daily MVC percentages...")
    trading_dates = sorted(prod_mv_df["date"].unique())

    # Pre-index mkt dates for fast lookup
    mkt_date_idx = {d: i for i, d in enumerate(all_mkt_dates)}

    records = []  # (date, prod, mvc_pct)
    N = len(valid_prods)

    for dt in trading_dates:
        mi = mkt_date_idx.get(dt)
        if mi is None or mi < VOL_DAYS:
            continue

        # MV for each valid prod on this date
        day_mv_series = prod_mv_df[prod_mv_df["date"] == dt].set_index("prod")["mv"]

        dv = np.zeros(N)
        for idx, prod in enumerate(valid_prods):
            mv_val = day_mv_series.get(prod, 0.0)
            if abs(mv_val) < 1000:
                continue
            sig = sigma_dict[prod][mi]
            if np.isnan(sig):
                continue
            dv[idx] = sig * mv_val

        if np.all(dv == 0):
            continue

        # mvc_raw_i = |dv_i * sum_j(dv_j * corr_ij)|
        cov_vec   = corr_matrix @ dv           # sum_j(dv_j * corr_ij) for each i
        mvc_raw   = np.abs(dv * cov_vec)
        total_mvc = mvc_raw.sum()
        if total_mvc < 1e-10:
            continue

        mvc_pct = mvc_raw / total_mvc * 100.0
        for idx, prod in enumerate(valid_prods):
            if mvc_pct[idx] >= THRESHOLD:
                records.append({"date": dt, "prod": prod, "mvc_pct": round(mvc_pct[idx], 2)})

    if not records:
        print(f"No product exceeded {THRESHOLD}% MVC in the history. Nothing to plot.")
        sys.exit(0)

    events_df = pd.DataFrame(records)
    events_df["date"] = pd.to_datetime(events_df["date"])
    print(f"\nFound {len(events_df)} product-day events above {THRESHOLD}%:")
    print(events_df.groupby("prod")["date"].count().sort_values(ascending=False).to_string())

    # 7. ── Plot ────────────────────────────────────────────────────────────
    prods_in_chart = sorted(events_df["prod"].unique())
    y_pos = {p: i for i, p in enumerate(prods_in_chart)}

    fig, (ax_main, ax_bar) = plt.subplots(
        2, 1,
        figsize=(16, 6 + len(prods_in_chart) * 0.45),
        gridspec_kw={"height_ratios": [3, 1]},
    )
    fig.patch.set_facecolor("#0f172a")
    for ax in (ax_main, ax_bar):
        ax.set_facecolor("#1e293b")
        for spine in ax.spines.values():
            spine.set_edgecolor("#334155")

    # Colormap per product
    cmap   = plt.cm.get_cmap("tab20", len(prods_in_chart))
    colors = {p: cmap(i) for i, p in enumerate(prods_in_chart)}

    # ── Scatter: x=date, y=product label, size∝mvc_pct, color per product ──
    for _, row in events_df.iterrows():
        ax_main.scatter(
            row["date"],
            y_pos[row["prod"]],
            s   = max(30, (row["mvc_pct"] - THRESHOLD) * 12 + 40),
            c   = [colors[row["prod"]]],
            alpha = 0.85,
            zorder = 3,
        )
        if row["mvc_pct"] >= 50:
            ax_main.annotate(
                f'{row["mvc_pct"]:.0f}%',
                xy=(row["date"], y_pos[row["prod"]]),
                xytext=(4, 3), textcoords="offset points",
                fontsize=6.5, color="white", alpha=0.9,
            )

    ax_main.set_yticks(list(y_pos.values()))
    ax_main.set_yticklabels(list(y_pos.keys()), fontsize=9, color="#cbd5e1")
    ax_main.tick_params(axis="x", colors="#94a3b8", labelsize=8)
    ax_main.xaxis.set_major_locator(mdates.MonthLocator(interval=1))
    ax_main.xaxis.set_major_formatter(mdates.DateFormatter("%y-%m"))
    ax_main.grid(axis="x", color="#334155", linestyle="--", linewidth=0.5, alpha=0.7)
    ax_main.axhline(-0.5, color="#334155", linewidth=0.4)
    ax_main.set_xlim(events_df["date"].min() - pd.Timedelta(days=10),
                     events_df["date"].max() + pd.Timedelta(days=10))
    ax_main.set_ylim(-0.7, len(prods_in_chart) - 0.3)
    ax_main.set_title(
        f"品种 MVC % > {THRESHOLD}% 历史记录  (volDays={VOL_DAYS}, corrDays={CORR_DAYS})",
        color="white", fontsize=12, pad=10,
        fontproperties=matplotlib.font_manager.FontProperties(fname=_find_cjk_font()),
    )
    ax_main.set_ylabel("品种", color="#94a3b8", fontsize=9,
        fontproperties=matplotlib.font_manager.FontProperties(fname=_find_cjk_font()))

    # ── Bar: how many days each product exceeded threshold ──
    counts = events_df.groupby("prod")["date"].count().reindex(prods_in_chart, fill_value=0)
    bar_colors = [colors[p] for p in prods_in_chart]
    bars = ax_bar.barh(prods_in_chart, counts.values, color=bar_colors, alpha=0.85, height=0.6)
    for bar, cnt in zip(bars, counts.values):
        ax_bar.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                    str(cnt), va="center", fontsize=8, color="white")
    ax_bar.set_facecolor("#1e293b")
    ax_bar.tick_params(axis="both", colors="#94a3b8", labelsize=8)
    ax_bar.set_xlabel("超 30% 的天数", color="#94a3b8", fontsize=9,
        fontproperties=matplotlib.font_manager.FontProperties(fname=_find_cjk_font()))
    ax_bar.set_xlim(0, counts.max() * 1.15 + 1)
    ax_bar.grid(axis="x", color="#334155", linestyle="--", linewidth=0.5, alpha=0.6)
    for spine in ax_bar.spines.values():
        spine.set_edgecolor("#334155")
    # CJK labels on bar chart
    ax_bar.set_yticks(range(len(prods_in_chart)))
    ax_bar.set_yticklabels(
        prods_in_chart, fontsize=8, color="#cbd5e1",
    )

    # Peak mvc annotation in main chart title area
    peak_row = events_df.loc[events_df["mvc_pct"].idxmax()]
    fig.text(0.99, 0.99,
             f"最高: {peak_row['prod']}  {peak_row['mvc_pct']:.1f}%  @{peak_row['date'].strftime('%Y-%m-%d')}",
             ha="right", va="top", fontsize=8.5, color="#f97316",
             fontproperties=matplotlib.font_manager.FontProperties(fname=_find_cjk_font()))

    plt.tight_layout(rect=[0, 0, 1, 0.98])

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "mvc_over30_history.png")
    out_path = os.path.normpath(out_path)
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    print(f"\nChart saved → {out_path}")
    plt.close()

    # Also save CSV for reference
    csv_path = out_path.replace(".png", ".csv")
    events_df.to_csv(csv_path, index=False)
    print(f"CSV saved  → {csv_path}")


def _find_cjk_font() -> str:
    """Try to locate a font that can render CJK characters."""
    import matplotlib.font_manager as fm
    candidates = [
        "Microsoft YaHei", "SimHei", "SimSun", "NSimSun",
        "WenQuanYi Micro Hei", "Noto Sans CJK SC", "Source Han Sans CN",
    ]
    for name in candidates:
        try:
            path = fm.findfont(fm.FontProperties(family=name), fallback_to_default=False)
            if path and "DejaVu" not in path:
                return path
        except Exception:
            pass
    # Search font files on disk (Windows)
    search_dirs = [
        r"C:\Windows\Fonts",
        r"/usr/share/fonts",
        os.path.expanduser("~/.fonts"),
    ]
    for d in search_dirs:
        for root, _, files in os.walk(d):
            for f in files:
                fl = f.lower()
                if any(k in fl for k in ("simhei","yahei","simsun","wqy","notosans")):
                    return os.path.join(root, f)
    # fallback — matplotlib default (may not render CJK)
    return fm.findfont(fm.FontProperties())


if __name__ == "__main__":
    main()
