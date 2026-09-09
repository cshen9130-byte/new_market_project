"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, CircleCheck, CircleX, HelpCircle, Loader2, RefreshCw } from "lucide-react"
import { CopyableProductName } from "@/components/ma/copyable-inline-text"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_PRODUCT_CATEGORY,
  PRODUCT_CATEGORIES,
  isProductCategory,
  lookthroughAnomalyCells,
  lookthroughConclusion,
  type LookthroughAnomalyCell,
  type LookthroughComplianceProduct,
  type LookthroughComplianceResult,
  type LookthroughConclusion,
  type ProductCategory,
  type ComplianceCheck,
} from "@/lib/ma/lookthrough-compliance-types"

const CATEGORY_STORAGE_KEY = "lookthrough_compliance_categories_v1"

const BUCKET_LABEL: Record<string, string> = {
  equity: "权益",
  fixed_income: "固收",
  derivatives: "衍生品",
  cash_tool: "现金工具",
  fund: "基金(未穿透)",
  other: "其他",
  margin: "保证金",
}

function readCategoryMap(): Record<string, ProductCategory> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    const out: Record<string, ProductCategory> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if ((PRODUCT_CATEGORIES as readonly string[]).includes(value)) {
        out[key] = value as ProductCategory
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeCategoryMap(map: Record<string, ProductCategory>) {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota */
  }
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
  if (value == null || !Number.isFinite(value) || value === 0) return "—"
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`
  }
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
}

export function LookthroughComplianceView() {
  const { toast } = useToast()
  const [data, setData] = useState<LookthroughComplianceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [defaultCategory, setDefaultCategory] = useState<ProductCategory>(DEFAULT_PRODUCT_CATEGORY)
  const [categoryMap, setCategoryMap] = useState<Record<string, ProductCategory>>({})
  const [savedMap, setSavedMap] = useState<Record<string, ProductCategory>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<"all" | "pass" | "fail" | "incomplete" | "na">("all")
  const [keyword, setKeyword] = useState("")
  const hydratedRef = useRef(false)

  function load() {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch("/ma/api/investment/lookthrough-compliance", { cache: "no-store", signal: ac.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        setData(json as LookthroughComplianceResult)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }

  useEffect(() => {
    return load()
  }, [])

  useEffect(() => {
    if (!data) return
    const local = readCategoryMap()
    const nextSaved: Record<string, ProductCategory> = {}
    const nextDraft: Record<string, ProductCategory> = {}
    for (const product of data.products) {
      const key = String(product.id)
      if (isProductCategory(product.assigned_category)) nextSaved[key] = product.assigned_category
      nextDraft[key] = nextSaved[key] ?? local[key] ?? DEFAULT_PRODUCT_CATEGORY
    }
    setSavedMap(nextSaved)
    if (!hydratedRef.current) {
      setCategoryMap(nextDraft)
      const first = nextDraft[String(data.products[0]?.id)]
      if (first && data.products.every((product) => nextDraft[String(product.id)] === first)) {
        setDefaultCategory(first)
      }
      hydratedRef.current = true
    }
  }, [data])

  function categoryOf(productId: number): ProductCategory {
    return categoryMap[String(productId)] ?? savedMap[String(productId)] ?? defaultCategory
  }

  function savedCategoryOf(productId: number): ProductCategory {
    return savedMap[String(productId)] ?? DEFAULT_PRODUCT_CATEGORY
  }

  function setProductCategory(productId: number, category: ProductCategory) {
    if (!isProductCategory(category)) return
    setCategoryMap((prev) => ({ ...prev, [String(productId)]: category }))
  }

  function applyCategoryToAll(category: ProductCategory) {
    setDefaultCategory(category)
    if (!data) {
      setCategoryMap({})
      return
    }
    const next: Record<string, ProductCategory> = {}
    for (const product of data.products) next[String(product.id)] = category
    setCategoryMap(next)
  }

  async function saveCategories() {
    if (!data || saving) return
    setSaving(true)
    setError(null)
    try {
      const items = data.products.map((product) => ({
        product_id: product.id,
        beian_hao: product.beian_hao,
        category: categoryOf(product.id),
      }))
      const res = await fetch("/ma/api/investment/lookthrough-compliance/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, user_name: currentUserName() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      const nextSaved: Record<string, ProductCategory> = {}
      for (const item of items) nextSaved[String(item.product_id)] = item.category
      setSavedMap(nextSaved)
      writeCategoryMap(nextSaved)
      toast({ title: "类别设定已保存", description: `已写入 ${json.saved ?? items.length} 只产品` })
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败"
      setError(message)
      toast({ title: "保存失败", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const q = keyword.trim().toLowerCase()
    return data.products.filter((product) => {
      if (q) {
        const blob = `${product.product_name} ${product.beian_hao ?? ""}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      const conclusion = lookthroughConclusion(product, categoryOf(product.id))
      if (statusFilter === "pass") return conclusion === "pass"
      if (statusFilter === "fail") return conclusion === "fail"
      if (statusFilter === "incomplete") return conclusion === "incomplete"
      if (statusFilter === "na") return conclusion === "na"
      return true
    })
  }, [data, keyword, statusFilter, categoryMap, savedMap, defaultCategory])

  const summary = useMemo(() => {
    const products = data?.products ?? []
    let pass = 0
    let fail = 0
    let incomplete = 0
    let na = 0
    for (const product of products) {
      const conclusion = lookthroughConclusion(product, categoryOf(product.id))
      if (conclusion === "pass") pass += 1
      else if (conclusion === "fail") fail += 1
      else if (conclusion === "incomplete") incomplete += 1
      else na += 1
    }
    return { total: products.length, pass, fail, incomplete, na }
  }, [data, categoryMap, savedMap, defaultCategory])

  const dirtyCount = useMemo(() => {
    if (!data) return 0
    return data.products.filter((product) => categoryOf(product.id) !== savedCategoryOf(product.id)).length
  }, [data, categoryMap, savedMap, defaultCategory])

  const uniformCategory = useMemo(() => {
    if (!data?.products.length) return defaultCategory
    const first = categoryOf(data.products[0].id)
    return data.products.every((product) => categoryOf(product.id) === first) ? first : null
  }, [data, categoryMap, savedMap, defaultCategory])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background -m-5">
      <div className="border-b px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-foreground">穿透合规</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
              依据中基协《私募证券投资基金运作指引》（2024-08-01）：按选定产品类别核验第41条资产比例，
              以及第12条单一资产 25%、第19条单一债券 10%、第15条总资产杠杆 200%（流动性受限资产与 AA 级及以下信用债合计超过净资产 20% 时为 120%）。
              FOF 持仓按底层产品最新估值表穿透后计算。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirtyCount > 0 && (
              <span className="text-[11px] text-amber-600">已改 {dirtyCount} 只，尚未保存</span>
            )}
            <button
              type="button"
              onClick={() => void saveCategories()}
              disabled={saving || dirtyCount === 0}
              className={[
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                dirtyCount > 0
                  ? "bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                  : "border border-zinc-200 text-zinc-400",
              ].join(" ")}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "保存中…" : "保存设定"}
            </button>
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">产品类别</span>
          <div className="inline-flex rounded-md border border-zinc-200 overflow-hidden">
            {PRODUCT_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => applyCategoryToAll(category)}
                className={[
                  "px-3 py-1.5 text-xs transition-colors",
                  uniformCategory === category
                    ? "bg-red-500 text-white"
                    : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                {category}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-400">点选后立即按该类核算；改完后点「保存设定」写入系统。</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SummaryChip label="全部" value={summary.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <SummaryChip label="合规" value={summary.pass} tone="pass" active={statusFilter === "pass"} onClick={() => setStatusFilter("pass")} />
          <SummaryChip label="不合规" value={summary.fail} tone="fail" active={statusFilter === "fail"} onClick={() => setStatusFilter("fail")} />
          <SummaryChip label="无法判断" value={summary.incomplete} tone="incomplete" active={statusFilter === "incomplete"} onClick={() => setStatusFilter("incomplete")} />
          <SummaryChip label="缺数据" value={summary.na} tone="na" active={statusFilter === "na"} onClick={() => setStatusFilter("na")} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索产品 / 备案号"
            className="ml-2 h-7 w-52 rounded border border-zinc-200 px-2 text-xs outline-none focus:border-red-400"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}
        {loading && !data && (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-400">正在按估值表穿透核算…</div>
        )}
        {data && rows.length === 0 && !loading && (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-400">没有符合筛选的产品</div>
        )}
        {data && rows.length > 0 && (
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-[11px] text-zinc-500">
              <tr className="border-b">
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 text-left font-medium">产品</th>
                <th className="px-3 py-2 text-left font-medium">设定类别</th>
                <th className="px-3 py-2 text-left font-medium">结论</th>
                <th className="px-3 py-2 text-left font-medium">穿透</th>
                <th className="px-3 py-2 text-right font-medium">权益%</th>
                <th className="px-3 py-2 text-right font-medium">固收%</th>
                <th className="px-3 py-2 text-right font-medium">衍生品%</th>
                <th className="px-3 py-2 text-right font-medium">单一资产</th>
                <th className="px-3 py-2 text-right font-medium">杠杆</th>
                <th className="px-3 py-2 text-left font-medium">估值日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const category = categoryOf(product.id)
                const conclusion = lookthroughConclusion(product, category)
                const open = expanded.has(product.id)
                return (
                  <ProductBlock
                    key={product.id}
                    product={product}
                    category={category}
                    conclusion={conclusion}
                    dirty={category !== savedCategoryOf(product.id)}
                    open={open}
                    onToggle={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(product.id)) next.delete(product.id)
                        else next.add(product.id)
                        return next
                      })
                    }}
                    onCategory={(next) => setProductCategory(product.id, next)}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: "pass" | "fail" | "na" | "incomplete"
  active: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === "pass"
      ? "text-emerald-700"
      : tone === "fail"
        ? "text-red-600"
        : tone === "incomplete"
          ? "text-amber-600"
          : tone === "na"
            ? "text-zinc-500"
            : "text-zinc-700"
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1",
        active ? "border-red-400 bg-red-50" : "border-zinc-200 bg-white hover:bg-zinc-50",
      ].join(" ")}
    >
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium ${toneClass}`}>{value}</span>
    </button>
  )
}

function StatusBadge({
  conclusion,
  category,
  failed,
}: {
  conclusion: LookthroughConclusion
  category: ProductCategory
  failed?: ComplianceCheck[]
}) {
  if (conclusion === "na") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
        <HelpCircle className="h-3.5 w-3.5" />
        缺估值表
      </span>
    )
  }
  if (conclusion === "incomplete") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
          <HelpCircle className="h-3.5 w-3.5" />
          无法判断
        </span>
        <span className="text-[10px] text-zinc-400">按「{category}」核验</span>
      </span>
    )
  }
  if (conclusion === "pass") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
          <CircleCheck className="h-3.5 w-3.5" />
          合规
        </span>
        <span className="text-[10px] text-zinc-400">按「{category}」核验</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <CircleX className="h-3.5 w-3.5" />
        不合规
      </span>
      <span className="text-[10px] text-zinc-400">按「{category}」核验</span>
      {failed?.[0] && (
        <span className="text-[10px] text-red-500">{failed[0].title} {failed[0].value}</span>
      )}
    </span>
  )
}

const ANOMALY_REASON: Record<LookthroughAnomalyCell, (category: ProductCategory, leverageLimit?: number | null) => string> = {
  equity: (category) =>
    category === "权益类" ? "未达到权益类已投资产 80% 下限" : "超过混合类权益 80% 上限",
  fixed_income: (category) =>
    category === "固定收益类" ? "未达到固定收益类已投资产 80% 下限" : "超过混合类固收 80% 上限",
  derivatives: (category) =>
    category === "期货和衍生品类" ? "未达到衍生品合约价值 80% 下限" : "超过混合类衍生品 80% 上限",
  single_asset: () => "超过单一资产 25% 上限",
  leverage: (_category, leverageLimit) =>
    `超过总资产杠杆 ${leverageLimit != null ? `${leverageLimit.toFixed(0)}%` : "200%"} 上限`,
}

function anomalyReason(
  cell: LookthroughAnomalyCell,
  category: ProductCategory,
  leverageLimit?: number | null,
): string {
  return ANOMALY_REASON[cell](category, leverageLimit)
}

function RatioCell({
  value,
  anomaly,
  reason,
}: {
  value: number | null | undefined
  anomaly: boolean
  reason: string
}) {
  return (
    <td
      className={[
        "px-3 py-2 text-right tabular-nums",
        anomaly ? "lookthrough-anomaly-cell" : "",
      ].join(" ")}
      title={anomaly ? reason : undefined}
    >
      {fmtPct(value)}
    </td>
  )
}

function ProductBlock({
  product,
  category,
  conclusion,
  dirty,
  open,
  onToggle,
  onCategory,
}: {
  product: LookthroughComplianceProduct
  category: ProductCategory
  conclusion: LookthroughConclusion
  dirty: boolean
  open: boolean
  onToggle: () => void
  onCategory: (category: ProductCategory) => void
}) {
  const checks = product.checks_by_category[category] ?? []
  const anomalies = lookthroughAnomalyCells(product, category)
  return (
    <>
      <tr className="border-b border-zinc-100 hover:bg-zinc-50/80">
        <td className="px-2 py-2">
          <button type="button" onClick={onToggle} className="text-zinc-400 hover:text-zinc-700">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-col">
            {product.beian_hao ? (
              <CopyableProductName
                beian_hao={product.beian_hao}
                product_name={product.product_name}
                href={`/ma/dashboard/private-funds/${encodeURIComponent(product.beian_hao)}/valuation?tab=${encodeURIComponent("穿透合规")}`}
                className={[
                  "text-sm font-medium hover:underline",
                  conclusion === "fail" ? "lookthrough-anomaly-cell px-1" : "text-blue-600",
                ].join(" ")}
              />
            ) : (
              <span
                className={[
                  "text-sm font-medium",
                  conclusion === "fail" ? "lookthrough-anomaly-cell px-1" : "text-foreground",
                ].join(" ")}
              >
                {product.product_name}
              </span>
            )}
            <span className="text-[11px] text-zinc-400">
              {product.beian_hao || "—"}
              {product.inferred_type !== "无法判定" ? ` · 穿透后更接近${product.inferred_type}` : ""}
            </span>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <select
              value={category}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                if (isProductCategory(e.target.value)) onCategory(e.target.value)
              }}
              className={[
                "h-7 rounded bg-white px-1.5 text-xs outline-none",
                dirty ? "border border-amber-400 focus:border-amber-500" : "border border-zinc-200 focus:border-red-400",
              ].join(" ")}
            >
              {PRODUCT_CATEGORIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            {dirty && <span className="text-[10px] text-amber-600">未保存</span>}
          </div>
        </td>
        <td className="px-3 py-2">
          <StatusBadge
            conclusion={conclusion}
            category={category}
            failed={checks.filter((c) => !c.passed)}
          />
        </td>
        <td className="px-3 py-2 text-xs text-zinc-600">
          {!product.is_fof
            ? "直投/非FOF"
            : product.lookthrough.complete
              ? `已穿透 ${product.lookthrough.penetrated_count}/${product.lookthrough.underlying_count}`
              : `未完全 ${product.lookthrough.penetrated_count}/${product.lookthrough.underlying_count}`}
        </td>
        <RatioCell
          value={product.ratios.equity_pct}
          anomaly={anomalies.has("equity")}
          reason={anomalyReason("equity", category)}
        />
        <RatioCell
          value={product.ratios.fixed_income_pct}
          anomaly={anomalies.has("fixed_income")}
          reason={anomalyReason("fixed_income", category)}
        />
        <RatioCell
          value={product.ratios.derivatives_notional_pct}
          anomaly={anomalies.has("derivatives")}
          reason={anomalyReason("derivatives", category)}
        />
        <RatioCell
          value={product.ratios.max_single_asset_pct}
          anomaly={anomalies.has("single_asset")}
          reason={anomalyReason("single_asset", category)}
        />
        <RatioCell
          value={product.ratios.leverage_pct}
          anomaly={anomalies.has("leverage")}
          reason={anomalyReason("leverage", category, product.ratios.leverage_limit_pct)}
        />
        <td className="px-3 py-2 text-xs text-zinc-500">{product.valuation_date ?? "—"}</td>
      </tr>
      {open && (
        <tr className="border-b border-zinc-200 bg-zinc-50/50">
          <td colSpan={11} className="px-6 py-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-zinc-600">规则核验（{category}）</div>
                <div className="space-y-2">
                  {checks.map((check) => (
                    <div key={check.id} className="rounded border border-zinc-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {check.passed
                            ? <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
                            : <CircleX className="h-3.5 w-3.5 text-red-500" />}
                          <span className="text-xs font-medium text-foreground">{check.title}</span>
                          <span className="text-[10px] text-zinc-400">{check.article}</span>
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {check.value}
                          <span className="mx-1 text-zinc-300">/</span>
                          {check.threshold}
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">{check.detail}</p>
                    </div>
                  ))}
                </div>
                {product.lookthrough.missing.length > 0 && (
                  <div className="mt-3 text-[11px] text-amber-700">
                    未穿透底层：{product.lookthrough.missing.map((m) => `${m.name}${m.code ? `(${m.code})` : ""}`).join("、")}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-zinc-600">
                  穿透后持仓（净资产 {fmtMoney(product.net_asset_value)}）
                </div>
                <div className="max-h-72 overflow-auto rounded border border-zinc-200 bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">资产</th>
                        <th className="px-2 py-1.5 text-left font-medium">分类</th>
                        <th className="px-2 py-1.5 text-right font-medium">市值</th>
                        <th className="px-2 py-1.5 text-right font-medium">占净值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.top_holdings.slice(0, 20).map((h, i) => (
                        <tr key={`${h.name}-${h.symbol}-${i}`} className="border-t border-zinc-100">
                          <td className="px-2 py-1.5">
                            <div>{h.name}</div>
                            {(h.symbol || h.source_fund) && (
                              <div className="text-[10px] text-zinc-400">
                                {[h.symbol, h.source_fund ? `来自 ${h.source_fund}` : null].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-zinc-500">{BUCKET_LABEL[h.bucket] ?? h.bucket}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(h.market_value)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtPct(h.pct_nav)}</td>
                        </tr>
                      ))}
                      {product.top_holdings.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-2 py-6 text-center text-zinc-400">无持仓明细</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
