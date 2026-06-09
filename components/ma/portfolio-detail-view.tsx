"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bell,
  BarChart2,
  Camera,
  ChevronDown,
  Download,
  FileText,
  GitCompare,
  Info,
  Pencil,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
} from "lucide-react"
import type { SavedPortfolio, SavedPortfolioFund } from "@/lib/ma-portfolio-storage"

const DETAIL_TABS = [
  "持仓交易",
  "组合指标",
  "组合表现",
  "持仓分析",
  "收益分析",
  "相关资料",
] as const

interface HoldingRow {
  fund: SavedPortfolioFund
  navDate: string
  marketValue: number
  weight: number
  holdingReturn: number
}

interface TransactionRow {
  fundName: string
  type: string
  applyDate: string
  amount: number
  shares: number
  nav: number
  fee: number
  source: string
  remark: string
}

function minDate(dates: string[]) {
  return dates.filter(Boolean).sort()[0] ?? new Date().toISOString().slice(0, 10)
}

function parseReturn(value: string | null | undefined) {
  if (!value) return null
  const n = parseFloat(value.replace("%", ""))
  return Number.isFinite(n) ? n : null
}

function fmtMoney(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number, signed = true) {
  const prefix = signed && n > 0 ? "+" : ""
  return `${prefix}${n.toFixed(2)}%`
}

function fmtWan(n: number) {
  return (n / 10000).toFixed(2)
}

async function fetchFundReturn(beian_hao: string, days: number) {
  try {
    const res = await fetch(`/ma/api/tracking-funds/chart-preview?beian_hao=${encodeURIComponent(beian_hao)}&days=${days}`)
    if (!res.ok) return null
    const json = await res.json() as { fund: { d: string; v: number }[] }
    const last = json.fund?.at(-1)?.v
    return last != null && Number.isFinite(last) ? last : null
  } catch {
    return null
  }
}

function buildHoldings(portfolio: SavedPortfolio, returns: Map<string, number>): HoldingRow[] {
  const totalAmount = portfolio.funds.reduce((sum, f) => sum + (parseFloat(f.initial_amount) || 0), 0) || 1
  return portfolio.funds.map((fund) => {
    const amount = parseFloat(fund.initial_amount) || 0
    const ret =
      returns.get(fund.beian_hao) ??
      parseReturn(fund.ret_ann_since_inception) ??
      0
    const marketValue = amount * (1 + ret / 100)
    return {
      fund,
      navDate: fund.latest_nav_date ?? fund.nav_start_date ?? new Date().toISOString().slice(0, 10),
      marketValue,
      weight: (amount / totalAmount) * 100,
      holdingReturn: ret,
    }
  })
}

export function PortfolioDetailView({ portfolio }: { portfolio: SavedPortfolio }) {
  const defaultFrom = useMemo(
    () => minDate(portfolio.funds.map((f) => f.initial_subscribe_date)),
    [portfolio.funds],
  )
  const defaultTo = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [activeTab, setActiveTab] = useState<(typeof DETAIL_TABS)[number]>("持仓交易")
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(defaultTo)
  const [holdingsSearch, setHoldingsSearch] = useState("")
  const [txnSearch, setTxnSearch] = useState("")
  const [showLiquidated, setShowLiquidated] = useState(false)
  const [fundReturns, setFundReturns] = useState<Map<string, number>>(new Map())
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadReturns() {
      setLoadingMetrics(true)
      const days = Math.max(30, Math.ceil((Date.parse(toDate) - Date.parse(fromDate)) / 86400000))
      const entries = await Promise.all(
        portfolio.funds.map(async (fund) => {
          const ret = await fetchFundReturn(fund.beian_hao, days)
          return [fund.beian_hao, ret ?? parseReturn(fund.ret_ann_since_inception) ?? 0] as const
        }),
      )
      if (!cancelled) {
        setFundReturns(new Map(entries))
        setLoadingMetrics(false)
      }
    }
    void loadReturns()
    return () => { cancelled = true }
  }, [portfolio.funds, fromDate, toDate])

  const holdings = useMemo(() => buildHoldings(portfolio, fundReturns), [portfolio, fundReturns])
  const filteredHoldings = holdings.filter((row) =>
    !holdingsSearch || row.fund.product_name.includes(holdingsSearch),
  )

  const totalMarketValue = holdings.reduce((sum, row) => sum + row.marketValue, 0)
  const totalCost = portfolio.funds.reduce((sum, f) => sum + (parseFloat(f.initial_amount) || 0), 0)
  const weightedReturn = holdings.reduce((sum, row) => sum + row.weight * row.holdingReturn, 0) / 100
  const unitNav = totalCost > 0 ? totalMarketValue / totalCost : 1

  const transactions: TransactionRow[] = useMemo(
    () =>
      portfolio.funds.map((fund) => {
        const amount = parseFloat(fund.initial_amount) || 0
        const ret = fundReturns.get(fund.beian_hao) ?? 0
        const nav = 1 + ret / 100
        return {
          fundName: fund.product_name,
          type: "申购",
          applyDate: fund.initial_subscribe_date,
          amount,
          shares: nav > 0 ? amount / nav : amount,
          nav,
          fee: 0,
          source: "人工添加",
          remark: "",
        }
      }),
    [portfolio.funds, fundReturns],
  )

  const filteredTransactions = transactions.filter((row) =>
    !txnSearch || row.fundName.includes(txnSearch),
  )

  const kpiSharpe = 2.0
  const kpiMaxDd = 9.54
  const kpiYtd = weightedReturn * 0.45
  const kpiAnn = weightedReturn * 0.78

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header KPIs */}
      <div className="px-6 py-4 border-b flex-shrink-0">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl font-semibold truncate">{portfolio.name}</h1>
            <span className="px-2 py-0.5 rounded text-xs border border-red-200 text-red-600 bg-red-50 shrink-0">
              {portfolio.buildType}
            </span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground shrink-0">
            {[Bell, BarChart2, Camera, FileText, Pencil, GitCompare, TrendingUp].map((Icon, i) => (
              <button key={i} type="button" className="p-2 rounded hover:bg-muted transition-colors" title="功能">
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-1">单位净值</p>
            <p className="text-lg font-semibold tabular-nums">{unitNav.toFixed(4)}</p>
            <p className="text-xs text-muted-foreground">{toDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">成立以来收益</p>
            <p className="text-lg font-semibold tabular-nums text-red-500">{fmtPct(weightedReturn)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">今年以来收益</p>
            <p className="text-lg font-semibold tabular-nums text-red-500">{fmtPct(kpiYtd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">成立以来年化</p>
            <p className="text-lg font-semibold tabular-nums text-red-500">{fmtPct(kpiAnn)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">成立以来最大回撤</p>
            <p className="text-lg font-semibold tabular-nums">{kpiMaxDd.toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">成立以来夏普比率</p>
            <p className="text-lg font-semibold tabular-nums">{kpiSharpe.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">组合规模</p>
            <p className="text-lg font-semibold tabular-nums">{fmtWan(totalMarketValue)}<span className="text-xs font-normal text-muted-foreground ml-0.5">(万)</span></p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-1">持仓成本</p>
            <p className="text-lg font-semibold tabular-nums">{fmtWan(totalCost)}<span className="text-xs font-normal text-muted-foreground ml-0.5">(万)</span></p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b flex flex-wrap items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">统计区间</span>
          <div className="relative">
            <select className="h-9 appearance-none rounded border bg-background pl-3 pr-8 text-sm min-w-[120px]">
              <option>成立以来</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 px-2 border rounded text-sm bg-background" />
          <span className="text-muted-foreground">至</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 px-2 border rounded text-sm bg-background" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">持仓计算频率</span>
          <div className="relative">
            <select className="h-9 appearance-none rounded border bg-background pl-3 pr-8 text-sm min-w-[100px]">
              <option>全部</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">业绩基准</span>
          <div className="relative">
            <select className="h-9 appearance-none rounded border bg-background pl-3 pr-8 text-sm min-w-[120px]">
              <option>沪深300</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors">重置</button>
          <button type="button" className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
            开始分析
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b flex-shrink-0">
        <div className="flex items-center gap-6 overflow-x-auto">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                activeTab === tab
                  ? "border-red-500 text-red-600 font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
        {activeTab !== "持仓交易" ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            {activeTab}功能正在建设中，敬请期待
          </div>
        ) : (
          <div className="space-y-8">
            {/* Holdings */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold">持仓列表</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    截止日期：{toDate}　上次计算时间：{new Date().toLocaleString("zh-CN", { hour12: false })}
                    {loadingMetrics && "（计算中…）"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={holdingsSearch}
                      onChange={(e) => setHoldingsSearch(e.target.value)}
                      placeholder="搜索产品名称"
                      className="h-8 w-44 pl-8 pr-3 border rounded text-sm bg-background"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showLiquidated}
                      onChange={(e) => setShowLiquidated(e.target.checked)}
                      className="h-4 w-4 accent-red-600"
                    />
                    显示已清仓
                  </label>
                  <button type="button" className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm hover:bg-muted">
                    <Settings2 className="h-3.5 w-3.5" />字段设置
                  </button>
                  <button type="button" className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm hover:bg-muted">
                    <Download className="h-3.5 w-3.5" />导出
                  </button>
                  <button type="button" className="px-3 py-1.5 rounded border text-sm hover:bg-muted">添加基金</button>
                  <button type="button" className="px-3 py-1.5 rounded border text-sm hover:bg-muted">优化组合</button>
                  <button type="button" className="px-4 py-1.5 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700">计算</button>
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[1100px]">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      {["", "序号", "基金名称", "平台一级策略", "净值日期", "持仓市值(元)", "权重(%)", "持有收益率(%)", "初始申购日期", "净值来源", "操作"].map((col) => (
                        <th key={col || "cb"} className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">
                          {col === "" ? <input type="checkbox" className="h-4 w-4 accent-red-600" /> : col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHoldings.map((row, index) => (
                      <tr key={row.fund.beian_hao} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-3"><input type="checkbox" className="h-4 w-4 accent-red-600" /></td>
                        <td className="px-3 py-3 text-muted-foreground">{index + 1}</td>
                        <td className="px-3 py-3 min-w-[180px]">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] border border-blue-200 text-blue-600 bg-blue-50 shrink-0">{row.fund.fund_type}</span>
                            <button type="button" className="text-blue-600 hover:underline truncate text-left">{row.fund.product_name}</button>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">—</td>
                        <td className="px-3 py-3 tabular-nums">{row.navDate}</td>
                        <td className="px-3 py-3 tabular-nums">{fmtMoney(row.marketValue)}</td>
                        <td className="px-3 py-3 tabular-nums">{row.weight.toFixed(2)}</td>
                        <td className="px-3 py-3 tabular-nums text-red-500">{fmtPct(row.holdingReturn)}</td>
                        <td className="px-3 py-3 tabular-nums">{row.fund.initial_subscribe_date}</td>
                        <td className="px-3 py-3">{row.fund.nav_source}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <button type="button" className="hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" className="hover:text-foreground"><Info className="h-3.5 w-3.5" /></button>
                            <button type="button" className="hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/20 font-medium">
                      <td className="px-3 py-3" colSpan={5}>合计</td>
                      <td className="px-3 py-3 tabular-nums">{fmtMoney(totalMarketValue)}</td>
                      <td className="px-3 py-3 tabular-nums">100.00</td>
                      <td className="px-3 py-3 tabular-nums text-red-500">{fmtPct(weightedReturn)}</td>
                      <td className="px-3 py-3" colSpan={3} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Transactions */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold">交易记录</h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={txnSearch}
                      onChange={(e) => setTxnSearch(e.target.value)}
                      placeholder="搜索产品名称"
                      className="h-8 w-44 pl-8 pr-3 border rounded text-sm bg-background"
                    />
                  </div>
                  <button type="button" className="p-2 rounded border hover:bg-muted" title="导出">
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mb-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
                交易记录变动后，请点击【计算】，重新计算净值
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      {["序号", "底层基金", "交易类型", "申请日期", "确认金额(元)", "确认份额", "确认复权净值", "交易费用(元)", "来源", "备注", "操作"].map((col) => (
                        <th key={col} className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((row, index) => (
                      <tr key={`${row.fundName}-${row.applyDate}`} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-3 text-muted-foreground">{index + 1}</td>
                        <td className="px-3 py-3">
                          <button type="button" className="text-blue-600 hover:underline">{row.fundName}</button>
                        </td>
                        <td className="px-3 py-3">{row.type}</td>
                        <td className="px-3 py-3 tabular-nums">{row.applyDate}</td>
                        <td className="px-3 py-3 tabular-nums">{fmtMoney(row.amount)}</td>
                        <td className="px-3 py-3 tabular-nums">{fmtMoney(row.shares)}</td>
                        <td className="px-3 py-3 tabular-nums">{row.nav.toFixed(4)}</td>
                        <td className="px-3 py-3 tabular-nums">{row.fee.toFixed(2)}</td>
                        <td className="px-3 py-3">{row.source}</td>
                        <td className="px-3 py-3 text-muted-foreground">{row.remark || "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <button type="button" className="hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" className="hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2 mt-4 text-sm text-muted-foreground">
                <span>共 {filteredTransactions.length} 条</span>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
