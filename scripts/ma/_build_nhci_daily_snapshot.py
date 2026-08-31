import csv
import json
from pathlib import Path

ROOT = Path(r"D:\coding\all_weather\output_u25_index_nhci_daily")
OUT = Path(r"D:\coding\market_website\lib\nhci-index\strategy-snapshot.json")

LABELS = {
    "AU": "黄金 AU",
    "FG": "玻璃 FG",
    "SR": "白糖 SR",
    "AL": "铝 AL",
    "CF": "棉花 CF",
    "SC": "原油 SC",
    "CU": "铜 CU",
    "LC": "碳酸锂 LC",
    "C": "玉米 C",
    "SP": "纸浆 SP",
    "UR": "尿素 UR",
    "M": "豆粕 M",
    "SN": "锡 SN",
    "P": "棕榈油 P",
    "TA": "PTA TA",
    "B": "豆二 B",
    "BU": "沥青 BU",
    "LH": "生猪 LH",
    "PX": "对二甲苯 PX",
    "BR": "丁二烯橡胶 BR",
    "MA": "甲醇 MA",
    "JD": "鸡蛋 JD",
}
SLEEVE = {"AU": "Gold"}
DROP = {"IF", "IC", "TL"}


def pct(s: str) -> float:
    s = str(s).strip().replace(",", "")
    if s in ("", "-", "nan"):
        return 0.0
    if s.endswith("%"):
        return float(s[:-1]) / 100.0
    return float(s)


def num(s: str) -> float:
    s = str(s).strip().replace(",", "").replace('"', "")
    if s in ("", "-", "nan"):
        return 0.0
    return float(s)


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def spec_of(specs_rows: list[dict], asset: str) -> dict:
    return next(s for s in specs_rows if s["variety"] == asset)


def main() -> None:
    summary = json.loads((ROOT / "summary.json").read_text(encoding="utf-8"))
    pos_rows = {r["代码"]: r for r in read_csv(ROOT / "table_latest_positions.csv")}
    pnl_rows = {r["代码"]: r for r in read_csv(ROOT / "table_product_pnl.csv")}
    specs_rows = [r for r in read_csv(ROOT / "contract_specs.csv") if r["variety"] not in DROP]
    sleeve_bt = read_csv(ROOT / "alloc_sleeve_backtest.csv")[0]
    acct_last = read_csv(ROOT / "account_daily.csv")[-1]
    weight_rows = read_csv(ROOT / "weights_at_rebalance.csv")
    last_reb = max(r["date"] for r in weight_rows)
    last_w = {r["asset"]: r for r in weight_rows if r["date"] == last_reb}

    positions = []
    last_budget = {"Equity": 0.0, "Bonds": 0.0, "Gold": 0.0, "Commodity": 0.0}
    for asset, w in last_w.items():
        if asset in DROP:
            continue
        pr = pos_rows.get(asset, {})
        sp = spec_of(specs_rows, asset)
        lots = int(float(w.get("lots") or 0))
        sleeve = SLEEVE.get(asset, "Commodity")
        price = num(pr.get("价格") or 0) or float(sp["ref_price"])
        pos = {
            "asset": asset,
            "label": LABELS.get(asset, asset),
            "sleeve": sleeve,
            "lots": lots,
            "price": price,
            "multiplier": int(float(pr.get("乘数") or sp["multiplier"])),
            "marginRate": float(sp["margin_rate"]),
            "notional": num(pr.get("名义价值(元)", 0)),
            "margin": num(pr.get("保证金占用(元)", 0)),
            "targetWeight": float(w["target_weight"]),
            "weightShare": float(w["weight_share"]),
            "assetVol": float(w["asset_vol"]),
            "riskContrib": float(w["risk_contrib"]),
            "riskShare": float(w["risk_share"]),
            "backtestPnl": num(pnl_rows.get(asset, {}).get("累计盈亏(元)", 0)),
        }
        last_budget[sleeve] += pos["riskShare"]
        positions.append(pos)
    positions.sort(key=lambda p: p["riskShare"], reverse=True)

    specs = [
        {
            "asset": s["variety"],
            "refContract": s["ref_contract"],
            "refPrice": float(s["ref_price"]),
            "multiplier": int(float(s["multiplier"])),
            "marginRate": float(s["margin_rate"]),
            "feeOpen": float(s["fee_open_yuan"] or 0),
            "feeClose": float(s["fee_close_yuan"] or 0),
        }
        for s in specs_rows
    ]

    snap = {
        "name": "南华成分品种指数跟踪策略 · 年化波动5% · 日度再平衡",
        "method": summary["method"],
        "universe": summary["universe"],
        "benchmark": "NHCI",
        "backtestStart": summary["start"],
        "backtestEnd": summary["end"],
        "lastRebalance": summary["end"],
        "initialCapital": summary["initial_capital"],
        "brokerMarginMult": 1.1,
        "maxMarginUtil": 0.7,
        "volTarget": summary["ex_ante_vol_target"],
        "volMandate": summary["vol_mandate"],
        "rebalanceFreq": "D",
        "droppedNonNhci": summary["dropped_non_nhci"],
        "nAssetsUniverse": summary["n_assets_universe"],
        "summary": {
            "cagr": summary["cagr"],
            "annVol": summary["ann_vol"],
            "sharpe": summary["sharpe"],
            "sortino": summary["sortino"],
            "maxDrawdown": summary["max_drawdown"],
            "calmar": summary["calmar"],
            "winRate": summary["win_rate"],
            "nDays": summary["n_days"],
            "nRebalances": summary["n_rebalances"],
            "cumulativeReturn": summary["cumulative_return"],
            "expostTe": summary["expost_te"],
            "expostCorr": summary["expost_corr"],
            "expostBeta": summary["expost_beta"],
            "expostR2": summary.get("expost_r2", summary["expost_corr"] ** 2),
            "signalExpostTe": summary["signal_expost_te"],
            "signalExpostCorr": summary["signal_expost_corr"],
            "signalExpostBeta": summary["signal_expost_beta"],
            "realisticCagr": summary["realistic_cagr"],
            "realisticVol": summary["realistic_vol"],
            "realisticSharpe": summary["realistic_sharpe"],
            "realisticMaxDd": summary["realistic_maxdd"],
            "realisticFinalNav": summary["realistic_final_nav"],
            "avgNOpened": summary["avg_n_opened"],
            "lastSkipped": summary["last_skipped"],
            "lastNSkipped": summary["last_n_skipped_sublot"],
        },
        "sleeveBacktest": [
            {
                "sleeve": "All",
                "label": "全部品种",
                "cagr": sleeve_bt["年化收益率"],
                "vol": sleeve_bt["年化波动"],
                "sharpe": sleeve_bt["夏普比率"],
                "maxDd": sleeve_bt["最大回撤"],
            }
        ],
        "lastBudget": last_budget,
        "lastAccount": {
            "date": acct_last["date"],
            "nav": float(acct_last["nav"]),
            "dailyPnl": float(acct_last["daily_pnl"]),
            "totalMargin": float(acct_last["total_margin"]),
            "marginUtil": float(acct_last["margin_util"]),
            "grossNotional": float(acct_last["gross_notional"]),
            "nLots": int(float(acct_last["n_lots"])),
        },
        "positions": positions,
        "specs": specs,
    }

    OUT.write_text(json.dumps(snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("assets", len(positions), "specs", len(specs))
    print("lots", sum(p["lots"] for p in positions))
    print("riskShare", round(sum(p["riskShare"] for p in positions), 6))
    print("weightShare", round(sum(p["weightShare"] for p in positions), 6))
    print("targetW", round(sum(p["targetWeight"] for p in positions), 6))
    print("budget", {k: round(v, 4) for k, v in last_budget.items()})
    print("wrote", OUT)


if __name__ == "__main__":
    main()
