"""
货币+信用 四象限周期模型
数据来源：
  - data/china_afre_stock_yoy_monthly.csv   社融存量同比
  - data/shibor_3m_monthly.csv              SHIBOR 3M
"""

import os
import pandas as pd
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# ── 第一步：加载 & 预处理 ──────────────────────────────────────────────────────

# 社融同比
df_social = pd.read_csv(os.path.join(DATA_DIR, "china_afre_stock_yoy_monthly.csv"))
df_social["date"] = pd.to_datetime(df_social["date"])
df_social["date"] = df_social["date"] + pd.offsets.MonthEnd(0)   # 统一为月末
df_social = df_social.set_index("date").sort_index()
df_social = df_social[["value"]].rename(columns={"value": "social"})

# SHIBOR 3M（2006-10-31 起有效）
df_shibor = pd.read_csv(os.path.join(DATA_DIR, "shibor_3m_monthly.csv"))
df_shibor["date"] = pd.to_datetime(df_shibor["date"])
df_shibor = df_shibor.set_index("date").sort_index()
df_shibor = df_shibor.loc["2006-10-31":].copy()
# 重采样为月末，取每月最后一个有效值
df_shibor = df_shibor.resample("ME").last()
# 前向填充（1 月 → 2 月），后向填充（开头缺口）
df_shibor["shibor_3m_close"] = (
    df_shibor["shibor_3m_close"]
    .ffill()
    .bfill()
)

# 按月末日期内连接
df = df_social.join(df_shibor[["shibor_3m_close"]], how="inner")
df.columns = ["social", "shibor"]
df.sort_index(inplace=True)

print("=" * 60)
print("数据概览")
print(f"  时间范围：{df.index[0].date()} → {df.index[-1].date()}")
print(f"  行数：{len(df)}")
print(df.head(3).to_string())
print("  ...")
print(df.tail(3).to_string())

# ── 第二步：3 月移动平均 & 斜率 ───────────────────────────────────────────────

df["social_ma"] = df["social"].rolling(3).mean()
df["shibor_ma"] = df["shibor"].rolling(3).mean()
df["social_slope"] = df["social_ma"].diff()
df["shibor_slope"] = df["shibor_ma"].diff()

# ── 第三步：滚动分位数（36 个月）& 状态分类 ───────────────────────────────────

SHIBOR_THRESH = 0.08   # SHIBOR 单位已是百分点（如 1.542），月斜率阈值
SOCIAL_THRESH = 0.2    # 社融同比月斜率阈值（百分点）

df["shibor_lower"] = df["shibor_ma"].rolling(36).quantile(0.25)
df["shibor_upper"] = df["shibor_ma"].rolling(36).quantile(0.75)
df["social_lower"] = df["social_ma"].rolling(36).quantile(0.25)
df["social_upper"] = df["social_ma"].rolling(36).quantile(0.75)


def monetary_state(row):
    s, m, lo, hi = row["shibor_slope"], row["shibor_ma"], row["shibor_lower"], row["shibor_upper"]
    if pd.isna(s) or pd.isna(m) or pd.isna(lo) or pd.isna(hi):
        return np.nan
    if s > SHIBOR_THRESH:
        return "加速收紧"
    elif s < -SHIBOR_THRESH:
        return "加速放松"
    else:
        if m >= hi:
            return "高位平稳"
        elif m <= lo:
            return "低位平稳"
        else:
            return "中性平稳"


def credit_state(row):
    s, m, lo, hi = row["social_slope"], row["social_ma"], row["social_lower"], row["social_upper"]
    if pd.isna(s) or pd.isna(m) or pd.isna(lo) or pd.isna(hi):
        return np.nan
    if s > SOCIAL_THRESH:
        return "加速扩张"
    elif s < -SOCIAL_THRESH:
        return "加速收缩"
    else:
        if m >= hi:
            return "高位平稳"
        elif m <= lo:
            return "低位平稳"
        else:
            return "中性平稳"


df["monetary_state"] = df.apply(monetary_state, axis=1)
df["credit_state"] = df.apply(credit_state, axis=1)

# ── 第四步：二分类 & 四象限 ───────────────────────────────────────────────────

MONETARY_MAP = {
    "加速放松": "宽货币",
    "低位平稳": "宽货币",
    "加速收紧": "紧货币",
    "高位平稳": "紧货币",
    "中性平稳": "中性货币",
}
# 信用：增速高/加速上升 → 宽信用；增速低/加速下降 → 紧信用
CREDIT_MAP = {
    "加速扩张": "宽信用",
    "高位平稳": "宽信用",
    "加速收缩": "紧信用",
    "低位平稳": "紧信用",
    "中性平稳": "中性信用",
}

df["monetary"] = df["monetary_state"].map(MONETARY_MAP)
df["credit"] = df["credit_state"].map(CREDIT_MAP)


def quadrant(row):
    m, c = row["monetary"], row["credit"]
    if m == "宽货币" and c == "紧信用":
        return "衰退/防御"
    elif m == "宽货币" and c == "宽信用":
        return "复苏/进攻"
    elif m == "紧货币" and c == "宽信用":
        return "过热/商品"
    elif m == "紧货币" and c == "紧信用":
        return "滞胀/现金"
    else:
        return "中性"


df["quadrant"] = df.apply(quadrant, axis=1)

# ── 第五步：输出结果 ──────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("各象限历史月份分布")
print(df["quadrant"].value_counts().to_string())

print("\n" + "=" * 60)
print("最近 12 个月状态")
cols = ["social", "shibor", "social_ma", "shibor_ma",
        "social_slope", "shibor_slope",
        "monetary_state", "credit_state",
        "monetary", "credit", "quadrant"]
pd.set_option("display.max_columns", None)
pd.set_option("display.width", 200)
print(df[cols].tail(12).to_string())

print("\n" + "=" * 60)
latest = df.dropna(subset=["quadrant"]).iloc[-1]
print(f"当前最新月份：{latest.name.strftime('%Y-%m')}")
print(f"  货币状态：{latest['monetary_state']}  →  {latest['monetary']}")
print(f"  信用状态：{latest['credit_state']}  →  {latest['credit']}")
print(f"  四象限位置：【{latest['quadrant']}】")

# ── 第六步：保存完整结果至 CSV ────────────────────────────────────────────────

out_path = os.path.join(DATA_DIR, "money_credit_cycle.csv")
df.to_csv(out_path, encoding="utf-8-sig")
print(f"\n完整结果已保存至：{out_path}")
