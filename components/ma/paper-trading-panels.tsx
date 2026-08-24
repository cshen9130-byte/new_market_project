"use client"

import { Fragment, useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import type { PaperTradingApi } from "@/hooks/use-paper-trading"
import { CONTRACT_TENORS } from "@/lib/all-weather/setup"
import { isSleeveKey, SLEEVE_COLORS, SLEEVE_KEYS, SLEEVE_LABELS, type SleeveKey } from "@/lib/all-weather/universe"
import { type CtpTick } from "@/lib/client/ctp-market"
import {
  ALL_WEATHER_PORTFOLIO_ID,
  accountKind,
  accountKindLabel,
  fmtMoney,
  fmtYuan,
  markPrice,
  priceDigits,
  positionPnl,
  sideLabel,
  strategyStatusLabel,
  type PaperAccountKind,
  type PaperEntryMode,
  type PaperSide,
} from "@/lib/client/paper-trading"
import { resolveSymbolInput } from "@/lib/client/pro-trading"
import { cn } from "@/lib/utils"

const fieldClass =
  "h-8 w-full rounded border border-[#2a2e39] bg-[#131722] px-2 text-xs text-[#d1d4dc] outline-none focus:border-[#4c84ff]"

function pnlClass(n: number | null | undefined) {
  if (n == null) return "text-[#787b86]"
  if (n > 0) return "text-[#ef5350]"
  if (n < 0) return "text-[#26a69a]"
  return "text-[#787b86]"
}

function fmtPx(n: number | null | undefined, symbol?: string) {
  if (n == null || Number.isNaN(n)) return "--"
  const d = (symbol && priceDigits(symbol)) ?? (Math.abs(n) < 200 ? 3 : Math.abs(n) < 5000 ? 1 : 1)
  return n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d })
}

function groupRows(rows: PaperTradingApi["rows"]) {
  const order = [...SLEEVE_KEYS, ""] as Array<SleeveKey | "">
  const groups = new Map<string, PaperTradingApi["rows"]>()
  for (const row of rows) {
    const sleeve = row.product.sleeve || row.position?.sleeve || ""
    const list = groups.get(sleeve) || []
    list.push(row)
    groups.set(sleeve, list)
  }
  return order
    .filter((key) => groups.has(key))
    .map((sleeve) => ({ sleeve, rows: groups.get(sleeve) || [] }))
    .concat(
      [...groups.entries()]
        .filter(([key]) => !order.includes(key as SleeveKey | ""))
        .map(([sleeve, grouped]) => ({ sleeve, rows: grouped })),
    )
}

export function PaperStrategyBuilder({
  paper,
  symbols,
  quotes,
  chartSymbol,
  lastPrice,
  onSelectSymbol,
}: {
  paper: PaperTradingApi
  symbols: string[]
  quotes: Record<string, CtpTick>
  chartSymbol: string
  lastPrice: number | null
  onSelectSymbol: (symbol: string) => void
}) {
  const [tab, setTab] = useState<"order" | "algo">("order")
  const [symbol, setSymbol] = useState(chartSymbol)
  const [side, setSide] = useState<PaperSide>("long")
  const [lots, setLots] = useState("1")
  const [price, setPrice] = useState("")
  const [orderType, setOrderType] = useState<"market" | "limit">("market")
  const [name, setName] = useState("")
  const [entryMode, setEntryMode] = useState<PaperEntryMode>("ma_cross")
  const [stopLoss, setStopLoss] = useState("")
  const [takeProfit, setTakeProfit] = useState("")
  const kind = accountKind(paper.selectedPortfolio)
  const awAccount = kind === "all-weather"

  useEffect(() => {
    if (chartSymbol) setSymbol(chartSymbol)
  }, [chartSymbol])

  useEffect(() => {
    setTab(kind === "strategy" ? "algo" : "order")
  }, [kind, paper.selectedPortfolioId])

  function resolve(raw: string) {
    return resolveSymbolInput(raw, symbols, quotes)
  }

  function markOf(raw: string) {
    const resolved = resolve(raw)
    if (!resolved) return null
    return markPrice(resolved, quotes, {}, paper.extraMarks) ?? lastPrice
  }

  function submitOrder() {
    const resolved = resolve(symbol || chartSymbol)
    if (!resolved) {
      paper.setError("无法识别合约")
      return
    }
    const mark = markOf(resolved)
    const px = orderType === "limit" && price ? Number(price) : mark
    if (px == null || !Number.isFinite(px)) {
      paper.setError("请填写价格或等待行情")
      return
    }
    const err = paper.openManual(paper.selectedPortfolioId, resolved, side, Number(lots) || 0, px)
    if (!err) onSelectSymbol(resolved)
  }

  function submitAlgo() {
    const resolved = resolve(symbol || chartSymbol)
    if (!resolved) {
      paper.setError("无法识别合约")
      return
    }
    const id = paper.createAndArmStrategy({
      portfolioId: paper.selectedPortfolioId,
      name: name || "双均策略",
      symbol: resolved,
      side,
      lots: Number(lots) || 0,
      entryMode,
      maFast: 5,
      maSlow: 20,
      stopLossPts: stopLoss ? Number(stopLoss) : null,
      takeProfitPts: takeProfit ? Number(takeProfit) : null,
    })
    if (id) onSelectSymbol(resolved)
  }

  const strategies = paper.state.strategies.filter((s) => s.portfolioId === paper.selectedPortfolioId)
  const active = strategies.find((s) => s.status === "filled" || s.status === "armed")

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e222d]">
      <div className="flex shrink-0 border-b border-[#2a2e39]">
        {(
          [
            ["order", "期货交易"],
            ["algo", "策略交易"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 py-2 text-xs",
              tab === id ? "border-b-2 border-[#4c84ff] text-white" : "text-[#787b86] hover:text-[#d1d4dc]",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {awAccount ? (
        <div className="shrink-0 border-b border-[#2a2e39] bg-[#2a2218] px-3 py-1.5 text-[11px] leading-snug text-[#e0b56a]">
          全天候账户由策略自动调仓。不建议在此组合手动开平仓。
        </div>
      ) : kind === "strategy" ? (
        <div className="shrink-0 border-b border-[#2a2e39] px-3 py-1.5 text-[11px] leading-snug text-[#787b86]">
          该账户以策略成交为主：入场条件满足后会自动下单。也可切到期货交易手动买卖。
        </div>
      ) : (
        <div className="shrink-0 border-b border-[#2a2e39] px-3 py-1.5 text-[11px] leading-snug text-[#787b86]">
          该账户可手动买卖，也可挂双均 / 突破策略自动成交。
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <label className="block text-[11px] text-[#787b86]">
          合约
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onBlur={() => {
              const resolved = resolve(symbol)
              if (resolved) {
                setSymbol(resolved)
                onSelectSymbol(resolved)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const resolved = resolve(symbol)
                if (resolved) {
                  setSymbol(resolved)
                  onSelectSymbol(resolved)
                }
              }
            }}
            placeholder="TA2701 / IF2609"
            className={cn(fieldClass, "mt-1 font-mono")}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSide("long")}
            className={cn(
              "h-10 rounded text-sm font-medium",
              side === "long" ? "bg-[#ef5350] text-white" : "bg-[#2a1f1f] text-[#ef5350] hover:bg-[#3a2424]",
            )}
          >
            买入
          </button>
          <button
            type="button"
            onClick={() => setSide("short")}
            className={cn(
              "h-10 rounded text-sm font-medium",
              side === "short" ? "bg-[#26a69a] text-white" : "bg-[#1a2a28] text-[#26a69a] hover:bg-[#1f3330]",
            )}
          >
            卖出
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-[#787b86]">
            手数
            <input value={lots} onChange={(e) => setLots(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </label>
          <label className="text-[11px] text-[#787b86]">
            价格
            <input
              value={orderType === "market" ? "" : price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={orderType === "market" ? `市价 ${fmtPx(markOf(symbol), symbol)}` : "限价"}
              disabled={orderType === "market"}
              className={cn(fieldClass, "mt-1 disabled:opacity-60")}
            />
          </label>
        </div>
        {tab === "order" ? (
          <div className="mt-3 flex gap-4 text-[11px] text-[#d1d4dc]">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={orderType === "market"} onChange={() => setOrderType("market")} className="accent-[#4c84ff]" />
              市价单
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={orderType === "limit"} onChange={() => setOrderType("limit")} className="accent-[#4c84ff]" />
              限价单
            </label>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] text-[#787b86]">
              策略名称
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="双均策略" className={cn(fieldClass, "mt-1")} />
            </label>
            <div className="flex gap-3 text-[11px] text-[#d1d4dc]">
              {(
                [
                  ["market", "市价"],
                  ["ma_cross", "双均"],
                  ["breakout", "突破"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-1">
                  <input type="radio" checked={entryMode === id} onChange={() => setEntryMode(id)} className="accent-[#4c84ff]" />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-[#787b86]">
                止盈(点)
                <input value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className={cn(fieldClass, "mt-1")} />
              </label>
              <label className="text-[11px] text-[#787b86]">
                止损(点)
                <input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className={cn(fieldClass, "mt-1")} />
              </label>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={tab === "order" ? submitOrder : submitAlgo}
          className="mt-4 h-10 w-full rounded bg-[#4c84ff] text-sm font-medium text-white hover:bg-[#3d74ee]"
        >
          {tab === "order" ? (orderType === "market" ? "市价下单" : "限价挂单") : "开始策略"}
        </button>
        {paper.error ? <p className="mt-2 text-[11px] text-[#ef5350]">{paper.error}</p> : null}
      </div>
      <div className="shrink-0 border-t border-[#2a2e39] px-3 py-2">
        <div className="text-[10px] text-[#787b86]">已选策略</div>
        {active ? (
          <button type="button" className="mt-1 w-full text-left" onClick={() => onSelectSymbol(active.symbol)}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white">{active.name}</span>
              <span className={cn("text-[10px]", active.status === "filled" || active.status === "armed" ? "text-[#4c84ff]" : "text-[#787b86]")}>
                {active.status === "filled" || active.status === "armed" ? "运行中" : strategyStatusLabel(active.status)}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[#adb3bd]">
              {active.symbol} · {sideLabel(active.side)} {active.lots}手
            </div>
          </button>
        ) : (
          <p className="mt-1 text-[11px] text-[#787b86]">
            {awAccount ? "全天候持仓由系统自动执行。" : "启动策略或手动下单后显示在这里。"}
          </p>
        )}
      </div>
    </div>
  )
}

export function PaperPortfolioPanel({
  paper,
  symbols,
  quotes,
  chartSymbol,
  onSelectSymbol,
}: {
  paper: PaperTradingApi
  symbols: string[]
  quotes: Record<string, CtpTick>
  chartSymbol: string
  onSelectSymbol: (symbol: string) => void
}) {
  const [newName, setNewName] = useState("")
  const [newKind, setNewKind] = useState<Exclude<PaperAccountKind, "all-weather">>("manual")
  const [addSymbol, setAddSymbol] = useState("")
  const selectedKind = accountKind(paper.selectedPortfolio)
  const awSelected = selectedKind === "all-weather"

  function createAccount() {
    paper.createPortfolio(newName, newKind)
    setNewName("")
  }

  function resolve(raw: string) {
    return resolveSymbolInput(raw, symbols, quotes)
  }

  function addProduct() {
    const resolved = resolve(addSymbol)
    if (!resolved) {
      paper.setError("无法识别合约")
      return
    }
    paper.addProduct(paper.selectedPortfolioId, resolved)
    onSelectSymbol(resolved)
    setAddSymbol("")
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e222d]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#2a2e39] px-2 py-1">
        <span className="px-1 text-[11px] text-white">品种</span>
        <span className={cn("pr-1 font-mono text-[11px]", pnlClass(paper.summary.unrealized))}>{fmtMoney(paper.summary.unrealized)}</span>
      </div>
      <div className="shrink-0 space-y-2 border-b border-[#2a2e39] px-3 py-2">
        <div className="flex items-center justify-between text-xs text-white">
          <span>模拟账户</span>
          <span className="text-[11px] text-[#adb3bd]">
            {paper.selectedPortfolio?.name || "--"}
            <span className="ml-1 text-[#787b86]">{accountKindLabel(selectedKind)}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {paper.state.portfolios.map((pf) => {
            const kind = accountKind(pf)
            const active = paper.selectedPortfolioId === pf.id
            return (
              <button
                key={pf.id}
                type="button"
                onClick={() => paper.setSelectedPortfolioId(pf.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                  active ? "bg-[#4c84ff] text-white" : "bg-[#131722] text-[#adb3bd] hover:text-white",
                )}
              >
                {pf.name}
                <span className={cn("text-[10px]", active ? "text-white/80" : "text-[#787b86]")}>
                  {accountKindLabel(kind)}
                </span>
              </button>
            )
          })}
          {paper.state.portfolios.length > 1 && !awSelected ? (
            <button
              type="button"
              title="删除当前账户"
              onClick={() => paper.deletePortfolio(paper.selectedPortfolioId)}
              className="rounded px-1.5 py-0.5 text-[#787b86] hover:text-[#ef5350]"
            >
              <Trash2 className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createAccount()
            }}
            placeholder="账户名称，可留空"
            className={fieldClass}
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as Exclude<PaperAccountKind, "all-weather">)}
            className={cn(fieldClass, "w-[4.5rem] shrink-0 px-1")}
            title="账户类型"
          >
            <option value="manual">手动</option>
            <option value="strategy">策略</option>
          </select>
          <button
            type="button"
            title="新建账户"
            onClick={createAccount}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#2a2e39] text-[#adb3bd] hover:text-white"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {awSelected ? (
          <>
            <div className="flex rounded border border-[#2a2e39] bg-[#131722] p-0.5">
              {CONTRACT_TENORS.map((item) => {
                const active = (paper.awMeta?.contractTenor ?? "current") === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={paper.awLoading}
                    title={item.hint}
                    onClick={() => {
                      if ((paper.awMeta?.contractTenor ?? "current") === item.id) return
                      if (!window.confirm("切换合约月份会按新合约重建全天候模拟盘。")) return
                      void paper.setContractTenor(item.id).then((sym) => {
                        if (sym) onSelectSymbol(sym)
                      })
                    }}
                    className={cn(
                      "flex-1 rounded px-1.5 py-1 text-[10px]",
                      active ? "bg-[#4c84ff] text-white" : "text-[#adb3bd] hover:text-white",
                    )}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              disabled={paper.awLoading}
              onClick={() => {
                void paper.loadAllWeather().then((sym) => {
                  if (sym) onSelectSymbol(sym)
                })
              }}
              className="h-8 w-full rounded bg-[#4c84ff] text-[12px] text-white hover:bg-[#3d74ee] disabled:opacity-60"
            >
              {paper.awLoading ? "同步全天候…" : "立即同步持仓"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={paper.awLoading}
            onClick={() => {
              void paper.loadAllWeather().then((sym) => {
                if (sym) onSelectSymbol(sym)
              })
            }}
            className="h-8 w-full rounded border border-[#2a2e39] text-[12px] text-[#adb3bd] hover:text-white disabled:opacity-60"
          >
            {paper.awLoading ? "同步全天候…" : "打开全天候自动账户"}
          </button>
        )}
      </div>
      {paper.awMeta && paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID ? (
        <div className="grid grid-cols-2 gap-1 border-b border-[#2a2e39] px-3 py-1.5">
          {SLEEVE_KEYS.map((key) => {
            const v = paper.awMeta?.lastBudget?.[key]
            const pnl = paper.sleevePnl[key]?.live ?? 0
            return (
              <div key={key} className="rounded bg-[#131722] px-1.5 py-1">
                <div className="flex items-center justify-between text-[10px] text-[#adb3bd]">
                  <span style={{ color: SLEEVE_COLORS[key] }}>{SLEEVE_LABELS[key]}</span>
                  <span>{v != null ? `${(v * 100).toFixed(1)}%` : "--"}</span>
                </div>
                <div className={cn("font-mono text-[11px]", pnlClass(pnl))}>{fmtMoney(pnl)}</div>
              </div>
            )
          })}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {paper.rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-[#787b86]">加载策略或添加品种后，点击行即可切换主图。</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#1e222d] text-[#787b86]">
              <tr>
                <th className="px-3 py-1.5 font-normal">合约</th>
                <th className="px-1 py-1.5 font-normal">现价</th>
                <th className="px-3 py-1.5 text-right font-normal">持仓</th>
              </tr>
            </thead>
            <tbody>
              {groupRows(paper.rows).map((block) => (
                <Fragment key={block.sleeve || "other"}>
                  {block.sleeve ? (
                    <tr className="border-t border-[#2a2e39] bg-[#181c27]">
                      <td colSpan={2} className="px-3 py-1 text-[10px] text-[#787b86]">
                        {SLEEVE_LABELS[block.sleeve as SleeveKey] || block.sleeve}
                      </td>
                      <td className={cn("px-3 py-1 text-right font-mono text-[10px]", pnlClass(isSleeveKey(block.sleeve) ? paper.sleevePnl[block.sleeve]?.live : null))}>
                        {isSleeveKey(block.sleeve) ? fmtMoney(paper.sleevePnl[block.sleeve]?.live ?? 0) : ""}
                      </td>
                    </tr>
                  ) : null}
                  {block.rows.map((row) => (
                    <tr
                      key={row.product.id}
                      onClick={() => onSelectSymbol(row.product.symbol)}
                      className={cn(
                        "cursor-pointer border-t border-[#2a2e39] hover:bg-[#262b38]",
                        chartSymbol === row.product.symbol && "bg-[#262b38]",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-white">{row.product.symbol}</div>
                        <div className="text-[10px] text-[#787b86]">{row.product.label || row.position?.label || ""}</div>
                      </td>
                      <td className={cn("px-1 font-mono", pnlClass(row.diff))}>{fmtPx(row.mark, row.product.symbol)}</td>
                      <td className="px-3 text-right text-[#adb3bd]">
                        {row.position ? `${sideLabel(row.position.side)} ${row.position.lots}` : "—"}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-[#2a2e39] px-3 py-2">
        <div className="flex gap-1.5">
          <input
            value={addSymbol}
            onChange={(e) => setAddSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addProduct()
            }}
            placeholder="添加品种 TA2701 / AU"
            className={cn(fieldClass, "font-mono")}
          />
          <button type="button" onClick={addProduct} className="h-8 shrink-0 rounded bg-[#131722] px-2 text-[11px] text-[#adb3bd] hover:text-white">
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

export function PaperPositionsBar({
  paper,
  chartSymbol,
  onSelectSymbol,
}: {
  paper: PaperTradingApi
  chartSymbol: string
  onSelectSymbol: (symbol: string) => void
}) {
  const [tab, setTab] = useState<"pos" | "closed">("pos")
  const closed = paper.state.positions.filter(
    (p) => p.status === "closed" && (!paper.selectedPortfolio || p.portfolioId === paper.selectedPortfolio.id),
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e222d]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[#2a2e39] px-3 py-1">
        <div className="flex">
          {(
            [
              ["pos", "持仓"],
              ["closed", "已平仓"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                tab === id ? "bg-[#2a2e39] text-white" : "text-[#787b86] hover:text-[#d1d4dc]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[#787b86]">
          浮动 <span className={cn("font-mono", pnlClass(paper.summary.unrealized))}>{fmtMoney(paper.summary.unrealized)}</span>
        </span>
        <span className="text-[#787b86]">
          已实现 <span className={cn("font-mono", pnlClass(paper.summary.realized))}>{fmtMoney(paper.summary.realized)}</span>
        </span>
        <span className="text-[#787b86]">
          保证金占用 <span className="font-mono text-[#d1d4dc]">{fmtYuan(paper.summary.marginOccupied)}</span>
        </span>
        {paper.awMeta && paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID ? (
          <>
            <span className="text-[#787b86]">
              净值{" "}
              <span className="font-mono text-[#d1d4dc]">
                {fmtMoney((paper.awMeta.initialCapital || 0) + paper.summary.unrealized + paper.summary.realized).replace("+", "")}
              </span>
            </span>
            {SLEEVE_KEYS.map((key) => {
              const pnl = paper.sleevePnl[key]?.live ?? 0
              return (
                <span key={key} className="text-[#787b86]">
                  {SLEEVE_LABELS[key]} <span className={cn("font-mono", pnlClass(pnl))}>{fmtMoney(pnl)}</span>
                </span>
              )
            })}
          </>
        ) : null}
        <button
          type="button"
          onClick={() => paper.flattenAll()}
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-[#adb3bd] hover:text-white"
        >
          全平
        </button>
        <span className="text-[#adb3bd]">持仓 {paper.summary.openCount}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "closed" ? (
          closed.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-[#787b86]">暂无已平仓记录。</p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[#1e222d] text-[#787b86]">
                <tr>
                  <th className="px-3 py-1 font-normal">合约</th>
                  <th className="px-2 py-1 font-normal">方向</th>
                  <th className="px-2 py-1 font-normal">手数</th>
                  <th className="px-2 py-1 font-normal">开仓</th>
                  <th className="px-2 py-1 font-normal">平仓</th>
                  <th className="px-3 py-1 text-right font-normal">盈亏</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((position) => (
                  <tr key={position.id} className="border-t border-[#2a2e39]">
                    <td className="px-3 py-1.5 font-mono text-white">{position.symbol}</td>
                    <td className={position.side === "long" ? "px-2 text-[#ef5350]" : "px-2 text-[#26a69a]"}>{sideLabel(position.side)}</td>
                    <td className="px-2">{position.lots}</td>
                    <td className="px-2 font-mono">{fmtPx(position.entryPrice, position.symbol)}</td>
                    <td className="px-2 font-mono">{fmtPx(position.exitPrice, position.symbol)}</td>
                    <td className={cn("px-3 text-right font-mono", pnlClass(positionPnl(position, position.exitPrice ?? null)))}>
                      {fmtMoney(positionPnl(position, position.exitPrice ?? null))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : paper.openPositions.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-[#787b86]">暂无持仓。在左侧下单后，点击合约可切到主图。</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#1e222d] text-[#787b86]">
              <tr>
                <th className="px-3 py-1 font-normal">合约</th>
                <th className="px-2 py-1 font-normal">方向</th>
                <th className="px-2 py-1 font-normal">手数</th>
                <th className="px-2 py-1 font-normal">开仓</th>
                <th className="px-2 py-1 font-normal">现价</th>
                <th className="px-2 py-1 font-normal">策略</th>
                <th className="px-2 py-1 text-right font-normal">浮动盈亏</th>
                <th className="px-2 py-1 text-right font-normal">保证金占用</th>
                <th className="px-3 py-1" />
              </tr>
            </thead>
            <tbody>
              {paper.openPositions.map(({ position, mark, pnl, margin, strategy }) => (
                <tr
                  key={position.id}
                  onClick={() => onSelectSymbol(position.symbol)}
                  className={cn(
                    "cursor-pointer border-t border-[#2a2e39] hover:bg-[#262b38]",
                    chartSymbol === position.symbol && "bg-[#262b38]",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <div className="font-mono text-white">{position.symbol}</div>
                    {position.label ? <div className="text-[10px] text-[#787b86]">{position.label}</div> : null}
                  </td>
                  <td className={cn("px-2", position.side === "long" ? "text-[#ef5350]" : "text-[#26a69a]")}>
                    {sideLabel(position.side)}
                  </td>
                  <td className="px-2 tabular-nums">{position.lots}</td>
                  <td className="px-2 font-mono">{fmtPx(position.entryPrice, position.symbol)}</td>
                  <td className="px-2 font-mono">{fmtPx(mark, position.symbol)}</td>
                  <td className="max-w-[160px] truncate px-2 text-[#adb3bd]">
                    {strategy?.name ||
                      (position.source === "all-weather" ? "全天候" : position.source === "strategy" ? "策略" : "手动")}
                  </td>
                  <td className={cn("px-2 text-right font-mono", pnlClass(pnl))}>{fmtMoney(pnl)}</td>
                  <td className="px-2 text-right font-mono text-[#d1d4dc]">{fmtYuan(margin)}</td>
                  <td className="px-3 text-right">
                    <button
                      type="button"
                      className="text-[#adb3bd] hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation()
                        paper.flatten(position.id)
                      }}
                    >
                      平仓
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function PaperAllWeatherOrderDialog({ paper }: { paper: PaperTradingApi }) {
  if (!paper.awConfirm) return null
  return (
    <div
      className="absolute inset-0 z-[90] flex items-center justify-center bg-black/60 px-4"
      onClick={paper.dismissAwConfirm}
    >
      <div
        className="w-full max-w-[420px] rounded-lg border border-[#2a2e39] bg-[#1e222d] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-medium text-white">不建议在本组合手动下单</div>
        <p className="mt-2 text-[13px] leading-relaxed text-[#adb3bd]">
          全天候策略账户由系统自动执行调仓。我们不建议在此组合中自行开仓或平仓，手动下单会偏离风险平价目标，可能影响模拟净值。
        </p>
        <p className="mt-2 text-[12px] text-[#787b86]">当前操作：{paper.awConfirm.action}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={paper.dismissAwConfirm}
            className="h-8 rounded border border-[#2a2e39] px-3 text-[12px] text-[#d1d4dc] hover:bg-[#2a2e39]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={paper.confirmAwAction}
            className="h-8 rounded bg-[#ef5350] px-3 text-[12px] text-white hover:bg-[#d44848]"
          >
            仍要{paper.awConfirm.action}
          </button>
        </div>
      </div>
    </div>
  )
}
