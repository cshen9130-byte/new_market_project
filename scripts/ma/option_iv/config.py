"""Configuration for China option IV analysis."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class UnderlyingConfig:
    key: str
    label: str
    folder_name: str
    qvix_func: str
    em_keywords: tuple[str, ...]
    spot_symbol: str | None = None
    primary_underlying: str | None = None


UNDERLYINGS: dict[str, UnderlyingConfig] = {
    "50etf": UnderlyingConfig(
        key="50etf",
        label="SSE 50 ETF (510050)",
        folder_name="上证50ETF期权",
        qvix_func="index_option_50etf_qvix",
        em_keywords=("上证50ETF", "50ETF"),
        spot_symbol="sh510050",
    ),
    "300etf": UnderlyingConfig(
        key="300etf",
        label="CSI 300 ETF (510300)",
        folder_name="沪深300ETF期权_510300",
        qvix_func="index_option_300etf_qvix",
        em_keywords=("沪深300ETF", "300ETF"),
        spot_symbol="sh510300",
    ),
    "500etf": UnderlyingConfig(
        key="500etf",
        label="CSI 500 ETF (510500)",
        folder_name="中证500ETF期权_510500",
        qvix_func="index_option_500etf_qvix",
        em_keywords=("中证500ETF", "500ETF"),
        spot_symbol="sh510500",
    ),
    "cyb": UnderlyingConfig(
        key="cyb",
        label="ChiNext ETF (159915)",
        folder_name="创业板ETF期权",
        qvix_func="index_option_cyb_qvix",
        em_keywords=("创业板ETF",),
        spot_symbol="sz159915",
    ),
    "kcb": UnderlyingConfig(
        key="kcb",
        label="STAR 50 ETF (588000)",
        folder_name="科创50ETF期权_588000华夏",
        qvix_func="index_option_kcb_qvix",
        em_keywords=("科创50ETF华夏",),
        spot_symbol="sh588000",
        primary_underlying="科创50ETF华夏",
    ),
    "300index": UnderlyingConfig(
        key="300index",
        label="CSI 300 Index (IO)",
        folder_name="沪深300股指期权IO",
        qvix_func="index_option_300index_qvix",
        em_keywords=("沪深300指数", "300指数"),
    ),
    "50index": UnderlyingConfig(
        key="50index",
        label="SSE 50 Index (HO)",
        folder_name="上证50股指期权HO",
        qvix_func="index_option_50index_qvix",
        em_keywords=("上证50指数", "50指数"),
    ),
    "1000index": UnderlyingConfig(
        key="1000index",
        label="CSI 1000 Index (MO)",
        folder_name="中证1000股指期权MO",
        qvix_func="index_option_1000index_qvix",
        em_keywords=("中证1000指数", "1000指数"),
    ),
    "100etf": UnderlyingConfig(
        key="100etf",
        label="SZSE 100 ETF (159901)",
        folder_name="深证100ETF期权",
        qvix_func="index_option_100etf_qvix",
        em_keywords=("深证100ETF", "100ETF"),
        spot_symbol="sz159901",
    ),
    "300etf_sz": UnderlyingConfig(
        key="300etf_sz",
        label="CSI 300 ETF SZSE (159919)",
        folder_name="沪深300ETF期权_159919嘉实",
        qvix_func="index_option_300etf_qvix",
        em_keywords=("嘉实沪深300ETF", "159919"),
        spot_symbol="sz159919",
        primary_underlying="嘉实",
    ),
    "500etf_sz": UnderlyingConfig(
        key="500etf_sz",
        label="CSI 500 ETF SZSE (159922)",
        folder_name="中证500ETF期权_159922嘉实",
        qvix_func="index_option_500etf_qvix",
        em_keywords=("嘉实中证500ETF", "159922"),
        spot_symbol="sz159922",
        primary_underlying="嘉实",
    ),
    "kcb_efund": UnderlyingConfig(
        key="kcb_efund",
        label="STAR 50 ETF E Fund (588080)",
        folder_name="科创50ETF期权_588080易方达",
        qvix_func="index_option_kcb_qvix",
        em_keywords=("科创50ETF易方达", "易方达"),
        spot_symbol="sh588080",
        primary_underlying="易方达",
    ),
}

FINANCIAL_UNDERLYINGS = tuple(UNDERLYINGS.keys())
DEFAULT_UNDERLYINGS = FINANCIAL_UNDERLYINGS
OUTPUT_DIR = "output"
