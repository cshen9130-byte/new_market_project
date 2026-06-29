"use client"

import { useRef, useState, type ReactNode } from "react"
import {
  Briefcase,
  CalendarDays,
  Check,
  Info,
  Inbox,
  Pencil,
  Plus,
  SlidersHorizontal,
  Layers,
  TrendingUp,
  Scale,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
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

const WIZARD_STEPS = ["配置方案", "确定方案", "模拟回测"] as const

const MODEL_OPTIONS = [
  { key: "custom", label: "自定义权重", icon: SlidersHorizontal },
  { key: "equal", label: "等权重", icon: Layers },
  { key: "mean-variance", label: "均值方差", icon: TrendingUp },
  { key: "risk-parity", label: "风险平价", icon: Scale },
  { key: "black-litterman", label: "Black Litterman", icon: Sparkles },
] as const

type ModelKey = (typeof MODEL_OPTIONS)[number]["key"]
type RebalanceMethod = "buy-hold" | "periodic" | "specified-date"
type RebalancePeriod = "1m" | "2m" | "3m" | "6m" | "1y"

const REBALANCE_PERIOD_OPTIONS: { key: RebalancePeriod; label: string }[] = [
  { key: "1m", label: "一个月" },
  { key: "2m", label: "两个月" },
  { key: "3m", label: "三个月" },
  { key: "6m", label: "六个月" },
  { key: "1y", label: "一年" },
]

const FUND_TABLE_COLUMNS_BUY_HOLD = [
  "序号",
  "产品名称",
  "产品编号",
  "管理人",
  "净值开始日期",
  "初始申购日期",
  "初始申购金额(元)",
  "净值来源",
  "操作",
] as const

const FUND_TABLE_COLUMNS_REBALANCE = [
  "序号",
  "产品名称",
  "产品编号",
  "管理人",
  "净值开始日期",
  "初始申购日期",
  "初始申购金额(元)",
  "再平衡权重(剩余:100.00%)",
  "操作",
] as const

const FUND_TABLE_COLUMNS_EQUAL = [
  "序号",
  "产品名称",
  "产品编号",
  "管理人",
  "最新净值",
  "净值日期",
  "权重",
  "净值来源",
  "操作",
] as const

const FUND_TABLE_COLUMNS_MEAN_VARIANCE = [
  "序号",
  "基金名称",
  "产品编号",
  "管理人",
  "最新累积净值",
  "净值开始日期",
  "净值来源",
  "操作",
] as const

const FUND_TABLE_COLUMNS_BLACK_LITTERMAN = [
  "序号",
  "基金名称",
  "产品编号",
  "管理人",
  "最新复权净值",
  "净值开始日期",
  "净值来源",
  "操作",
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

interface PortfolioFundRow extends PortfolioFundPickerItem {
  fund_type: "私募" | "公募"
  nav_start_date: string
  initial_subscribe_date: string
  initial_amount: string
  nav_source: string
  rebalance_weight: string
}

function formatAmountHint(amount: string): string {
  const n = Math.round(parseFloat(amount) * 100) / 100
  if (!Number.isFinite(n) || n <= 0) return ""
  if (n >= 10000) {
    const wan = n / 10000
    const wanText = Number.isInteger(wan) ? String(wan) : wan.toFixed(2).replace(/\.?0+$/, "")
    return `金额${wanText}万元整`
  }
  if (Number.isInteger(n)) return `金额${n}元整`
  return `金额${n.toFixed(2)}元整`
}

function getEqualWeightPercent(fundCount: number, index: number): string {
  if (fundCount <= 0) return "0"
  const base = Math.floor(10000 / fundCount) / 100
  if (index === fundCount - 1) {
    const used = base * (fundCount - 1)
    return (Math.round((100 - used) * 100) / 100).toFixed(2)
  }
  return base.toFixed(2)
}

function formatNavValue(value: string | null | undefined): string {
  if (!value) return "—"
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return value
  return n.toFixed(4)
}

function applyEqualWeightToFunds(
  rows: PortfolioFundRow[],
  portfolioInitialScale: string,
  buyDate: string,
): PortfolioFundRow[] {
  const scale = parseFloat(portfolioInitialScale) || 0
  const n = rows.length
  if (n === 0) return rows
  const perFund = Math.round((scale / n) * 100) / 100
  const lastAmount = Math.round((scale - perFund * (n - 1)) * 100) / 100
  return rows.map((row, index) => ({
    ...row,
    initial_amount: String(index === n - 1 ? lastAmount : perFund),
    initial_subscribe_date: buyDate || row.initial_subscribe_date,
    rebalance_weight: getEqualWeightPercent(n, index),
  }))
}

function applyScaleToFunds(
  rows: PortfolioFundRow[],
  portfolioInitialScale: string,
  buyDate: string,
): PortfolioFundRow[] {
  const scale = parseFloat(portfolioInitialScale) || 0
  const n = rows.length
  if (n === 0) return rows
  const perFund = Math.round((scale / n) * 100) / 100
  const lastAmount = Math.round((scale - perFund * (n - 1)) * 100) / 100
  return rows.map((row, index) => ({
    ...row,
    initial_amount: String(index === n - 1 ? lastAmount : perFund),
    initial_subscribe_date: buyDate || row.initial_subscribe_date,
  }))
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
      <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0 w-32">{label}</label>
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

function createFundRow(item: PortfolioFundPickerItem): PortfolioFundRow {
  return {
    ...item,
    fund_type: "私募",
    nav_start_date: item.nav_start_date ?? "",
    initial_subscribe_date: new Date().toISOString().slice(0, 10),
    initial_amount: "1000000",
    nav_source: "平台净值",
    rebalance_weight: "",
  }
}

async function fetchNavRange(beian_hao: string, product_name: string) {
  const params = new URLSearchParams({ beian_hao, product_name })
  const res = await fetch(`/ma/api/tracking-funds/nav-range?${params.toString()}`)
  if (!res.ok) return null
  return res.json() as Promise<{ nav_start_date: string | null; latest_nav_date: string | null }>
}

function fundRowKey(row: { beian_hao: string; product_name: string }) {
  return `${row.beian_hao}::${row.product_name}`
}

async function enrichFundsNavDates(rows: PortfolioFundRow[]): Promise<PortfolioFundRow[]> {
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
    let subscribe = row.initial_subscribe_date.slice(0, 10)
    if (subscribe && latestNav && subscribe > latestNav) {
      subscribe = navStart
    }
    if (subscribe && navStart && subscribe < navStart) {
      subscribe = navStart
    }
    return {
      ...row,
      nav_start_date: navStart,
      latest_nav_date: latestNav || row.latest_nav_date,
      initial_subscribe_date: subscribe || row.initial_subscribe_date,
    }
  })
}

function rebalanceMethodLabel(method: RebalanceMethod) {
  if (method === "buy-hold") return "买入持有"
  if (method === "periodic") return "定期再平衡"
  return "指定日再平衡"
}

function modelLabel(model: ModelKey) {
  return MODEL_OPTIONS.find((m) => m.key === model)?.label ?? model
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-1 h-4 rounded-full bg-red-500 flex-shrink-0" />
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
    </div>
  )
}

export function WizardSteps({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-0 py-6 border-b bg-background flex-shrink-0">
      {WIZARD_STEPS.map((label, index) => {
        const step = index + 1
        const isActive = step === currentStep
        const isDone = step < currentStep
        return (
          <div key={label} className="flex items-center">
            {index > 0 && (
              <div className={["w-24 h-px mx-2", isDone || isActive ? "bg-red-300" : "bg-border"].join(" ")} />
            )}
            <div className="flex items-center gap-2">
              <div
                className={[
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors",
                  isActive
                    ? "border-red-500 bg-red-500 text-white"
                    : isDone
                      ? "border-red-400 bg-red-50 text-red-500 dark:bg-red-950/30"
                      : "border-zinc-300 bg-background text-zinc-400 dark:border-zinc-600",
                ].join(" ")}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : step}
              </div>
              <span
                className={[
                  "text-sm whitespace-nowrap",
                  isActive ? "text-red-600 dark:text-red-400 font-medium" : isDone ? "text-red-500" : "text-muted-foreground",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PortfolioFreeCreateWizard() {
  const [step, setStep] = useState(1)
  const [model, setModel] = useState<ModelKey>("custom")
  const [rebalanceMethod, setRebalanceMethod] = useState<RebalanceMethod>("buy-hold")
  const [firstRebalanceDate, setFirstRebalanceDate] = useState("")
  const [rebalancePeriod, setRebalancePeriod] = useState<RebalancePeriod>("1m")
  const [rebalanceDates, setRebalanceDates] = useState<string[]>([])
  const [showFundPicker, setShowFundPicker] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [funds, setFunds] = useState<PortfolioFundRow[]>([])
  const [portfolioInitialScale, setPortfolioInitialScale] = useState("1000000")
  const [buyDate, setBuyDate] = useState("")
  const [optimizationGoal, setOptimizationGoal] = useState<OptimizationGoal>("max-return")
  const [riskCalcPeriod, setRiskCalcPeriod] = useState<RiskCalcPeriod>("6m")
  const [riskFreeRate, setRiskFreeRate] = useState("0")
  const [minWeight, setMinWeight] = useState("")
  const [minAnnualReturn, setMinAnnualReturn] = useState("")
  const [maxAnnualRisk, setMaxAnnualRisk] = useState("")
  const [maxDrawdown, setMaxDrawdown] = useState("")
  const addDateInputRef = useRef<HTMLInputElement>(null)

  const isEqualWeightModel = model === "equal"
  const isMeanVarianceModel = model === "mean-variance"
  const isRiskParityModel = model === "risk-parity"
  const isBlackLittermanModel = model === "black-litterman"
  const usesOptimizationSettings = isMeanVarianceModel || isBlackLittermanModel
  const usesScaleModelTable = usesOptimizationSettings || isRiskParityModel
  const usesPortfolioScale = isEqualWeightModel || usesScaleModelTable
  const usesBuyDatePicker = usesPortfolioScale
  const fundTableColumns = isEqualWeightModel
    ? FUND_TABLE_COLUMNS_EQUAL
    : isBlackLittermanModel
      ? FUND_TABLE_COLUMNS_BLACK_LITTERMAN
      : usesScaleModelTable
        ? FUND_TABLE_COLUMNS_MEAN_VARIANCE
        : rebalanceMethod === "periodic" || rebalanceMethod === "specified-date"
          ? FUND_TABLE_COLUMNS_REBALANCE
          : FUND_TABLE_COLUMNS_BUY_HOLD

  function handleSavePortfolio() {
    setShowSaveDialog(true)
  }

  function handleConfirmSave(name: string) {
    const id = createPortfolioId()
    const savedFunds: SavedPortfolioFund[] = funds.map((f) => ({
      beian_hao: f.beian_hao,
      product_name: f.product_name,
      manager: f.manager,
      fund_type: f.fund_type,
      nav_start_date: f.nav_start_date,
      initial_subscribe_date: f.initial_subscribe_date,
      initial_amount: f.initial_amount,
      nav_source: f.nav_source,
      rebalance_weight: f.rebalance_weight,
      ret_ann_since_inception: f.ret_ann_since_inception,
      latest_nav_date: f.latest_nav_date,
    }))
    savePortfolio({
      id,
      name,
      buildType: "自由构建",
      model: modelLabel(model),
      rebalanceMethod,
      funds: savedFunds,
      createdAt: new Date().toISOString(),
    })
    setShowSaveDialog(false)
    window.location.href = `/ma/dashboard/private-funds/portfolio/${id}`
  }

  function handleCancel() {
    if (window.history.length > 1) {
      window.close()
      window.location.href = "/ma/dashboard/private-funds?tab=portfolio&side=port-new"
    } else {
      window.location.href = "/ma/dashboard/private-funds?tab=portfolio&side=port-new"
    }
  }

  function handleNext() {
    if (step === 1) {
      void (async () => {
        if (funds.length === 0) {
          window.alert("请先添加基金")
          return
        }
        let nextFunds = await enrichFundsNavDates(funds)
        if (usesPortfolioScale) {
          const scale = parseFloat(portfolioInitialScale)
          if (!Number.isFinite(scale) || scale <= 0) {
            window.alert("请输入有效的组合初始规模")
            return
          }
          nextFunds = isEqualWeightModel
            ? applyEqualWeightToFunds(nextFunds, portfolioInitialScale, buyDate)
            : applyScaleToFunds(nextFunds, portfolioInitialScale, buyDate)
        } else {
          const invalid = nextFunds.some((f) => !f.initial_subscribe_date || !f.initial_amount)
          if (invalid) {
            window.alert("请完善每只基金的初始申购日期和初始申购金额")
            return
          }
        }
        setFunds(nextFunds)
        setStep(2)
      })()
      return
    }
    if (step === 2) {
      void enrichFundsNavDates(funds).then((nextFunds) => {
        setFunds(nextFunds)
        setStep(3)
      })
      return
    }
    if (step < WIZARD_STEPS.length) setStep((s) => s + 1)
  }

  function handleAddRebalanceDate(date: string) {
    if (!date || rebalanceDates.includes(date)) return
    setRebalanceDates((prev) => [...prev, date].sort())
  }

  function handleRemoveRebalanceDate(date: string) {
    setRebalanceDates((prev) => prev.filter((d) => d !== date))
  }

  function handleConfirmFunds(items: PortfolioFundPickerItem[]) {
    const existing = new Set(funds.map((f) => f.beian_hao))
    const added = items.filter((item) => !existing.has(item.beian_hao)).map(createFundRow)
    if (added.length === 0) return

    setFunds((prev) => [...prev, ...added])

    void enrichFundsNavDates(added).then((enriched) => {
      setFunds((prev) =>
        prev.map((row) => {
          const patch = enriched.find((e) => fundRowKey(e) === fundRowKey(row))
          if (!patch) return row
          return {
            ...row,
            nav_start_date: patch.nav_start_date || row.nav_start_date,
            latest_nav_date: patch.latest_nav_date ?? row.latest_nav_date,
          }
        }),
      )
    })
  }

  function handleRemoveFund(beianHao: string) {
    setFunds((prev) => prev.filter((f) => f.beian_hao !== beianHao))
  }

  const usesRebalanceWeight =
    rebalanceMethod === "periodic" || rebalanceMethod === "specified-date"

  if (step === 2) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <WizardSteps currentStep={2} />
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="border rounded-lg p-5">
            <SectionTitle>方案概览</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">构建模型：</span>{modelLabel(model)}</div>
              <div><span className="text-muted-foreground">再平衡方式：</span>{rebalanceMethodLabel(rebalanceMethod)}</div>
              <div><span className="text-muted-foreground">基金数量：</span>{funds.length} 只</div>
              {usesPortfolioScale ? (
                <>
                  <div>
                    <span className="text-muted-foreground">组合初始规模：</span>
                    {parseFloat(portfolioInitialScale || "0").toLocaleString("zh-CN")} 元
                  </div>
                  {usesOptimizationSettings && (
                    <>
                      <div>
                        <span className="text-muted-foreground">优化目标：</span>
                        {optimizationGoalLabel(optimizationGoal)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">计算区间：</span>
                        {riskCalcPeriodLabel(riskCalcPeriod)}
                      </div>
                    </>
                  )}
                  {isRiskParityModel && (
                    <>
                      <div>
                        <span className="text-muted-foreground">优化目标：</span>
                        风险贡献相等
                      </div>
                      <div>
                        <span className="text-muted-foreground">计算区间：</span>
                        {riskCalcPeriodLabel(riskCalcPeriod)}
                      </div>
                    </>
                  )}
                  {buyDate && (
                    <div><span className="text-muted-foreground">买入日期：</span>{buyDate}</div>
                  )}
                </>
              ) : (
                <div>
                  <span className="text-muted-foreground">初始投资总额：</span>
                  {funds.reduce((sum, f) => sum + (parseFloat(f.initial_amount) || 0), 0).toLocaleString("zh-CN")} 元
                </div>
              )}
            </div>
          </section>

          <section className="border rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/20">
              <h3 className="text-sm font-semibold">基金明细</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[880px]">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    {["序号", "产品名称", "产品编号", ...(isEqualWeightModel ? ["权重", "初始申购金额(元)"] : usesScaleModelTable ? ["初始申购金额(元)"] : ["初始申购日期", "初始申购金额(元)"]), "净值来源"].map((col) => (
                      <th key={col} className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {funds.map((fund, index) => (
                    <tr key={fund.beian_hao} className="border-b last:border-b-0">
                      <td className="px-3 py-2.5 text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded text-[10px] border border-blue-200 text-blue-600 bg-blue-50 shrink-0">{fund.fund_type}</span>
                          <span className="truncate text-blue-600">{fund.product_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fund.beian_hao}</td>
                      {isEqualWeightModel && (
                        <td className="px-3 py-2.5 tabular-nums">{getEqualWeightPercent(funds.length, index)}%</td>
                      )}
                      {!isEqualWeightModel && !usesScaleModelTable && (
                        <td className="px-3 py-2.5 tabular-nums">{fund.initial_subscribe_date}</td>
                      )}
                      <td className="px-3 py-2.5">
                        <div>{parseFloat(fund.initial_amount || "0").toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        {formatAmountHint(fund.initial_amount) && (
                          <div className="text-xs text-muted-foreground mt-0.5">{formatAmountHint(fund.initial_amount)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{fund.nav_source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="flex items-center justify-center gap-3 py-5 border-t bg-background flex-shrink-0">
          <button type="button" onClick={() => setStep(1)} className="px-8 py-2 rounded border border-border text-sm hover:bg-muted transition-colors">
            上一步
          </button>
          <button type="button" onClick={handleNext} className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
            下一步
          </button>
        </div>
      </div>
    )
  }

  if (step === 3) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <WizardSteps currentStep={3} />
        <PortfolioBacktestPanel
          key={funds.map((f) => fundRowKey(f)).join("|")}
          funds={funds.map((f) => ({
            beian_hao: f.beian_hao,
            product_name: f.product_name,
            initial_subscribe_date: f.initial_subscribe_date,
            initial_amount: f.initial_amount,
            nav_start_date: f.nav_start_date,
            latest_nav_date: f.latest_nav_date,
          }))}
        />
        <div className="flex items-center justify-center gap-3 py-5 border-t bg-background flex-shrink-0">
          <button type="button" onClick={() => setStep(2)} className="px-8 py-2 rounded border border-border text-sm hover:bg-muted transition-colors">
            上一步
          </button>
          <button type="button" onClick={handleSavePortfolio} className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
            保存组合
          </button>
        </div>
        <PortfolioSaveDialog
          open={showSaveDialog}
          onClose={() => setShowSaveDialog(false)}
          onConfirm={handleConfirmSave}
          rebalanceMethod={rebalanceMethod}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <WizardSteps currentStep={1} />

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        <section>
          <SectionTitle>模型选择</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {MODEL_OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = model === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setModel(option.key)}
                  className={[
                    "flex flex-col items-center justify-center gap-2 rounded-lg border px-3 py-4 text-sm transition-colors",
                    selected
                      ? "border-red-500 bg-red-50/60 text-red-600 dark:bg-red-950/20 dark:text-red-400"
                      : "border-border bg-background text-zinc-600 hover:border-red-200 hover:text-red-500 dark:text-zinc-400",
                  ].join(" ")}
                >
                  <Icon className={["h-5 w-5", selected ? "text-red-500" : "text-zinc-400"].join(" ")} />
                  <span className="text-center leading-snug">{option.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-red-500 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">基金选择</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowFundPicker(true)}
              className="px-4 py-1.5 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors shrink-0"
            >
              添加基金
            </button>
          </div>

          {usesPortfolioScale && (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">
                {isBlackLittermanModel && <span className="text-red-500 mr-0.5">*</span>}
                组合初始规模 (元)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={portfolioInitialScale}
                onChange={(e) => setPortfolioInitialScale(e.target.value)}
                className="h-9 w-48 px-3 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              {formatAmountHint(portfolioInitialScale) && (
                <span className="text-xs text-muted-foreground">{formatAmountHint(portfolioInitialScale)}</span>
              )}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[960px]">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    {fundTableColumns.map((col) => (
                      <th key={col} className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {funds.length === 0 ? (
                    <tr>
                      <td colSpan={fundTableColumns.length} className="py-16 text-center text-muted-foreground">
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
                        <td className="px-3 py-3 min-w-[200px]">
                          <div className="flex items-start gap-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] border border-blue-200 text-blue-600 bg-blue-50 dark:bg-blue-950/20 shrink-0 mt-0.5">
                              {fund.fund_type}
                            </span>
                            <button type="button" className="text-left text-blue-600 hover:underline truncate" title={fund.product_name}>
                              {fund.product_name}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-muted-foreground">{fund.beian_hao}</td>
                        <td className="px-3 py-3 max-w-[120px]">
                          {fund.manager ? (
                            <button type="button" className="text-blue-600 hover:underline truncate block max-w-full text-left">
                              {fund.manager}
                            </button>
                          ) : "—"}
                        </td>
                        {isEqualWeightModel ? (
                          <>
                            <td className="px-3 py-3 tabular-nums">{formatNavValue(fund.unit_nav)}</td>
                            <td className="px-3 py-3 tabular-nums">{fund.latest_nav_date || "—"}</td>
                            <td className="px-3 py-3 tabular-nums font-medium">
                              {getEqualWeightPercent(funds.length, index)}%
                            </td>
                            <td className="px-3 py-3">
                              <select
                                value={fund.nav_source}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setFunds((prev) =>
                                    prev.map((row) =>
                                      row.beian_hao === fund.beian_hao
                                        ? { ...row, nav_source: value }
                                        : row,
                                    ),
                                  )
                                }}
                                className="h-8 w-28 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                              >
                                <option value="平台净值">平台净值</option>
                                <option value="团队净值">团队净值</option>
                              </select>
                            </td>
                          </>
                        ) : usesScaleModelTable ? (
                          <>
                            <td className="px-3 py-3 tabular-nums">{formatNavValue(fund.unit_nav)}</td>
                            <td className="px-3 py-3 tabular-nums">{fund.nav_start_date || "—"}</td>
                            <td className="px-3 py-3">
                              <select
                                value={fund.nav_source}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setFunds((prev) =>
                                    prev.map((row) =>
                                      row.beian_hao === fund.beian_hao
                                        ? { ...row, nav_source: value }
                                        : row,
                                    ),
                                  )
                                }}
                                className="h-8 w-28 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                              >
                                <option value="平台净值">平台净值</option>
                                <option value="团队净值">团队净值</option>
                              </select>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3 tabular-nums">{fund.nav_start_date || "—"}</td>
                            <td className="px-3 py-3">
                              <div className="relative inline-block">
                                <input
                                  type="date"
                                  value={fund.initial_subscribe_date}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setFunds((prev) =>
                                      prev.map((row) =>
                                        row.beian_hao === fund.beian_hao
                                          ? { ...row, initial_subscribe_date: value }
                                          : row,
                                      ),
                                    )
                                  }}
                                  className="h-8 w-36 pl-2 pr-8 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                />
                                <CalendarDays className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fund.initial_amount}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setFunds((prev) =>
                                    prev.map((row) =>
                                      row.beian_hao === fund.beian_hao
                                        ? { ...row, initial_amount: value }
                                        : row,
                                    ),
                                  )
                                }}
                                placeholder="请输入"
                                className="h-8 w-32 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                              />
                              {formatAmountHint(fund.initial_amount) && (
                                <div className="text-xs text-muted-foreground mt-1">{formatAmountHint(fund.initial_amount)}</div>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {usesRebalanceWeight ? (
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={fund.rebalance_weight}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setFunds((prev) =>
                                      prev.map((row) =>
                                        row.beian_hao === fund.beian_hao
                                          ? { ...row, rebalance_weight: value }
                                          : row,
                                      ),
                                    )
                                  }}
                                  placeholder="权重%"
                                  className="h-8 w-24 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                />
                              ) : (
                                <select
                                  value={fund.nav_source}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setFunds((prev) =>
                                      prev.map((row) =>
                                        row.beian_hao === fund.beian_hao
                                          ? { ...row, nav_source: value }
                                          : row,
                                      ),
                                    )
                                  }}
                                  className="h-8 w-28 px-2 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="平台净值">平台净值</option>
                                  <option value="团队净值">团队净值</option>
                                </select>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <button type="button" className="hover:text-foreground" title="编辑">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className="hover:text-foreground" title="详情">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveFund(fund.beian_hao)}
                              className="hover:text-red-500"
                              title="删除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {usesOptimizationSettings && (
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
                        name="optimization-goal"
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
                  {isBlackLittermanModel ? "预测收益与风险计算区间" : "预期收益与风险计算区间"}
                </p>
                <div className="flex flex-wrap items-center gap-6">
                  {RISK_CALC_PERIOD_OPTIONS.map((option) => (
                    <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="risk-calc-period"
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
                <ModelPercentField label="最小权重" value={minWeight} onChange={setMinWeight} />
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
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">预测风险计算区间</p>
                <div className="flex flex-wrap items-center gap-6">
                  {RISK_CALC_PERIOD_OPTIONS.map((option) => (
                    <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="risk-parity-calc-period"
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

        <section>
          <SectionTitle>再平衡设置</SectionTitle>
          <p className="text-xs text-muted-foreground mb-4">
            提示：买入持有与指定日再平衡不支持自动再平衡
          </p>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">再平衡方式</p>
              <div className="flex flex-wrap items-center gap-6">
                {([
                  { key: "buy-hold", label: "买入持有" },
                  { key: "periodic", label: "定期再平衡" },
                  { key: "specified-date", label: "指定日再平衡" },
                ] as const).map((option) => (
                  <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="rebalance-method"
                      checked={rebalanceMethod === option.key}
                      onChange={() => setRebalanceMethod(option.key)}
                      className="h-4 w-4 accent-red-600"
                    />
                    <span className={rebalanceMethod === option.key ? "text-foreground" : "text-muted-foreground"}>
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {rebalanceMethod === "buy-hold" && (
              usesBuyDatePicker ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">
                    {isBlackLittermanModel && <span className="text-red-500 mr-0.5">*</span>}
                    买入日期
                  </span>
                  <div className="relative">
                    {!buyDate && (
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground z-10">
                        请选择日期
                      </span>
                    )}
                    <input
                      type="date"
                      value={buyDate}
                      onChange={(e) => setBuyDate(e.target.value)}
                      className={[
                        "h-9 w-44 pl-3 pr-9 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring",
                        !buyDate ? "text-transparent" : "",
                      ].join(" ")}
                    />
                    <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  买入日期：以基金列表中初始申购日期为准
                </p>
              )
            )}

            {rebalanceMethod === "periodic" && (
              <div className="space-y-4 pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">首次再平衡日期</span>
                  <div className="relative">
                    <input
                      type="date"
                      value={firstRebalanceDate}
                      onChange={(e) => setFirstRebalanceDate(e.target.value)}
                      className="h-9 w-44 pl-3 pr-9 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                    />
                    <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">再平衡周期</p>
                  <div className="flex flex-wrap items-center gap-6">
                    {REBALANCE_PERIOD_OPTIONS.map((option) => (
                      <label key={option.key} className="inline-flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="rebalance-period"
                          checked={rebalancePeriod === option.key}
                          onChange={() => setRebalancePeriod(option.key)}
                          className="h-4 w-4 accent-red-600"
                        />
                        <span className={rebalancePeriod === option.key ? "text-foreground" : "text-muted-foreground"}>
                          {option.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  再平衡规则：回归初始权重
                </p>
              </div>
            )}

            {rebalanceMethod === "specified-date" && (
              <div className="space-y-4 pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0">再平衡日期</span>
                  <input
                    ref={addDateInputRef}
                    type="date"
                    className="sr-only"
                    onChange={(e) => {
                      handleAddRebalanceDate(e.target.value)
                      e.target.value = ""
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => addDateInputRef.current?.showPicker?.() ?? addDateInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded border border-red-400 text-red-600 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加日期
                  </button>
                  {rebalanceDates.map((date) => (
                    <span
                      key={date}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/40 text-sm"
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
                </div>

                <p className="text-sm text-muted-foreground">
                  再平衡规则：回归初始权重
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

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
          className="px-8 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
        >
          下一步
        </button>
      </div>

      <PortfolioFundPickerDialog
        open={showFundPicker}
        onClose={() => setShowFundPicker(false)}
        onConfirm={handleConfirmFunds}
        existingIds={funds.map((f) => f.beian_hao)}
      />
    </div>
  )
}

export function PortfolioSectionShell({
  children,
  activeSideItem = "port-new",
}: {
  children: ReactNode
  activeSideItem?: string
}) {
  const menuItems = [
    { key: "market", label: "市场", href: "/ma/dashboard/private-funds?tab=market&side=strategy-observation" },
    { key: "funds", label: "基金", href: "/ma/dashboard/private-funds?tab=funds" },
    { key: "portfolio", label: "组合", href: "/ma/dashboard/private-funds?tab=portfolio&side=port-new" },
    { key: "investment", label: "投资", href: "/ma/dashboard/private-funds?tab=investment" },
    { key: "operations", label: "运维", href: "/ma/dashboard/private-funds?tab=operations" },
  ]

  const portfolioSidebarGroups = [
    {
      label: "模拟组合",
      items: [
        { key: "port-new", label: "新建组合", href: "/ma/dashboard/private-funds?tab=portfolio&side=port-new" },
        { key: "port-simulated", label: "模拟组合", href: "/ma/dashboard/private-funds?tab=portfolio&side=port-simulated" },
      ],
    },
    {
      label: "实盘组合",
      items: [
        { key: "port-live", label: "实盘组合", href: "/ma/dashboard/private-funds?tab=portfolio&side=port-live" },
      ],
    },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden -mx-4 md:-mx-6 -mt-0 -mb-6">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={[
                "relative px-4 h-12 inline-flex items-center text-sm font-medium transition-colors",
                item.key === "portfolio"
                  ? "text-red-600 dark:text-red-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500 after:rounded-full"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="flex flex-1 min-h-0">
        <aside className="w-44 border-r bg-background flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-4 border-b">
            <div className="h-7 w-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
              <Briefcase className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-foreground">组合管理</span>
          </div>
          <nav className="flex flex-col pt-3 pb-4">
            {portfolioSidebarGroups.map((group) => {
              const hasActive = group.items.some((i) => i.key === activeSideItem)
              return (
                <div key={group.label}>
                  <div
                    className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <a
                      key={item.key}
                      href={item.href}
                      className={[
                        "block w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors relative",
                        activeSideItem === item.key
                          ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:right-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                          : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                      ].join(" ")}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-background">
          {children}
        </div>
      </div>
    </div>
  )
}
