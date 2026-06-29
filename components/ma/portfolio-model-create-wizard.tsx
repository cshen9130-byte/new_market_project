"use client"

import { useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import {
  CalendarDays,
  Check,
  Inbox,
  Plus,
  Scale,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  PortfolioFundPickerDialog,
  type PortfolioFundPickerItem,
} from "@/components/ma/portfolio-fund-picker-dialog"
import { PortfolioBacktestPanel } from "@/components/ma/portfolio-backtest-panel"
import { PortfolioSaveDialog } from "@/components/ma/portfolio-save-dialog"
import {
  createPortfolioId,
  savePortfolio,
  type SavedPortfolioFund,
} from "@/lib/ma-portfolio-storage"
import {
  PortfolioSectionShell,
  SectionTitle,
  WizardSteps,
} from "@/components/ma/portfolio-free-create-wizard"

const MODEL_OPTIONS = [
  { key: "custom", label: "自定义权重", icon: SlidersHorizontal },
  { key: "mean-variance", label: "均值方案", icon: TrendingUp },
  { key: "risk-parity", label: "风险平价", icon: Scale },
  { key: "black-litterman", label: "Black Litterman", icon: Sparkles },
] as const

const OPTIMIZATION_GOAL_OPTIONS = [
  { key: "max-return", label: "收益最大化" },
  { key: "min-risk", label: "风险最小化" },
  { key: "max-sharpe", label: "夏普比率最大化" },
  { key: "max-utility", label: "效用最大化" },
] as const

const RISK_CALC_PERIOD_OPTIONS = [
  { key: "6m", label: "近半年" },
  { key: "1y", label: "近一年" },
  { key: "2y", label: "近两年" },
  { key: "3y", label: "近三年" },
  { key: "5y", label: "近五年" },
  { key: "since-inception", label: "成立以来" },
] as const

type OptimizationGoal = (typeof OPTIMIZATION_GOAL_OPTIONS)[number]["key"]
type RiskCalcPeriod = (typeof RISK_CALC_PERIOD_OPTIONS)[number]["key"]

type ModelKey = (typeof MODEL_OPTIONS)[number]["key"]

interface ModelFundRow extends PortfolioFundPickerItem {
  fund_type: "私募" | "公募"
  weight: string
  min_weight: string
  max_weight: string
  expected_return: string
  nav_source: string
  nav_date_range: string
}

const FUND_TABLE_COLUMNS = [
  "序号",
  "产品名称",
  "产品代码",
  "权重",
  "净值来源",
  "净值日期区间",
  "操作",
] as const

const FUND_TABLE_COLUMNS_MV = [
  "序号",
  "产品名称",
  "产品编号",
  "最小权重(%)",
  "最大权重(%)",
  "净值来源",
  "净值日期区间",
  "操作",
] as const

const FUND_TABLE_COLUMNS_BL = [
  "序号",
  "产品名称",
  "产品编号",
  "最小权重(%)",
  "最大权重(%)",
  "预期收益率(%)",
  "净值来源",
  "净值日期区间",
  "操作",
] as const

function getFundTableColumns(model: ModelKey) {
  if (model === "black-litterman") return FUND_TABLE_COLUMNS_BL
  if (model === "mean-variance" || model === "risk-parity") return FUND_TABLE_COLUMNS_MV
  return FUND_TABLE_COLUMNS
}

interface OptimizedPortfolioStats {
  vol: number
  ret: number
  sharpe: number
}

interface FrontierPoint {
  vol: number
  ret: number
}

function createFundRow(item: PortfolioFundPickerItem): ModelFundRow {
  const defaultExpectedReturn = item.ret_ann_since_inception
    ? String(parseFloat(item.ret_ann_since_inception.replace(/%/g, "")) || "")
    : ""
  return {
    ...item,
    fund_type: item.beian_hao.startsWith("P") ? "私募" : "公募",
    weight: "",
    min_weight: "0",
    max_weight: "100",
    expected_return: defaultExpectedReturn,
    nav_source: "平台净值",
    nav_date_range: item.nav_start_date && item.latest_nav_date
      ? `${item.nav_start_date.slice(0, 10)} ~ ${item.latest_nav_date.slice(0, 10)}`
      : item.latest_nav_date?.slice(0, 10) ?? "—",
  }
}

function optimizationGoalLabel(goal: OptimizationGoal) {
  return OPTIMIZATION_GOAL_OPTIONS.find((o) => o.key === goal)?.label ?? goal
}

function riskCalcPeriodLabel(period: RiskCalcPeriod) {
  return RISK_CALC_PERIOD_OPTIONS.find((o) => o.key === period)?.label ?? period
}

function ModelPercentField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0 w-36">{label}</label>
      <div className="relative flex-1 max-w-[200px]">
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full pl-3 pr-8 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
      </div>
    </div>
  )
}

function EfficientFrontierChart({
  frontier,
  portfolio,
  fundPoints,
  periodFrom,
  periodTo,
}: {
  frontier: FrontierPoint[]
  portfolio: OptimizedPortfolioStats
  fundPoints: { beian_hao: string; vol: number; ret: number }[]
  periodFrom?: string
  periodTo?: string
}) {
  const option = {
    grid: { left: 56, right: 24, top: 48, bottom: 48 },
    tooltip: {
      trigger: "item",
      formatter: (p: { seriesName: string; value: number[] }) => {
        if (p.seriesName === "有效前沿曲线") {
          return `有效前沿<br/>年化波动率：${p.value[0].toFixed(2)}%<br/>年化收益率：${p.value[1].toFixed(2)}%`
        }
        if (p.seriesName === "当前配置") {
          return `当前配置<br/>年化波动率：${p.value[0].toFixed(2)}%<br/>年化收益率：${p.value[1].toFixed(2)}%`
        }
        return `单基金<br/>年化波动率：${p.value[0].toFixed(2)}%<br/>年化收益率：${p.value[1].toFixed(2)}%`
      },
    },
    xAxis: {
      type: "value",
      name: "年化波动率",
      nameLocation: "middle",
      nameGap: 28,
      axisLabel: { formatter: "{value}%" },
    },
    yAxis: {
      type: "value",
      name: "年化收益率",
      nameGap: 36,
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        name: "有效前沿曲线",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#ef4444", width: 2 },
        data: frontier.map((p) => [p.vol, p.ret]),
      },
      {
        name: "单基金",
        type: "scatter",
        symbolSize: 8,
        itemStyle: { color: "#fff", borderColor: "#f87171", borderWidth: 1.5 },
        data: fundPoints.map((p) => [p.vol, p.ret]),
      },
      {
        name: "当前配置",
        type: "scatter",
        symbolSize: 12,
        itemStyle: { color: "#ef4444" },
        data: [[portfolio.vol, portfolio.ret]],
      },
    ],
  }

  return (
    <div className="border rounded-lg p-4 h-full min-h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div>
          <h4 className="text-sm font-semibold text-foreground">有效前沿曲线</h4>
          {periodFrom && periodTo && (
            <p className="text-xs text-muted-foreground mt-1">
              预期收益风险计算区间：{periodFrom} ~ {periodTo}
            </p>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-[260px]">
        <ReactECharts option={option} style={{ height: "100%", minHeight: 260 }} notMerge lazyUpdate />
      </div>
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          <span>当前配置</span>
        </div>
        <div>年化收益率：{portfolio.ret.toFixed(2)}%（最大）</div>
        <div>年化波动率：{portfolio.vol.toFixed(2)}%</div>
        <div>夏普比率：{portfolio.sharpe.toFixed(2)}</div>
      </div>
    </div>
  )
}

interface RiskContributionItem {
  beian_hao: string
  product_name: string
  pct: number
}

function RiskContributionChart({
  items,
  periodFrom,
  periodTo,
}: {
  items: RiskContributionItem[]
  periodFrom: string
  periodTo: string
}) {
  const option = {
    grid: { left: 48, right: 24, top: 56, bottom: 72 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ""
        return `${p.name}<br/>风险贡献：${p.value.toFixed(2)}%`
      },
    },
    xAxis: {
      type: "category",
      data: items.map((i) => i.product_name),
      axisLabel: {
        interval: 0,
        rotate: items.length > 2 ? 20 : 0,
        formatter: (v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v),
      },
    },
    yAxis: {
      type: "value",
      name: "风险贡献(%)",
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        type: "bar",
        data: items.map((i) => i.pct),
        itemStyle: { color: "#ef4444" },
        barMaxWidth: 48,
      },
    ],
  }

  return (
    <div className="border rounded-lg p-4 h-full min-h-[320px] flex flex-col">
      <div className="mb-2 flex-shrink-0">
        <h4 className="text-sm font-semibold text-foreground">风险贡献</h4>
        {periodFrom && periodTo && (
          <p className="text-xs text-muted-foreground mt-1">
            预期风险计算区间：{periodFrom} ~ {periodTo}
          </p>
        )}
      </div>
      <div className="flex-1 min-h-[260px]">
        <ReactECharts option={option} style={{ height: "100%", minHeight: 260 }} notMerge lazyUpdate />
      </div>
    </div>
  )
}

function getEqualWeightPercent(count: number, index: number): string {
  if (count <= 0) return "0.00"
  const base = Math.floor((10000 / count)) / 100
  if (index === count - 1) {
    const used = base * (count - 1)
    return (100 - used).toFixed(2)
  }
  return base.toFixed(2)
}

function parseWeightPercent(weight: string): number {
  const n = parseFloat(String(weight).replace(/%/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

function formatWeightPercent(weight: string): string {
  const n = parseWeightPercent(weight)
  return `${n.toFixed(2)}%`
}

function fundRowKey(row: { beian_hao: string; product_name: string }) {
  return `${row.beian_hao}::${row.product_name}`
}

async function fetchNavRange(beian_hao: string, product_name: string) {
  const params = new URLSearchParams({ beian_hao, product_name })
  const res = await fetch(`/ma/api/tracking-funds/nav-range?${params.toString()}`)
  if (!res.ok) return null
  return res.json() as Promise<{ nav_start_date: string | null; latest_nav_date: string | null }>
}

async function enrichModelFundsNavDates(rows: ModelFundRow[]): Promise<ModelFundRow[]> {
  if (rows.length === 0) return rows

  const ranges = await Promise.all(
    rows.map(async (row) => {
      const range = await fetchNavRange(row.beian_hao, row.product_name)
      return { key: fundRowKey(row), range }
    }),
  )
  const rangeMap = new Map(
    ranges.filter((r) => r.range?.nav_start_date).map((r) => [r.key, r.range!]),
  )

  return rows.map((row) => {
    const range = rangeMap.get(fundRowKey(row))
    if (!range?.nav_start_date) return row
    const navStart = range.nav_start_date.slice(0, 10)
    const latestNav = (range.latest_nav_date ?? row.latest_nav_date ?? "").slice(0, 10)
    return {
      ...row,
      nav_start_date: navStart,
      latest_nav_date: latestNav || row.latest_nav_date,
      nav_date_range: latestNav ? `${navStart} ~ ${latestNav}` : navStart,
    }
  })
}

interface BacktestFundInput {
  beian_hao: string
  product_name: string
  initial_subscribe_date: string
  initial_amount: string
  nav_start_date?: string
  latest_nav_date?: string | null
}

function buildBacktestFunds(
  funds: ModelFundRow[],
  initialScaleWan: string,
  cashRatio: string,
  rebalanceDates: string[],
): BacktestFundInput[] {
  const totalYuan = parseFloat(initialScaleWan) * 10000
  const cashPct = parseFloat(cashRatio) || 0
  const investable = totalYuan * (100 - cashPct) / 100
  const subscribeDate = rebalanceDates[0] ?? new Date().toISOString().slice(0, 10)

  return funds.map((fund) => {
    const w = parseWeightPercent(fund.weight)
    const amount = Math.round((investable * w) / 100 * 100) / 100
    return {
      beian_hao: fund.beian_hao,
      product_name: fund.product_name,
      initial_subscribe_date: subscribeDate,
      initial_amount: String(amount),
      nav_start_date: fund.nav_start_date?.slice(0, 10) ?? "",
      latest_nav_date: fund.latest_nav_date,
    }
  })
}

function WeightBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <div className="flex-1 h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
        <div
          className="h-full bg-red-500 rounded transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="tabular-nums text-sm shrink-0 w-16 text-right font-medium">
        {clamped.toFixed(2)}%
      </span>
    </div>
  )
}

function AddRebalanceDateDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (date: string) => void
}) {
  const [date, setDate] = useState("")

  useEffect(() => {
    if (open) setDate("")
  }, [open])

  function handleConfirm() {
    if (!date) {
      window.alert("请选择调仓日期")
      return
    }
    onConfirm(date)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-[520px] gap-0 p-0" showCloseButton>
        <DialogHeader className="px-6 py-4 border-b text-left">
          <DialogTitle className="text-base font-semibold">添加调仓日期</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6">
          <div className="flex items-center gap-4">
            <label className="w-24 shrink-0 text-sm text-right">
              <span className="text-red-500">*</span> 调仓日期:
            </label>
            <div className="relative flex-1">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="请选择日期"
                className="h-9 w-full pl-3 pr-9 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
              />
              <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-6 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            确定
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PortfolioModelCreateWizard() {
  const [step, setStep] = useState(1)
  const [configExpanded, setConfigExpanded] = useState(false)
  const [initialScaleWan, setInitialScaleWan] = useState("")
  const [scaleTouched, setScaleTouched] = useState(false)
  const [rebalanceDates, setRebalanceDates] = useState<string[]>([])
  const [showAddDateDialog, setShowAddDateDialog] = useState(false)
  const [cashRatio, setCashRatio] = useState("0.00")
  const [model, setModel] = useState<ModelKey>("custom")
  const [funds, setFunds] = useState<ModelFundRow[]>([])
  const [showFundPicker, setShowFundPicker] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [backtestFunds, setBacktestFunds] = useState<BacktestFundInput[]>([])
  const [optimizationGoal, setOptimizationGoal] = useState<OptimizationGoal>("max-return")
  const [riskCalcPeriod, setRiskCalcPeriod] = useState<RiskCalcPeriod>("6m")
  const [riskFreeRate, setRiskFreeRate] = useState("0")
  const [minAnnualReturn, setMinAnnualReturn] = useState("")
  const [maxAnnualRisk, setMaxAnnualRisk] = useState("")
  const [maxDrawdown, setMaxDrawdown] = useState("")
  const [optimizing, setOptimizing] = useState(false)
  const [frontier, setFrontier] = useState<FrontierPoint[]>([])
  const [optimizedStats, setOptimizedStats] = useState<OptimizedPortfolioStats | null>(null)
  const [fundFrontierPoints, setFundFrontierPoints] = useState<{ beian_hao: string; vol: number; ret: number }[]>([])
  const [riskContributions, setRiskContributions] = useState<RiskContributionItem[]>([])
  const [periodFrom, setPeriodFrom] = useState("")
  const [periodTo, setPeriodTo] = useState("")

  const isMeanVarianceModel = model === "mean-variance"
  const isRiskParityModel = model === "risk-parity"
  const isBlackLittermanModel = model === "black-litterman"
  const isOptimizedModel = isMeanVarianceModel || isRiskParityModel || isBlackLittermanModel
  const isFrontierModel = isMeanVarianceModel || isBlackLittermanModel
  const showScaleError = configExpanded && scaleTouched && (!initialScaleWan || parseFloat(initialScaleWan) <= 0)
  const modelLabel = MODEL_OPTIONS.find((m) => m.key === model)?.label ?? model
  const modelDisplayLabel = isMeanVarianceModel ? "均值方差" : modelLabel
  const fundTableColumns = getFundTableColumns(model)
  const step2WeightColumn = isBlackLittermanModel ? "最终权重" : "目标权重"
  const planDate = rebalanceDates[0] ?? ""
  const cashPct = parseFloat(cashRatio) || 0
  const fundWeightTotal = funds.reduce((sum, f) => sum + parseWeightPercent(f.weight), 0)
  const weightTotal = fundWeightTotal + cashPct

  function handleAddRebalanceDate(date: string) {
    if (!date) return
    if (rebalanceDates.includes(date)) {
      window.alert("该调仓日期已存在")
      return
    }
    setRebalanceDates((prev) => [...prev, date].sort())
    setConfigExpanded(true)
  }

  function handleRemoveRebalanceDate(date: string) {
    setRebalanceDates((prev) => prev.filter((d) => d !== date))
  }

  function handleCancel() {
    if (window.history.length > 1) {
      window.close()
      window.location.href = "/ma/dashboard/private-funds?tab=portfolio&side=port-new"
    } else {
      window.location.href = "/ma/dashboard/private-funds?tab=portfolio&side=port-new"
    }
  }

  function handleConfirmFunds(items: PortfolioFundPickerItem[]) {
    const existing = new Set(funds.map((f) => f.beian_hao))
    const added = items.filter((item) => !existing.has(item.beian_hao)).map(createFundRow)
    if (added.length === 0) return
    setFunds((prev) => [...prev, ...added])
  }

  function handleEqualWeight() {
    if (funds.length === 0) {
      window.alert("请先添加基金")
      return
    }
    setFunds((prev) =>
      prev.map((fund, index) => ({
        ...fund,
        weight: `${getEqualWeightPercent(prev.length, index)}%`,
      })),
    )
  }

  function handleRemoveFund(beianHao: string) {
    setFunds((prev) => prev.filter((f) => f.beian_hao !== beianHao))
  }

  function handleNext() {
    if (step === 1) {
      setScaleTouched(true)
      const scale = parseFloat(initialScaleWan)
      if (!Number.isFinite(scale) || scale <= 0) return
      if (rebalanceDates.length === 0) {
        window.alert("请先添加调仓日期")
        return
      }
      if (funds.length === 0) {
        window.alert("请先添加基金")
        return
      }
      if (!isOptimizedModel && Math.abs(weightTotal - 100) > 0.01) {
        window.alert(`基金权重与现金占比之和应为 100%，当前为 ${weightTotal.toFixed(2)}%`)
        return
      }
      if (isOptimizedModel) {
        void runOptimizationAndAdvance()
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      void enrichModelFundsNavDates(funds).then((enriched) => {
        setFunds(enriched)
        setBacktestFunds(buildBacktestFunds(enriched, initialScaleWan, cashRatio, rebalanceDates))
        setStep(3)
      })
    }
  }

  async function runOptimizationAndAdvance() {
    setOptimizing(true)
    try {
      const optimizeModel = isRiskParityModel
        ? "risk-parity"
        : isBlackLittermanModel
          ? "black-litterman"
          : "mean-variance"
      const res = await fetch("/ma/api/portfolio/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funds: funds.map((f) => ({
            beian_hao: f.beian_hao,
            product_name: f.product_name,
            min_weight: parseFloat(f.min_weight) || 0,
            max_weight: parseFloat(f.max_weight) || 100,
            ...(isBlackLittermanModel
              ? { expected_return: parseFloat(f.expected_return) || null }
              : {}),
          })),
          model: optimizeModel,
          period: riskCalcPeriod,
          goal: optimizationGoal,
          risk_free_rate: parseFloat(riskFreeRate) || 0,
          cash_ratio: cashPct,
          as_of: planDate || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        window.alert(json.error || "组合优化失败")
        return
      }
      const weightMap = new Map(
        (json.weights as { beian_hao: string; weight: number }[]).map((w) => [w.beian_hao, w.weight]),
      )
      setFunds((prev) =>
        prev.map((f) => ({
          ...f,
          weight: `${(weightMap.get(f.beian_hao) ?? 0).toFixed(2)}%`,
        })),
      )
      setFrontier(Array.isArray(json.frontier) ? json.frontier : [])
      setFundFrontierPoints(Array.isArray(json.fundPoints) ? json.fundPoints : [])
      setOptimizedStats(json.portfolio ?? null)
      setPeriodFrom(json.periodFrom ?? "")
      setPeriodTo(json.periodTo ?? "")
      const rcList = Array.isArray(json.riskContributions)
        ? (json.riskContributions as { beian_hao: string; pct: number }[])
        : []
      setRiskContributions(
        funds.map((f) => {
          const rc = rcList.find((r) => r.beian_hao === f.beian_hao)
          return {
            beian_hao: f.beian_hao,
            product_name: f.product_name,
            pct: rc?.pct ?? 0,
          }
        }),
      )
      setStep(2)
    } catch {
      window.alert("组合优化请求失败")
    } finally {
      setOptimizing(false)
    }
  }

  function handleSavePortfolio() {
    setShowSaveDialog(true)
  }

  function handleConfirmSave(name: string) {
    const id = createPortfolioId()
    const totalYuan = parseFloat(initialScaleWan) * 10000
    const investable = totalYuan * (100 - cashPct) / 100
    const subscribeDate = rebalanceDates[0] ?? new Date().toISOString().slice(0, 10)
    const savedFunds: SavedPortfolioFund[] = funds.map((f) => ({
      beian_hao: f.beian_hao,
      product_name: f.product_name,
      manager: f.manager,
      fund_type: f.fund_type,
      nav_start_date: f.nav_start_date?.slice(0, 10) ?? "",
      initial_subscribe_date: subscribeDate,
      initial_amount: String(Math.round((investable * parseWeightPercent(f.weight)) / 100 * 100) / 100),
      nav_source: f.nav_source,
      rebalance_weight: formatWeightPercent(f.weight),
      latest_nav_date: f.latest_nav_date,
    }))
    savePortfolio({
      id,
      name,
      buildType: "模型构建",
      model: modelLabel,
      rebalanceMethod: "specified-date",
      funds: savedFunds,
      createdAt: new Date().toISOString(),
    })
    setShowSaveDialog(false)
    window.location.href = `/ma/dashboard/private-funds/portfolio/${id}`
  }

  if (step === 2) {
    const constraintValue = (v: string) => (v.trim() ? `${v}%` : "—")

    return (
      <PortfolioSectionShell activeSideItem="port-new">
        <div className="flex flex-col h-full min-h-0">
          <WizardSteps currentStep={2} />
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b bg-muted/20">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <h3 className="text-base font-semibold text-foreground">调仓方案</h3>
                  {planDate && (
                    <span className="text-sm text-muted-foreground tabular-nums">{planDate}</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 mt-3 text-sm">
                  <div><span className="text-muted-foreground">配置模型：</span>{modelDisplayLabel}</div>
                  {isMeanVarianceModel && (
                    <>
                      <div><span className="text-muted-foreground">优化目标：</span>{optimizationGoalLabel(optimizationGoal)}</div>
                      <div><span className="text-muted-foreground">预期收益与风险计算区间：</span>{riskCalcPeriodLabel(riskCalcPeriod)}</div>
                      <div><span className="text-muted-foreground">无风险利率：</span>{riskFreeRate || "0"}%</div>
                      <div><span className="text-muted-foreground">年化收益率下限：</span>{constraintValue(minAnnualReturn)}</div>
                      <div><span className="text-muted-foreground">年化风险上限：</span>{constraintValue(maxAnnualRisk)}</div>
                      <div><span className="text-muted-foreground">最大回撤率上限：</span>{constraintValue(maxDrawdown)}</div>
                    </>
                  )}
                  {isBlackLittermanModel && (
                    <>
                      <div><span className="text-muted-foreground">优化目标：</span>{optimizationGoalLabel(optimizationGoal)}</div>
                      <div><span className="text-muted-foreground">后验收益风险计算区间：</span>{riskCalcPeriodLabel(riskCalcPeriod)}</div>
                      <div><span className="text-muted-foreground">无风险利率：</span>{riskFreeRate || "0"}%</div>
                      <div><span className="text-muted-foreground">年化收益率下限：</span>{constraintValue(minAnnualReturn)}</div>
                      <div><span className="text-muted-foreground">年化风险上限：</span>{constraintValue(maxAnnualRisk)}</div>
                      <div><span className="text-muted-foreground">最大回撤率上限：</span>{constraintValue(maxDrawdown)}</div>
                    </>
                  )}
                  {isRiskParityModel && (
                    <>
                      <div><span className="text-muted-foreground">优化目标：</span>风险贡献相等</div>
                      <div><span className="text-muted-foreground">预期风险计算区间：</span>{riskCalcPeriodLabel(riskCalcPeriod)}</div>
                      <div><span className="text-muted-foreground">无风险利率：</span>{riskFreeRate || "0"}%</div>
                    </>
                  )}
                  {!isOptimizedModel && (
                    <div><span className="text-muted-foreground">现金占比：</span>{cashPct.toFixed(2)}%</div>
                  )}
                </div>
              </div>

              <div className={isOptimizedModel ? "grid grid-cols-1 xl:grid-cols-2 gap-0 xl:divide-x" : ""}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-[720px]">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        {["序号", "产品名称", "产品编号", step2WeightColumn].map((col) => (
                          <th key={col} className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {funds.map((fund, index) => (
                        <tr key={fund.beian_hao} className="border-b">
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">{index + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded text-[10px] border border-blue-200 text-blue-600 bg-blue-50 shrink-0">
                                {fund.fund_type}
                              </span>
                              <span className="text-blue-600 truncate">{fund.product_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">{fund.beian_hao}</td>
                          <td className="px-4 py-3">
                            <WeightBar pct={parseWeightPercent(fund.weight)} />
                          </td>
                        </tr>
                      ))}
                      <tr className="border-b-0 bg-muted/10">
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{funds.length + 1}</td>
                        <td className="px-4 py-3 font-medium text-foreground" colSpan={2}>现金</td>
                        <td className="px-4 py-3">
                          <WeightBar pct={cashPct} />
                        </td>
                      </tr>
                      {isOptimizedModel && (
                        <tr className="border-t bg-muted/20 font-medium">
                          <td className="px-4 py-3" colSpan={3}>合计</td>
                          <td className="px-4 py-3 tabular-nums">100.00%</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {isFrontierModel && optimizedStats && (
                  <div className="p-4 min-h-[360px]">
                    <EfficientFrontierChart
                      frontier={frontier}
                      portfolio={optimizedStats}
                      fundPoints={fundFrontierPoints}
                      periodFrom={periodFrom}
                      periodTo={periodTo}
                    />
                  </div>
                )}

                {isRiskParityModel && riskContributions.length > 0 && (
                  <div className="p-4 min-h-[360px]">
                    <RiskContributionChart
                      items={riskContributions}
                      periodFrom={periodFrom}
                      periodTo={periodTo}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 py-5 border-t bg-background flex-shrink-0">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-8 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              下一步
            </button>
          </div>
        </div>
      </PortfolioSectionShell>
    )
  }

  if (step === 3) {
    return (
      <PortfolioSectionShell activeSideItem="port-new">
        <div className="flex flex-col h-full min-h-0">
          <WizardSteps currentStep={3} />
          <PortfolioBacktestPanel
            key={backtestFunds.map((f) => `${f.beian_hao}:${f.initial_amount}`).join("|")}
            funds={backtestFunds}
          />
          <div className="flex items-center justify-center gap-3 py-5 border-t bg-background flex-shrink-0">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-8 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={handleSavePortfolio}
              className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              保存组合
            </button>
          </div>
          <PortfolioSaveDialog
            open={showSaveDialog}
            onClose={() => setShowSaveDialog(false)}
            onConfirm={handleConfirmSave}
            rebalanceMethod="specified-date"
          />
        </div>
      </PortfolioSectionShell>
    )
  }

  return (
    <PortfolioSectionShell activeSideItem="port-new">
      <div className="flex flex-col h-full min-h-0">
        <WizardSteps currentStep={1} />

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="border rounded-lg p-6 w-full space-y-8">
            <section>
              <SectionTitle>基本信息</SectionTitle>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">
                    <span className="text-red-500 mr-0.5">*</span>
                    初始规模：
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={initialScaleWan}
                    onChange={(e) => {
                      setInitialScaleWan(e.target.value)
                      setScaleTouched(true)
                    }}
                    onBlur={() => setScaleTouched(true)}
                    placeholder="请输入初始规模"
                    className={[
                      "h-9 w-56 px-3 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring",
                      showScaleError ? "border-red-400" : "",
                    ].join(" ")}
                  />
                  <span className="text-sm text-muted-foreground">万</span>
                </div>
                {showScaleError && (
                  <p className="text-xs text-red-500 mt-1.5 ml-[5.5rem]">请输入初始规模</p>
                )}
              </div>
            </section>

            <section>
              <SectionTitle>调仓设置</SectionTitle>
              {!configExpanded ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CalendarDays className="h-12 w-12 text-zinc-300 dark:text-zinc-600 mb-3" strokeWidth={1.25} />
                  <p className="text-sm text-muted-foreground mb-4">请先添加调仓日期</p>
                  <button
                    type="button"
                    onClick={() => setShowAddDateDialog(true)}
                    className="px-5 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    添加调仓日期
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {rebalanceDates.map((date) => (
                    <span
                      key={date}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-background text-sm"
                    >
                      {date}
                      <button
                        type="button"
                        onClick={() => handleRemoveRebalanceDate(date)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`移除 ${date}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowAddDateDialog(true)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    aria-label="添加调仓日期"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </section>

            {configExpanded && (
              <>
                <section>
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <SectionTitle>成分基金</SectionTitle>
                    <div className="flex items-center gap-2 shrink-0 -mt-4">
                      {!isOptimizedModel && (
                        <button
                          type="button"
                          onClick={handleEqualWeight}
                          className="px-4 py-1.5 rounded border border-border text-sm hover:bg-muted transition-colors"
                        >
                          等权重
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowFundPicker(true)}
                        className="px-4 py-1.5 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                      >
                        添加基金
                      </button>
                    </div>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse min-w-[880px]">
                        <thead>
                          <tr className="bg-muted/40 border-b">
                            {(isOptimizedModel ? fundTableColumns : FUND_TABLE_COLUMNS).map((col) => (
                              <th key={col} className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {funds.length === 0 ? (
                            <tr>
                              <td colSpan={(isOptimizedModel ? fundTableColumns : FUND_TABLE_COLUMNS).length} className="py-16 text-center text-muted-foreground">
                                <div className="flex flex-col items-center gap-2">
                                  <Inbox className="h-10 w-10 text-red-400/70" strokeWidth={1.25} />
                                  <span className="text-sm">暂无数据</span>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            funds.map((fund, index) => (
                              <tr key={fund.beian_hao} className="border-b last:border-b-0 hover:bg-muted/20 align-top">
                                <td className="px-3 py-3 tabular-nums text-muted-foreground">{index + 1}</td>
                                <td className="px-3 py-3 min-w-[180px]">
                                  <div className="flex items-start gap-2">
                                    <span className="px-1.5 py-0.5 rounded text-[10px] border border-blue-200 text-blue-600 bg-blue-50 dark:bg-blue-950/20 shrink-0 mt-0.5">
                                      {fund.fund_type}
                                    </span>
                                    <span className="text-blue-600 truncate">{fund.product_name}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-3 tabular-nums text-muted-foreground">{fund.beian_hao}</td>
                                {isOptimizedModel ? (
                                  <>
                                    <td className="px-3 py-3">
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={fund.min_weight}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setFunds((prev) =>
                                            prev.map((row) =>
                                              row.beian_hao === fund.beian_hao ? { ...row, min_weight: value } : row,
                                            ),
                                          )
                                        }}
                                        className="h-8 w-20 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                      />
                                    </td>
                                    <td className="px-3 py-3">
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={fund.max_weight}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setFunds((prev) =>
                                            prev.map((row) =>
                                              row.beian_hao === fund.beian_hao ? { ...row, max_weight: value } : row,
                                            ),
                                          )
                                        }}
                                        className="h-8 w-20 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                      />
                                    </td>
                                    {isBlackLittermanModel && (
                                      <td className="px-3 py-3">
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={fund.expected_return}
                                          onChange={(e) => {
                                            const value = e.target.value
                                            setFunds((prev) =>
                                              prev.map((row) =>
                                                row.beian_hao === fund.beian_hao ? { ...row, expected_return: value } : row,
                                              ),
                                            )
                                          }}
                                          placeholder="—"
                                          className="h-8 w-20 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                        />
                                      </td>
                                    )}
                                  </>
                                ) : (
                                  <td className="px-3 py-3">
                                    <input
                                      type="text"
                                      value={fund.weight}
                                      onChange={(e) => {
                                        const value = e.target.value
                                        setFunds((prev) =>
                                          prev.map((row) =>
                                            row.beian_hao === fund.beian_hao ? { ...row, weight: value } : row,
                                          ),
                                        )
                                      }}
                                      placeholder="—"
                                      className="h-8 w-20 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                    />
                                  </td>
                                )}
                                <td className="px-3 py-3">
                                  <select
                                    value={fund.nav_source}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      setFunds((prev) =>
                                        prev.map((row) =>
                                          row.beian_hao === fund.beian_hao ? { ...row, nav_source: value } : row,
                                        ),
                                      )
                                    }}
                                    className="h-8 w-28 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                  >
                                    <option value="平台净值">平台净值</option>
                                    <option value="团队净值">团队净值</option>
                                  </select>
                                </td>
                                <td className="px-3 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                                  {fund.nav_date_range}
                                </td>
                                <td className="px-3 py-3">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFund(fund.beian_hao)}
                                    className="text-red-500 hover:text-red-600 text-sm"
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section>
                  <SectionTitle>现金占比</SectionTitle>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">
                      <span className="text-red-500 mr-0.5">*</span>
                      现金占比：
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={cashRatio}
                      onChange={(e) => setCashRatio(e.target.value)}
                      className="h-9 w-28 px-3 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </section>

                <section>
                  <SectionTitle>模型选择</SectionTitle>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {MODEL_OPTIONS.map((option) => {
                      const Icon = option.icon
                      const selected = model === option.key
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setModel(option.key)}
                          className={[
                            "relative flex flex-col items-center justify-center gap-2 rounded-lg border px-3 py-4 text-sm transition-colors",
                            selected
                              ? "border-red-500 bg-red-50/60 text-red-600 dark:bg-red-950/20 dark:text-red-400"
                              : "border-border bg-background text-zinc-600 hover:border-red-200 hover:text-red-500 dark:text-zinc-400",
                          ].join(" ")}
                        >
                          {selected && (
                            <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                          <Icon className={["h-5 w-5", selected ? "text-red-500" : "text-zinc-400"].join(" ")} />
                          <span className="text-center leading-snug">{option.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {(isMeanVarianceModel || isBlackLittermanModel) && (
                  <section>
                    <SectionTitle>模型设置</SectionTitle>
                    <div className="space-y-6">
                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">选择优化目标</p>
                        <div className="flex flex-wrap items-center gap-6">
                          {OPTIMIZATION_GOAL_OPTIONS.map((option) => (
                            <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                name="mv-optimization-goal"
                                checked={optimizationGoal === option.key}
                                onChange={() => setOptimizationGoal(option.key)}
                                className="h-4 w-4 accent-red-600"
                              />
                              <span className={optimizationGoal === option.key ? "text-foreground" : "text-muted-foreground"}>
                                {option.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                          {isBlackLittermanModel ? "历史数据与风险计算区间" : "预期收益与风险计算区间"}
                        </p>
                        <div className="flex flex-wrap items-center gap-6">
                          {RISK_CALC_PERIOD_OPTIONS.map((option) => (
                            <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                name="mv-risk-calc-period"
                                checked={riskCalcPeriod === option.key}
                                onChange={() => setRiskCalcPeriod(option.key)}
                                className="h-4 w-4 accent-red-600"
                              />
                              <span className={riskCalcPeriod === option.key ? "text-foreground" : "text-muted-foreground"}>
                                {option.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 max-w-3xl">
                        <ModelPercentField label="无风险利率" value={riskFreeRate} onChange={setRiskFreeRate} placeholder="0" />
                        <ModelPercentField label="年化收益率下限" value={minAnnualReturn} onChange={setMinAnnualReturn} />
                        <ModelPercentField label="年化风险上限" value={maxAnnualRisk} onChange={setMaxAnnualRisk} />
                        <ModelPercentField label="最大回撤率上限" value={maxDrawdown} onChange={setMaxDrawdown} />
                      </div>
                    </div>
                  </section>
                )}

                {isRiskParityModel && (
                  <section>
                    <SectionTitle>模型设置</SectionTitle>
                    <div className="space-y-6">
                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">优化目标</p>
                        <p className="text-sm text-foreground">风险贡献相等</p>
                      </div>

                      <div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">预期风险计算区间</p>
                        <div className="flex flex-wrap items-center gap-6">
                          {RISK_CALC_PERIOD_OPTIONS.map((option) => (
                            <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                name="rp-risk-calc-period"
                                checked={riskCalcPeriod === option.key}
                                onChange={() => setRiskCalcPeriod(option.key)}
                                className="h-4 w-4 accent-red-600"
                              />
                              <span className={riskCalcPeriod === option.key ? "text-foreground" : "text-muted-foreground"}>
                                {option.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="max-w-md">
                        <ModelPercentField label="无风险利率" value={riskFreeRate} onChange={setRiskFreeRate} placeholder="0" />
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        {configExpanded && (
          <div className="flex items-center justify-center gap-3 py-5 border-t bg-background flex-shrink-0">
            <button
              type="button"
              onClick={handleCancel}
              className="px-8 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={optimizing}
              className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {optimizing ? "优化中…" : "下一步"}
            </button>
          </div>
        )}
      </div>

      <AddRebalanceDateDialog
        open={showAddDateDialog}
        onClose={() => setShowAddDateDialog(false)}
        onConfirm={handleAddRebalanceDate}
      />

      <PortfolioFundPickerDialog
        open={showFundPicker}
        onClose={() => setShowFundPicker(false)}
        onConfirm={handleConfirmFunds}
        existingIds={funds.map((f) => f.beian_hao)}
      />
    </PortfolioSectionShell>
  )
}
