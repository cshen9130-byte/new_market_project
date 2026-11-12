"""Classify 泛国家队观察池 ETFs from official names.

Keep in sync with lib/ma/national-team-universe.ts
"""

from __future__ import annotations

# Plain beta 宽基 that national-team flows typically go through.
POS_KEYWORDS = (
    "沪深300ETF",
    "上证50ETF",
    "中证500ETF",
    "中证1000ETF",
    "科创50ETF",
    "中证A500ETF",
    "A500ETF",
    "中证A50ETF",
    "A50ETF",
    "中国A50ETF",
)

# Smart-beta / overseas / non-core products to exclude even if the name
# contains a 宽基 token (e.g. 沪深300红利ETF, 沪港深300ETF, 创业板300ETF).
NEG_KEYWORDS = (
    "增强",
    "成长",
    "价值",
    "红利",
    "ESG",
    "现金流",
    "低波",
    "低波动",
    "等权",
    "沪港深",
    "创业板",
    "民企",
    "港股",
    "AH",
    "债",
    "富时",
    "联接",
    "连接",
    "QDII",
    "货币",
    "黄金",
    "商品",
    "原油",
    "期货",
    "REIT",
    "REITs",
    "恒生",
    "纳斯达克",
    "标普",
    "日经",
    "国债",
    "可转债",
)


def is_national_team_etf(*names: str | None) -> bool:
    text = "".join(n for n in names if n)
    if not text:
        return False
    if any(k.lower() in text.lower() for k in NEG_KEYWORDS):
        return False
    return any(k in text for k in POS_KEYWORDS)


def to_ts_code(code: str) -> str:
    c = str(code).strip().zfill(6)
    if c.endswith(".SH") or c.endswith(".SZ"):
        return c
    if c.startswith(("5", "6")):
        return f"{c}.SH"
    return f"{c}.SZ"

