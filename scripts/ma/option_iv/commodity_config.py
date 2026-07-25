"""Configuration for China commodity option IV analysis.

Covers all AkShare-supported listed commodity options across SHFE/INE, DCE, CZCE, GFEX.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CommodityUnderlying:
    key: str
    label: str
    short_label: str
    sector: str
    exchange: str  # shfe | gfex | dce | czce
    ak_symbol: str
    rank: int
    futures_code: str  # continuous main, e.g. CU0.SHF


# Display order for sector bands in the dashboard
SECTOR_ORDER: tuple[str, ...] = ("农产品", "黑色", "有色", "能化")


def _u(
    key: str,
    short: str,
    sector: str,
    exchange: str,
    ak_symbol: str,
    rank: int,
    futures_code: str,
    label: str | None = None,
) -> CommodityUnderlying:
    return CommodityUnderlying(
        key=key,
        label=label or f"{short}期权",
        short_label=short,
        sector=sector,
        exchange=exchange,
        ak_symbol=ak_symbol,
        rank=rank,
        futures_code=futures_code,
    )


UNDERLYINGS: dict[str, CommodityUnderlying] = {
    # ── 农产品 ──────────────────────────────────────────────
    "a": _u("a", "豆一", "农产品", "dce", "黄大豆1号期权", 10, "A0.DCE"),
    "b": _u("b", "豆二", "农产品", "dce", "黄大豆2号期权", 20, "B0.DCE"),
    "m": _u("m", "豆粕", "农产品", "dce", "豆粕期权", 30, "M0.DCE"),
    "y": _u("y", "豆油", "农产品", "dce", "豆油期权", 40, "Y0.DCE"),
    "p": _u("p", "棕榈油", "农产品", "dce", "棕榈油期权", 50, "P0.DCE"),
    "c": _u("c", "玉米", "农产品", "dce", "玉米期权", 60, "C0.DCE"),
    "cs": _u("cs", "玉米淀粉", "农产品", "dce", "玉米淀粉期权", 70, "CS0.DCE"),
    "jd": _u("jd", "鸡蛋", "农产品", "dce", "鸡蛋期权", 80, "JD0.DCE"),
    "lh": _u("lh", "生猪", "农产品", "dce", "生猪期权", 90, "LH0.DCE"),
    "lg": _u("lg", "原木", "农产品", "dce", "原木期权", 100, "LG0.DCE"),
    "sr": _u("sr", "白糖", "农产品", "czce", "白糖期权", 110, "SR0.CZC"),
    "cf": _u("cf", "棉花", "农产品", "czce", "棉花期权", 120, "CF0.CZC"),
    "oi": _u("oi", "菜油", "农产品", "czce", "菜籽油期权", 130, "OI0.CZC"),
    "rm": _u("rm", "菜粕", "农产品", "czce", "菜籽粕期权", 140, "RM0.CZC"),
    "pk": _u("pk", "花生", "农产品", "czce", "花生期权", 150, "PK0.CZC"),
    "ap": _u("ap", "苹果", "农产品", "czce", "苹果期权", 160, "AP0.CZC"),
    "cj": _u("cj", "红枣", "农产品", "czce", "红枣期权", 170, "CJ0.CZC"),
    # ── 黑色 ────────────────────────────────────────────────
    "i": _u("i", "铁矿石", "黑色", "dce", "铁矿石期权", 200, "I0.DCE"),
    "rb": _u("rb", "螺纹钢", "黑色", "shfe", "螺纹钢期权", 210, "RB0.SHF"),
    "sf": _u("sf", "硅铁", "黑色", "czce", "硅铁期权", 220, "SF0.CZC"),
    "sm": _u("sm", "锰硅", "黑色", "czce", "锰硅期权", 230, "SM0.CZC"),
    "zc": _u("zc", "动力煤", "黑色", "czce", "动力煤期权", 240, "ZC0.CZC"),
    # ── 有色 / 贵金属 ───────────────────────────────────────
    "cu": _u("cu", "铜", "有色", "shfe", "铜期权", 300, "CU0.SHF"),
    "al": _u("al", "铝", "有色", "shfe", "铝期权", 310, "AL0.SHF"),
    "zn": _u("zn", "锌", "有色", "shfe", "锌期权", 320, "ZN0.SHF"),
    "pb": _u("pb", "铅", "有色", "shfe", "铅期权", 330, "PB0.SHF"),
    "ni": _u("ni", "镍", "有色", "shfe", "镍期权", 340, "NI0.SHF"),
    "sn": _u("sn", "锡", "有色", "shfe", "锡期权", 350, "SN0.SHF"),
    "ao": _u("ao", "氧化铝", "有色", "shfe", "氧化铝期权", 360, "AO0.SHF"),
    "au": _u("au", "黄金", "有色", "shfe", "黄金期权", 370, "AU0.SHF"),
    "ag": _u("ag", "白银", "有色", "shfe", "白银期权", 380, "AG0.SHF"),
    # ── 能化 ────────────────────────────────────────────────
    "sc": _u("sc", "原油", "能化", "shfe", "原油期权", 400, "SCM.INE"),
    "ru": _u("ru", "天胶", "能化", "shfe", "天胶期权", 410, "RU0.SHF"),
    "br": _u("br", "丁二烯橡胶", "能化", "shfe", "丁二烯橡胶期权", 420, "BR0.SHF"),
    "nr": _u("nr", "20号胶", "能化", "shfe", "20号胶期权", 430, "NRM.INE"),
    "fu": _u("fu", "燃料油", "能化", "shfe", "燃料油期权", 435, "FU0.SHF"),
    "l": _u("l", "聚乙烯", "能化", "dce", "聚乙烯期权", 440, "L0.DCE"),
    "v": _u("v", "聚氯乙烯", "能化", "dce", "聚氯乙烯期权", 450, "V0.DCE"),
    "pp": _u("pp", "聚丙烯", "能化", "dce", "聚丙烯期权", 460, "PP0.DCE"),
    "eg": _u("eg", "乙二醇", "能化", "dce", "乙二醇期权", 470, "EG0.DCE"),
    "eb": _u("eb", "苯乙烯", "能化", "dce", "苯乙烯期权", 480, "EB0.DCE"),
    "pg": _u("pg", "LPG", "能化", "dce", "液化石油气期权", 490, "PG0.DCE", label="液化石油气期权"),
    "ta": _u("ta", "PTA", "能化", "czce", "PTA期权", 500, "TA0.CZC"),
    "ma": _u("ma", "甲醇", "能化", "czce", "甲醇期权", 510, "MA0.CZC"),
    "fg": _u("fg", "玻璃", "能化", "czce", "玻璃期权", 520, "FG0.CZC"),
    "sa": _u("sa", "纯碱", "能化", "czce", "纯碱期权", 530, "SA0.CZC"),
    "sh": _u("sh", "烧碱", "能化", "czce", "烧碱期权", 540, "SH0.CZC"),
    "ur": _u("ur", "尿素", "能化", "czce", "尿素期权", 550, "UR0.CZC"),
    "pf": _u("pf", "短纤", "能化", "czce", "短纤期权", 560, "PF0.CZC"),
    "px": _u("px", "对二甲苯", "能化", "czce", "对二甲苯期权", 570, "PX0.CZC"),
    "pr": _u("pr", "瓶片", "能化", "czce", "瓶片期权", 580, "PR0.CZC"),
    "si": _u("si", "工业硅", "能化", "gfex", "工业硅", 590, "SIM.GFE"),
    "lc": _u("lc", "碳酸锂", "能化", "gfex", "碳酸锂", 600, "LCM.GFE"),
    "ps": _u("ps", "多晶硅", "能化", "gfex", "多晶硅", 610, "PSM.GFE"),
}

COMMODITY_UNDERLYINGS = tuple(
    k for k, _ in sorted(UNDERLYINGS.items(), key=lambda kv: kv[1].rank)
)

SUMMARY_GROUPS: list[tuple[str, list[str]]] = [
    (cfg.label, [key])
    for key, cfg in sorted(UNDERLYINGS.items(), key=lambda kv: kv[1].rank)
]
