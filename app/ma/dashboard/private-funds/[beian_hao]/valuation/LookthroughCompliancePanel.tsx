"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { CircleCheck, CircleX, Filter, HelpCircle, Loader2, RefreshCw, Upload } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ChartCalcHelpButton, type ChartCalcHelpBlock } from "./ChartCalcHelpButton"
import {
  DEFAULT_PRODUCT_CATEGORY,
  PRODUCT_CATEGORIES,
  isProductCategory,
  isCheckFailed,
  isCheckUndetermined,
  lookthroughAnomalyCells,
  lookthroughConclusion,
  type LookthroughComplianceProduct,
  type LookthroughSubfundStructure,
  type ProductCategory,
} from "@/lib/ma/lookthrough-compliance-types"

const CATEGORY_STORAGE_PREFIX = "lookthrough_compliance_fund_category_v1:"

const BUCKET_LABEL: Record<string, string> = {
  equity: "权益类资产",
  fixed_income: "债权类资产",
  derivatives: "期货和衍生品",
  cash_tool: "现金管理工具",
  fund: "基金（未穿透）",
  other: "其他",
  margin: "保证金/备付金",
}

function readStoredCategory(beianHao: string): ProductCategory {
  if (typeof window === "undefined") return DEFAULT_PRODUCT_CATEGORY
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_PREFIX + beianHao)
    if (raw && (PRODUCT_CATEGORIES as readonly string[]).includes(raw)) {
      return raw as ProductCategory
    }
  } catch { /* ignore */ }
  return DEFAULT_PRODUCT_CATEGORY
}

function writeStoredCategory(beianHao: string, category: ProductCategory) {
  try {
    localStorage.setItem(CATEGORY_STORAGE_PREFIX + beianHao, category)
  } catch { /* ignore */ }
}

function currentUserName(): string {
  if (typeof window === "undefined") return ""
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name || u?.email || ""
  } catch {
    return ""
  }
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(2)}%`
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`
  }
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—"
  return value.slice(0, 10)
}

const SHEET_LEVEL_LABEL = ["", "一级", "二级", "三级", "四级"] as const

function fmtSheetLevel(level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level)) return "—"
  return SHEET_LEVEL_LABEL[level] ?? `${level}级`
}

function textMatch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return haystack.toLowerCase().includes(q)
}

function numericFilter(raw: string, value: number): boolean {
  const q = raw.trim().replace(/,/g, "")
  if (!q) return true
  const range = q.match(/^(-?\d+(?:\.\d+)?)\s*[-~～到至]\s*(-?\d+(?:\.\d+)?)$/)
  if (range) {
    const lo = Number(range[1])
    const hi = Number(range[2])
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return value >= Math.min(lo, hi) && value <= Math.max(lo, hi)
    }
  }
  const cmp = q.match(/^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/)
  if (cmp) {
    const n = Number(cmp[2])
    if (!Number.isFinite(n)) return true
    if (cmp[1] === ">") return value > n
    if (cmp[1] === "<") return value < n
    if (cmp[1] === ">=") return value >= n
    return value <= n
  }
  const n = Number(q.replace(/%/g, ""))
  if (Number.isFinite(n) && /^-?\d+(?:\.\d+)?%?$/.test(q)) {
    return Math.abs(value - n) < 0.005 || String(value.toFixed(2)).includes(q.replace(/%/g, ""))
  }
  return String(value).includes(q) || value.toFixed(2).includes(q)
}

const HOLDING_FILTER_INPUT =
  "w-full h-7 rounded border bg-white px-1.5 text-[11px] font-normal text-zinc-600 outline-none focus:border-red-300"

function holdingFilterClass(active: boolean, extra = "") {
  return `${HOLDING_FILTER_INPUT} ${active ? "border-red-300" : "border-zinc-200"} ${extra}`.trim()
}

const EMPTY_HOLDING_FILTERS = {
  asset: "",
  bucket: "",
  subjectLevel: "",
  source: "",
  sourceNav: "",
  parentMv: "",
  scale: "",
  subjectMv: "",
  mv: "",
  pct: "",
}

function filterMoneyWan(query: string, value: number | null | undefined): boolean {
  if (!query.trim()) return true
  if (value == null || !Number.isFinite(value)) return false
  return numericFilter(query, value / 10_000) || textMatch(fmtMoney(value), query)
}

function filterPctValue(query: string, value: number | null | undefined): boolean {
  if (!query.trim()) return true
  if (value == null || !Number.isFinite(value)) return false
  return numericFilter(query.replace(/%/g, ""), value) || textMatch(`${value.toFixed(4)}%`, query)
}

const SUBFUND_BUCKETS: {
  key: string
  label: string
  value: (row: LookthroughSubfundStructure) => number
  pct: (row: LookthroughSubfundStructure) => number | null
}[] = [
  { key: "equity", label: "权益类", value: (r) => r.buckets.equity, pct: (r) => r.ratios.equity_pct },
  { key: "fixed_income", label: "债权类", value: (r) => r.buckets.fixed_income, pct: (r) => r.ratios.fixed_income_pct },
  { key: "derivatives", label: "期货和衍生品", value: (r) => r.buckets.derivatives_notional, pct: (r) => r.ratios.derivatives_notional_pct },
  { key: "fund", label: "基金（未穿透）", value: (r) => r.buckets.funds_unpenetrated, pct: (r) => r.ratios.funds_unpenetrated_pct },
  { key: "cash_tool", label: "现金管理工具", value: (r) => r.buckets.cash_tools, pct: (r) => r.ratios.cash_tools_pct },
  { key: "other", label: "其他", value: (r) => r.buckets.other, pct: (r) => r.ratios.other_pct },
]

const CHECKS_HELP: ChartCalcHelpBlock[] = [
  {
    title: "怎么核验",
    paragraphs: [
      "先按母基金估值表识别底层私募基金，再用各底层最新估值表把持仓拆到叶子资产，再按选定产品类别对照《私募证券投资基金运作指引》（2024-08-01）。",
    ],
  },
  {
    title: "第41条 产品类别",
    paragraphs: ["分母一律是「已投资产」，不含现金管理工具。"],
    bullets: [
      "权益类：权益市值 / 已投资产 ≥ 80%",
      "固定收益类：债权市值 / 已投资产 ≥ 80%",
      "期货和衍生品类：合约价值 / 已投资产 ≥ 80%，且账户权益 / 市值已投资产 > 20%",
      "混合类：以上三类都未达标",
    ],
  },
  {
    title: "第12条 单一资产 25%",
    paragraphs: [
      "同一资产必须是四级科目或已给出证券代码/合约代码的叶子。三级科目（股票成本、信用账户、初始合约价值-多头/空头等）未披露单一持仓，不按同一资产计，也不足以判合规。只有已识别单一资产已超过 25%，或三级未披露合计在最坏情形下仍不超过 25% 时，才能给出通过/不通过。",
    ],
    formula: "单一资产集中度 = max(同一资产金额) / 净资产",
  },
  {
    title: "第19条 单一债券 10%",
    paragraphs: [
      "只看「同一债券」，必须是可识别的债券叶子，不是债权类合计，也不是三级「债券成本」科目。国债、央票、政金债、地方债、可转债、可交换债、债券通用质押式回购（如「上交所质押式回购」）不按同一债券计。",
      "底层若只有三级估值表、未披露同一债券，本项为无法判定，不能当成 0%。",
    ],
    formula: "单一债券集中度 = max(同一信用债金额) / 净资产",
  },
  {
    title: "第15条 杠杆",
    formula: "杠杆 = 总资产 / 净资产",
    bullets: [
      "流动性受限资产 + AA 级及以下信用债 ≤ 净资产 20% 时，上限 200%",
      "超过 20% 时上限 120%；私募基金份额计入流动性受限",
    ],
  },
]

const MIX_HELP: ChartCalcHelpBlock[] = [
  {
    title: "已投资产（分母）",
    paragraphs: [
      "第41条用于判断产品类别的口径，不是母基金净资产，也不是 FOF 实盘表里的基金市值合计。",
    ],
    formula: "已投资产 = 权益市值 + 债权市值 + 期货合约价值 + 未穿透基金 + 其他已投\n不含现金管理工具",
  },
  {
    title: "市值 vs 合约价值 vs 保证金",
    bullets: [
      "权益 / 债权 / 未穿透基金 / 其他：估值表市值。同一张表里一级信用账户与三级国投证券等券商科目不重复加总，只留最粗一层账户，再加上能识别的个股叶子",
      "券商存出保证金/结算备付金计入权益类；期货公司保证金/备付金只计入第41条账户权益，不计入合约价值",
      "期货和衍生品按双边名义市值：多头名义 + |空头名义|。三级表用「初始合约」叶子，不用衍生工具父级净额（多空对冲后的估值增值）",
      "冲销合约、估值增值不计入。已投资产因此可以大于母基金市值",
      "第41条衍生品账户权益：只统计期货公司保证金 + 结算备付金",
      "FOF 实盘「市值」= 底层基金份额 × 单位净值，是实际本金，不拆合约",
    ],
  },
  {
    title: "各类怎么归",
    bullets: [
      "权益类：股票、可转债/可交换债、股票/混合/指数/ETF 基金、其他证券、信用账户/股东账户、券商账户，以及券商存出保证金/备付金。信用账户与其下国投证券等科目只计一次",
      "债权类：信用债、质押式回购等；国债/央票/政金债/地方债改记现金管理工具",
      "期货和衍生品：期货/期权/收益互换的双边名义市值（多头 + |空头|），不含保证金、冲销、估值增值",
      "基金（未穿透）：底层私募没有估值表，整段份额按基金计",
      "现金管理工具：活期存款、国债、央票、政金债、地方债、货基；展示但不计入已投资产",
      "保证金/备付金：期货保证金、收益互换履约金等；明细里会列出，但不计入第41条已投资产",
    ],
  },
  {
    title: "图上的百分比",
    formula: "占比 = 该类金额 / 已投资产",
    paragraphs: ["现金管理工具单独列出金额，不参与这根棒的 100% 合计。"],
  },
]

const SUBFUND_HELP: ChartCalcHelpBlock[] = [
  {
    title: "每一行是什么",
    paragraphs: [
      "一只底层基金（或未穿透份额）在母基金里的穿透切片。金额已经按「母基金持有该底层市值 / 该底层净资产」缩放，所以加总应接近上方合计。",
    ],
  },
  {
    title: "各列怎么算",
    bullets: [
      "基金策略：团队策略（空则平台策略），一级/二级/三级",
      "估值日：该底层用于穿透的那张估值表日期",
      "估值表：科目层级。文件名含「三级/四级科目」时用文件名；否则按最细叶子推断（八位科目/初始合约为三级，合约代码为四级）",
      "底层净资产 / 分成比例：该底层估值表净资产，以及母基金持有市值 / 底层净资产",
      "底层期货名义：该底层估值表上的双边名义市值（未按母基金份额缩放）。右侧「期货和衍生品」是 × 分成后的母基金切片",
      "权益/债权/期货/基金/现金/其他：与上方结构同一套分类；期货是缩放后的双边名义市值，不含期货保证金",
      "已投资产：该行权益+债权+期货双边名义+未穿透基金+其他（不含现金管理工具）",
      "占母基金：该行已投资产 / 母基金已投资产",
    ],
    formula: "单元格占比 = 该底层该类金额 / 该底层已投资产",
  },
]

const HOLDINGS_HELP: ChartCalcHelpBlock[] = [
  {
    title: "明细口径",
    paragraphs: [
      "与上方「各底层穿透后资产结构」同一套穿透拆分，列出全部叶子持仓（不再截断为 80 条）。",
    ],
    bullets: [
      "底层基金净资产：该叶子所在底层用于穿透的估值表净资产",
      "母基金持有该基金份额市值：母基金估值表上对该底层的市值",
      "分成比例 = 母基金持有该基金份额市值 / 底层基金净资产",
      "子基金科目市值：底层估值表该叶子的市值（期货为合约价值），未按母基金份额缩放",
      "折算持仓市值 = 子基金科目市值 × 分成比例",
      "占净值：折算持仓市值 / 母基金净资产。上方「占母基金」是该底层已投资产 / 母基金已投资产，分母不同",
      "科目：该叶子在估值表上的科目层级。一级=4位代码，二级=6位，三级=8位/初始合约，四级=合约代码。同一账户的上级合计（如信用账户）与下级券商科目（如国投证券）不重复列出。第12条只用四级或带证券/合约代码的叶子；三级科目不能当成单一资产",
      "来源底层：拆自哪只子基金；空表示母基金直投，分成三列为空",
      "期货按双边名义市值（多头+|空头|）；冲销/估值增值不列出。期货保证金计入账户权益，不计入合约价值",
      "同名「上交所质押式回购」若来源底层不同，是两笔持仓",
      "表底合计：折算持仓市值、占净值为当前筛选结果加总；底层净资产/持有市值/分成/子基金科目市值不可跨行加总",
    ],
  },
]

function MixCell({ value, pct }: { value: number; pct: number | null }) {
  if (!(value > 0)) {
    return <span className="text-zinc-300">—</span>
  }
  return (
    <div className="tabular-nums">
      <div>{fmtMoney(value)}</div>
      <div className="text-[10px] text-zinc-400">{fmtPct(pct)}</div>
    </div>
  )
}

export function LookthroughCompliancePanel({
  beianHao,
  productName,
}: {
  beianHao: string
  productName?: string | null
}) {
  const { toast } = useToast()
  const [data, setData] = useState<LookthroughComplianceProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<ProductCategory>(DEFAULT_PRODUCT_CATEGORY)
  const [savedCategory, setSavedCategory] = useState<ProductCategory>(DEFAULT_PRODUCT_CATEGORY)
  const [uploadingCode, setUploadingCode] = useState<string | null>(null)
  const [holdingFilters, setHoldingFilters] = useState(EMPTY_HOLDING_FILTERS)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<{ code: string; name: string } | null>(null)

  useEffect(() => {
    setCategory(readStoredCategory(beianHao))
    setSavedCategory(DEFAULT_PRODUCT_CATEGORY)
    setHoldingFilters(EMPTY_HOLDING_FILTERS)
  }, [beianHao])

  async function runLoad(signal: AbortSignal, opts?: { silent?: boolean; fresh?: boolean }) {
    if (!opts?.silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const qs = opts?.fresh ? "?fresh=1" : ""
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(beianHao)}/valuation/lookthrough-compliance${qs}`,
        { cache: "no-store", signal },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      const product = json as LookthroughComplianceProduct
      setData(product)
      setError(null)
      if (isProductCategory(product.assigned_category)) {
        setCategory(product.assigned_category)
        setSavedCategory(product.assigned_category)
        writeStoredCategory(beianHao, product.assigned_category)
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      if (!opts?.silent) setError(err instanceof Error ? err.message : "加载失败")
      else {
        toast({
          title: "刷新失败",
          description: err instanceof Error ? err.message : "加载失败",
          variant: "destructive",
        })
      }
    } finally {
      setLoading(false)
    }
  }

  function load(opts?: { silent?: boolean; fresh?: boolean }) {
    const ac = new AbortController()
    void runLoad(ac.signal, opts)
    return () => ac.abort()
  }

  useEffect(() => {
    return load({ fresh: true })
  }, [beianHao])

  function onCategory(next: ProductCategory) {
    setCategory(next)
  }

  function startSubfundUpload(row: LookthroughSubfundStructure) {
    if (row.is_parent_direct || !row.product_code || uploadingCode) return
    uploadTargetRef.current = { code: row.product_code, name: row.name }
    fileInputRef.current?.click()
  }

  async function onSubfundFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    const target = uploadTargetRef.current
    uploadTargetRef.current = null
    if (!file || !target) return
    if (!/\.(xlsx?|pdf)$/i.test(file.name)) {
      toast({ title: "请上传 .xls、.xlsx 或 .pdf 格式的估值表", variant: "destructive" })
      return
    }

    setUploadingCode(target.code)
    try {
      const form = new FormData()
      form.append("beian_hao", target.code)
      form.append("product_name", target.name)
      form.append("files", file)
      const res = await fetch("/ma/api/ops/team-data/valuation/upload", {
        method: "POST",
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "上传失败")
      }
      const saved = typeof json.saved === "number" ? json.saved : 1
      const failed = Array.isArray(json.failed) ? json.failed as string[] : []
      toast({
        title: `已导入 ${target.name} 估值表`,
        description: failed.length > 0
          ? `成功 ${saved} 份，失败：${failed.slice(0, 2).join("；")}`
          : `成功解析 ${saved} 份，正在按新估值表重算穿透。`,
      })
      await runLoad(new AbortController().signal, { silent: true, fresh: true })
    } catch (err) {
      toast({
        title: "上传失败",
        description: err instanceof Error ? err.message : "上传失败",
        variant: "destructive",
      })
    } finally {
      setUploadingCode(null)
    }
  }

  async function saveCategory() {
    if (saving || category === savedCategory) return
    setSaving(true)
    try {
      const res = await fetch("/ma/api/investment/lookthrough-compliance/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beian_hao: beianHao,
          category,
          user_name: currentUserName(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setSavedCategory(category)
      writeStoredCategory(beianHao, category)
      toast({ title: "类别设定已保存" })
    } catch (err) {
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : "保存失败",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const checks = data?.checks_by_category[category] ?? []
  const conclusion = data ? lookthroughConclusion(data, category) : "na"
  const failed = checks.filter(isCheckFailed)
  const undetermined = checks.filter(isCheckUndetermined)
  const anomalies = data ? lookthroughAnomalyCells(data, category) : new Set()

  const mixRows = useMemo(() => {
    if (!data) return []
    const invested = data.buckets.invested_assets
    return [
      { key: "equity", value: data.buckets.equity, pct: data.ratios.equity_pct },
      { key: "fixed_income", value: data.buckets.fixed_income, pct: data.ratios.fixed_income_pct },
      { key: "derivatives", value: data.buckets.derivatives_notional, pct: data.ratios.derivatives_notional_pct },
      { key: "fund", value: data.buckets.funds_unpenetrated, pct: invested > 0 ? (data.buckets.funds_unpenetrated / invested) * 100 : null },
      { key: "other", value: data.buckets.other, pct: invested > 0 ? (data.buckets.other / invested) * 100 : null },
    ].filter((row) => row.value > 0)
  }, [data])

  const marginPosted = useMemo(() => {
    return (data?.top_holdings ?? [])
      .filter((h) => h.bucket === "margin")
      .reduce((s, h) => s + (Number.isFinite(h.market_value) ? h.market_value : 0), 0)
  }, [data])

  const holdingBucketOptions = useMemo(() => {
    const keys = new Set((data?.top_holdings ?? []).map((h) => h.bucket))
    return [...keys].sort((a, b) => (BUCKET_LABEL[a] ?? a).localeCompare(BUCKET_LABEL[b] ?? b, "zh"))
  }, [data])

  const holdingSourceOptions = useMemo(() => {
    const names = new Set<string>()
    for (const h of data?.top_holdings ?? []) names.add(h.source_fund || "—")
    return [...names].sort((a, b) => a.localeCompare(b, "zh"))
  }, [data])

  const filteredHoldings = useMemo(() => {
    const rows = data?.top_holdings ?? []
    return rows.filter((h) => {
      if (!textMatch(`${h.name} ${h.symbol ?? ""}`, holdingFilters.asset)) return false
      if (holdingFilters.bucket && h.bucket !== holdingFilters.bucket) return false
      if (holdingFilters.subjectLevel && String(h.subject_level ?? "") !== holdingFilters.subjectLevel) return false
      const source = h.source_fund || "—"
      if (holdingFilters.source && source !== holdingFilters.source) return false
      if (!filterMoneyWan(holdingFilters.sourceNav, h.source_nav)) return false
      if (!filterMoneyWan(holdingFilters.parentMv, h.parent_holding_mv)) return false
      if (!filterPctValue(holdingFilters.scale, h.lookthrough_scale != null ? h.lookthrough_scale * 100 : null)) return false
      if (!filterMoneyWan(holdingFilters.subjectMv, h.source_subject_mv)) return false
      if (!filterMoneyWan(holdingFilters.mv, h.market_value)) return false
      if (!filterPctValue(holdingFilters.pct, h.pct_nav) && !textMatch(fmtPct(h.pct_nav), holdingFilters.pct)) {
        return false
      }
      return true
    })
  }, [data, holdingFilters])

  const holdingFilterActive = Object.values(holdingFilters).some((v) => v.trim() !== "")

  const holdingTotals = useMemo(() => {
    if (filteredHoldings.length === 0) return null
    let marketValue = 0
    let pctNav = 0
    for (const h of filteredHoldings) {
      if (Number.isFinite(h.market_value)) marketValue += h.market_value
      if (Number.isFinite(h.pct_nav)) pctNav += h.pct_nav
    }
    return { marketValue, pctNav }
  }, [filteredHoldings])

  const subfundRows = data?.subfund_structures ?? []
  const hasSubfundMix = subfundRows.some((row) => !row.is_parent_direct)
  const subfundTotal: LookthroughSubfundStructure | null = data && hasSubfundMix
    ? {
      name: "合计",
      product_code: null,
      is_parent_direct: false,
      unpenetrated: false,
      valuation_date: null,
      valuation_sheet_level: null,
      fund_strategy: null,
      source_nav: null,
      parent_holding_mv: null,
      lookthrough_scale: null,
      source_derivatives_notional: null,
      buckets: {
        equity: data.buckets.equity,
        fixed_income: data.buckets.fixed_income,
        derivatives_notional: data.buckets.derivatives_notional,
        cash_tools: data.buckets.cash_tools,
        funds_unpenetrated: data.buckets.funds_unpenetrated,
        other: data.buckets.other,
        invested_assets: data.buckets.invested_assets,
      },
      ratios: {
        equity_pct: data.ratios.equity_pct,
        fixed_income_pct: data.ratios.fixed_income_pct,
        derivatives_notional_pct: data.ratios.derivatives_notional_pct,
        funds_unpenetrated_pct: data.buckets.invested_assets > 0
          ? (data.buckets.funds_unpenetrated / data.buckets.invested_assets) * 100
          : null,
        cash_tools_pct: data.buckets.invested_assets > 0
          ? (data.buckets.cash_tools / data.buckets.invested_assets) * 100
          : null,
        other_pct: data.buckets.invested_assets > 0
          ? (data.buckets.other / data.buckets.invested_assets) * 100
          : null,
        share_of_parent_invested_pct: 100,
      },
    }
    : null

  if (loading && !data) {
    return (
      <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
        正在按估值表穿透核算合规条款…
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-6 text-sm text-red-600">
        加载失败：{error}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-zinc-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div
              className={[
                "inline-block text-sm font-medium",
                conclusion === "fail" ? "lookthrough-anomaly-cell px-1" : "text-zinc-800",
              ].join(" ")}
            >
              {productName || data.product_name}
              <span className="ml-2 text-xs font-normal opacity-70">{beianHao}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              依据《私募证券投资基金运作指引》（2024-08-01）。FOF 持仓按底层最新估值表穿透后核验。
              估值日 {data.valuation_date ?? "—"} · 净资产 {fmtMoney(data.net_asset_value)} · 总资产 {fmtMoney(data.total_asset)}
              {data.is_fof
                ? ` · 穿透 ${data.lookthrough.penetrated_count}/${data.lookthrough.underlying_count}`
                : " · 非 FOF / 无底层基金持仓"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {category !== savedCategory && (
              <span className="text-[11px] text-amber-600">未保存</span>
            )}
            <button
              type="button"
              onClick={() => void saveCategory()}
              disabled={saving || category === savedCategory}
              className={[
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                category !== savedCategory
                  ? "bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                  : "border border-zinc-200 text-zinc-400",
              ].join(" ")}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "保存中…" : "保存设定"}
            </button>
            <button
              type="button"
              onClick={() => load({ fresh: true })}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">产品类别</span>
          <div className="inline-flex overflow-hidden rounded-md border border-zinc-200">
            {PRODUCT_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onCategory(item)}
                className={[
                  "px-3 py-1.5 text-xs transition-colors",
                  category === item ? "bg-red-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-400">
            {category !== savedCategory ? "点选后立即按该类核算，再保存设定。" : "默认混合类"}
          </span>
        </div>
      </div>

      <div className={[
        "rounded-lg border p-4",
        conclusion === "pass"
          ? "border-emerald-200 bg-emerald-50"
          : conclusion === "fail"
            ? "border-red-200 bg-red-50"
            : conclusion === "incomplete"
              ? "border-amber-200 bg-amber-50"
              : "border-zinc-200 bg-zinc-50",
      ].join(" ")}>
        <div className="flex items-center gap-2">
          {conclusion === "pass" && <CircleCheck className="h-5 w-5 text-emerald-600" />}
          {conclusion === "fail" && <CircleX className="h-5 w-5 text-red-500" />}
          {conclusion === "incomplete" && <HelpCircle className="h-5 w-5 text-amber-500" />}
          {conclusion === "na" && <HelpCircle className="h-5 w-5 text-zinc-400" />}
          <div className="text-sm font-semibold text-zinc-800">
            {conclusion === "pass" && `按「${category}」核验：全部条款合规`}
            {conclusion === "fail" && `按「${category}」核验：${failed.length} 条未达标`}
            {conclusion === "incomplete" && (
              data.lookthrough.missing.length > 0
                ? "穿透未完全，无法判断"
                : undetermined.length > 0
                  ? `底层估值为三级科目，${undetermined.map((c) => c.title).join("、")}无法判断`
                  : "现有估值表无法判断全部条款"
            )}
            {conclusion === "na" && "缺少估值表，无法判断"}
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          穿透后更接近「{data.inferred_type}」。
          {data.lookthrough.missing.length > 0
            ? ` 有 ${data.lookthrough.missing.length} 只底层无估值表，相关份额按未穿透基金计。`
            : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-lg border border-zinc-100 p-4">
          <div className="mb-3 flex items-center gap-1 text-sm font-medium text-zinc-800">
            条款核验明细
            <ChartCalcHelpButton heading="条款核验 · 计算说明" blocks={CHECKS_HELP} />
          </div>
          <div className="space-y-2">
            {checks.map((check) => (
              <div key={check.id} className="rounded border border-zinc-100 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {isCheckUndetermined(check)
                      ? <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      : check.passed
                        ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                    <div>
                      <div className="text-xs font-medium text-zinc-800">{check.title}</div>
                      <div className="text-[10px] text-zinc-400">{check.article}</div>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-zinc-500">
                    <div className={
                      isCheckUndetermined(check)
                        ? "text-amber-700"
                        : check.passed ? "text-emerald-700" : "text-red-600"
                    }>{check.value}</div>
                    <div>标准 {check.threshold}</div>
                  </div>
                </div>
                <p className="mt-1.5 pl-6 text-[11px] leading-5 text-zinc-500">{check.detail}</p>
              </div>
            ))}
            {checks.length === 0 && (
              <div className="py-6 text-center text-xs text-zinc-400">暂无核验结果</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-zinc-100 p-4">
            <div className="mb-3 flex items-center gap-1 text-sm font-medium text-zinc-800">
              穿透后资产结构（占已投资产）
              <ChartCalcHelpButton heading="穿透后资产结构 · 计算说明" blocks={MIX_HELP} />
            </div>
            <p className="mb-2 text-[11px] leading-4 text-zinc-400">
              已投资产 = 期货双边名义市值 + 权益/固收/其他已投，不含现金管理工具。期货保证金不计入合约价值。
            </p>
            <div className="space-y-2">
              {mixRows.map((row) => {
                const anomaly =
                  (row.key === "equity" && anomalies.has("equity"))
                  || (row.key === "fixed_income" && anomalies.has("fixed_income"))
                  || (row.key === "derivatives" && anomalies.has("derivatives"))
                return (
                <div key={row.key} className="flex items-center gap-3 text-xs">
                  <div className="w-28 shrink-0 text-zinc-500">{BUCKET_LABEL[row.key] ?? row.key}</div>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-100">
                    <div
                      className="h-full rounded bg-red-400"
                      style={{ width: `${Math.min(100, Math.max(0, row.pct ?? 0))}%` }}
                    />
                  </div>
                  <div
                    className={[
                      "w-28 shrink-0 text-right tabular-nums",
                      anomaly ? "lookthrough-anomaly-cell px-1.5 py-0.5" : "text-zinc-600",
                    ].join(" ")}
                  >
                    {fmtMoney(row.value)} · {fmtPct(row.pct)}
                  </div>
                </div>
                )
              })}
              {mixRows.length === 0 && (
                <div className="py-4 text-center text-xs text-zinc-400">无持仓结构</div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div className={anomalies.has("single_asset") ? "lookthrough-anomaly-cell px-1.5 py-0.5" : undefined}>
                单一资产集中度 {data.ratios.max_single_asset_undetermined ? "无法判定" : fmtPct(data.ratios.max_single_asset_pct)}
              </div>
              <div>单一债券 {data.ratios.max_single_bond_undetermined ? "无法判定" : fmtPct(data.ratios.max_single_bond_pct)}</div>
              <div className={anomalies.has("leverage") ? "lookthrough-anomaly-cell px-1.5 py-0.5" : undefined}>
                杠杆（总资产/净资产） {fmtPct(data.ratios.leverage_pct)}
                {data.ratios.leverage_limit_pct != null ? ` · 上限 ${data.ratios.leverage_limit_pct}%` : ""}
              </div>
              <div>衍生品账户权益 {fmtPct(data.ratios.derivatives_equity_pct)}</div>
              <div>现金管理工具 {fmtMoney(data.buckets.cash_tools)}（不计入已投资产）</div>
              {marginPosted > 0 && (
                <div>保证金/备付金 {fmtMoney(marginPosted)}（履约金/期货保证金，不计入已投资产）</div>
              )}
            </div>
          </div>

          {data.lookthrough.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              未穿透底层：{data.lookthrough.missing.map((m) => `${m.name}${m.code ? `（${m.code}）` : ""}`).join("、")}
            </div>
          )}
        </div>
      </div>

      {hasSubfundMix && (
        <div className="bg-white rounded-lg border border-zinc-100 overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-1 text-sm font-medium text-zinc-800">
              各底层穿透后资产结构
              <ChartCalcHelpButton heading="各底层穿透后资产结构 · 计算说明" blocks={SUBFUND_HELP} />
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              比例按该底层已投资产计（与上方合计口径一致）；金额为母基金穿透后持仓。可上传该底层更新的估值表后自动重算。
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
              className="hidden"
              onChange={(e) => void onSubfundFileChosen(e)}
            />
          </div>
          <div className="overflow-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 text-left font-medium">底层产品</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">基金策略</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">估值日</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">估值表</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">底层净资产</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">分成比例</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">底层期货名义</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">操作</th>
                  {SUBFUND_BUCKETS.map((col) => (
                    <th key={col.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">{col.label}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">已投资产</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">占母基金</th>
                </tr>
              </thead>
              <tbody>
                {subfundRows.map((row) => (
                  <tr key={row.name} className="border-t border-zinc-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <div className={row.is_parent_direct ? "text-zinc-500" : "text-zinc-800"}>
                        {row.name}
                      </div>
                      {row.unpenetrated && (
                        <div className="text-[10px] text-amber-600">未穿透</div>
                      )}
                      {row.is_parent_direct && (
                        <div className="text-[10px] text-zinc-400">母基金自身持仓</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 max-w-[200px] leading-5">
                      {row.fund_strategy || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap text-zinc-500">
                      {fmtDate(row.valuation_date)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                      {fmtSheetLevel(row.valuation_sheet_level)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-zinc-500">
                      {fmtMoney(row.source_nav)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-zinc-500">
                      {row.lookthrough_scale != null && Number.isFinite(row.lookthrough_scale)
                        ? `${(row.lookthrough_scale * 100).toFixed(4)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-zinc-500">
                      {fmtMoney(row.source_derivatives_notional)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.is_parent_direct ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <button
                          type="button"
                          disabled={!row.product_code || uploadingCode != null}
                          title={row.product_code ? `上传「${row.name}」估值表` : "缺少产品代码，无法绑定估值表"}
                          onClick={() => startSubfundUpload(row)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {uploadingCode && row.product_code && uploadingCode.toUpperCase() === row.product_code.toUpperCase()
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Upload className="h-3 w-3" />}
                          上传
                        </button>
                      )}
                    </td>
                    {SUBFUND_BUCKETS.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-right text-zinc-600">
                        <MixCell value={col.value(row)} pct={col.pct(row)} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                      {fmtMoney(row.buckets.invested_assets)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                      {fmtPct(row.ratios.share_of_parent_invested_pct)}
                    </td>
                  </tr>
                ))}
                {subfundTotal && (
                  <tr className="border-t border-zinc-200 bg-zinc-50">
                    <td className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 font-medium text-zinc-700">合计</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    <td className="px-3 py-2 text-zinc-400">—</td>
                    {SUBFUND_BUCKETS.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-right text-zinc-700">
                        <MixCell value={col.value(subfundTotal)} pct={col.pct(subfundTotal)} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-700">
                      {fmtMoney(subfundTotal.buckets.invested_assets)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-700">
                      {fmtPct(subfundTotal.ratios.share_of_parent_invested_pct)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-100 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-800">
          <span className="inline-flex items-center gap-1">
            穿透后持仓明细
            <ChartCalcHelpButton heading="穿透后持仓明细 · 计算说明" blocks={HOLDINGS_HELP} />
          </span>
          <span className="text-[11px] font-normal text-zinc-400">
            {holdingFilterActive
              ? `显示 ${filteredHoldings.length} / ${data.top_holdings.length} 条`
              : `${data.top_holdings.length} 条`}
          </span>
          {holdingFilterActive && (
            <button
              type="button"
              onClick={() => setHoldingFilters(EMPTY_HOLDING_FILTERS)}
              className="ml-auto text-[11px] font-normal text-zinc-500 hover:text-zinc-800"
            >
              清除筛选
            </button>
          )}
        </div>
        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 pt-2 pb-1 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    资产
                    {holdingFilters.asset.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    分类
                    {holdingFilters.bucket !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    科目
                    {holdingFilters.subjectLevel !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    来源底层
                    {holdingFilters.source !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    底层基金净资产
                    {holdingFilters.sourceNav.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    母基金持有该基金份额市值
                    {holdingFilters.parentMv.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    分成比例
                    {holdingFilters.scale.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    子基金科目市值
                    {holdingFilters.subjectMv.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    折算持仓市值
                    {holdingFilters.mv.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
                <th className="px-3 pt-2 pb-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    占净值
                    {holdingFilters.pct.trim() !== "" && <Filter className="h-3 w-3 text-red-500" />}
                  </span>
                </th>
              </tr>
              <tr>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.asset}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, asset: e.target.value }))}
                    placeholder="名称 / 代码"
                    aria-label="筛选资产"
                    className={holdingFilterClass(holdingFilters.asset.trim() !== "")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <select
                    value={holdingFilters.bucket}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, bucket: e.target.value }))}
                    aria-label="筛选分类"
                    className={holdingFilterClass(holdingFilters.bucket !== "")}
                  >
                    <option value="">全部</option>
                    {holdingBucketOptions.map((key) => (
                      <option key={key} value={key}>{BUCKET_LABEL[key] ?? key}</option>
                    ))}
                  </select>
                </th>
                <th className="px-3 pb-2 font-normal">
                  <select
                    value={holdingFilters.subjectLevel}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, subjectLevel: e.target.value }))}
                    aria-label="筛选科目层级"
                    className={holdingFilterClass(holdingFilters.subjectLevel !== "")}
                  >
                    <option value="">全部</option>
                    <option value="1">一级科目</option>
                    <option value="2">二级科目</option>
                    <option value="3">三级科目</option>
                    <option value="4">四级科目</option>
                  </select>
                </th>
                <th className="px-3 pb-2 font-normal">
                  <select
                    value={holdingFilters.source}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, source: e.target.value }))}
                    aria-label="筛选来源底层"
                    className={holdingFilterClass(holdingFilters.source !== "")}
                  >
                    <option value="">全部</option>
                    {holdingSourceOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.sourceNav}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, sourceNav: e.target.value }))}
                    placeholder="万，如 >1000"
                    title="支持 >1000、>=500、8000-20000"
                    aria-label="筛选底层基金净资产（万）"
                    className={holdingFilterClass(holdingFilters.sourceNav.trim() !== "", "text-right")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.parentMv}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, parentMv: e.target.value }))}
                    placeholder="万，如 >100"
                    title="支持 >100、>=50、100-300"
                    aria-label="筛选母基金持有该基金份额市值（万）"
                    className={holdingFilterClass(holdingFilters.parentMv.trim() !== "", "text-right")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.scale}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, scale: e.target.value }))}
                    placeholder="% ，如 >1"
                    title="支持 >1、>=1.5、1-3"
                    aria-label="筛选分成比例"
                    className={holdingFilterClass(holdingFilters.scale.trim() !== "", "text-right")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.subjectMv}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, subjectMv: e.target.value }))}
                    placeholder="万，如 >10"
                    title="支持 >10、>=5、8-20"
                    aria-label="筛选子基金科目市值（万）"
                    className={holdingFilterClass(holdingFilters.subjectMv.trim() !== "", "text-right")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.mv}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, mv: e.target.value }))}
                    placeholder="万，如 >10"
                    title="支持 >10、>=5、8-20"
                    aria-label="筛选折算持仓市值（万）"
                    className={holdingFilterClass(holdingFilters.mv.trim() !== "", "text-right")}
                  />
                </th>
                <th className="px-3 pb-2 font-normal">
                  <input
                    value={holdingFilters.pct}
                    onChange={(e) => setHoldingFilters((prev) => ({ ...prev, pct: e.target.value }))}
                    placeholder="% ，如 >5"
                    title="支持 >5、>=10、8-20"
                    aria-label="筛选占净值"
                    className={holdingFilterClass(holdingFilters.pct.trim() !== "", "text-right")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.map((h, i) => (
                <tr key={`${h.name}-${h.symbol}-${i}`} className="border-t border-zinc-100">
                  <td className="px-3 py-2">
                    <div className="text-zinc-800">{h.name}</div>
                    {h.symbol && <div className="text-[10px] text-zinc-400">{h.symbol}</div>}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{BUCKET_LABEL[h.bucket] ?? h.bucket}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{fmtSheetLevel(h.subject_level)}</td>
                  <td className="px-3 py-2 text-zinc-400">{h.source_fund ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmtMoney(h.source_nav)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmtMoney(h.parent_holding_mv)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                    {h.lookthrough_scale != null && Number.isFinite(h.lookthrough_scale)
                      ? `${(h.lookthrough_scale * 100).toFixed(4)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmtMoney(h.source_subject_mv)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(h.market_value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.pct_nav)}</td>
                </tr>
              ))}
              {filteredHoldings.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-zinc-400">
                    {data.top_holdings.length === 0 ? "无持仓明细" : "无匹配持仓"}
                  </td>
                </tr>
              )}
            </tbody>
            {holdingTotals && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="border-t border-zinc-200 bg-zinc-50">
                  <td className="bg-zinc-50 px-3 py-2 font-medium text-zinc-700">合计</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-zinc-400">—</td>
                  <td className="bg-zinc-50 px-3 py-2 text-right tabular-nums font-medium text-zinc-700">
                    {fmtMoney(holdingTotals.marketValue)}
                  </td>
                  <td className="bg-zinc-50 px-3 py-2 text-right tabular-nums font-medium text-zinc-700">
                    {fmtPct(holdingTotals.pctNav)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
