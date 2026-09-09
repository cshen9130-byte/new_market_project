"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleCheck, CircleX, HelpCircle, RefreshCw } from "lucide-react"
import {
  DEFAULT_PRODUCT_CATEGORY,
  PRODUCT_CATEGORIES,
  lookthroughConclusion,
  type LookthroughComplianceProduct,
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

export function LookthroughCompliancePanel({
  beianHao,
  productName,
}: {
  beianHao: string
  productName?: string | null
}) {
  const [data, setData] = useState<LookthroughComplianceProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<ProductCategory>(DEFAULT_PRODUCT_CATEGORY)

  useEffect(() => {
    setCategory(readStoredCategory(beianHao))
  }, [beianHao])

  function load() {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch(
      `/ma/api/private-funds/${encodeURIComponent(beianHao)}/valuation/lookthrough-compliance`,
      { cache: "no-store", signal: ac.signal },
    )
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        setData(json as LookthroughComplianceProduct)
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
  }, [beianHao])

  function onCategory(next: ProductCategory) {
    setCategory(next)
    writeStoredCategory(beianHao, next)
  }

  const checks = data?.checks_by_category[category] ?? []
  const conclusion = data ? lookthroughConclusion(data, category) : "na"
  const failed = checks.filter((c) => !c.passed)

  const mixRows = useMemo(() => {
    if (!data) return []
    const invested = data.buckets.invested_assets
    return [
      { key: "equity", value: data.buckets.equity, pct: data.ratios.equity_pct },
      { key: "fixed_income", value: data.buckets.fixed_income, pct: data.ratios.fixed_income_pct },
      { key: "derivatives", value: data.buckets.derivatives_notional, pct: data.ratios.derivatives_notional_pct },
      { key: "fund", value: data.buckets.funds_unpenetrated, pct: invested > 0 ? (data.buckets.funds_unpenetrated / invested) * 100 : null },
      { key: "cash_tool", value: data.buckets.cash_tools, pct: data.net_asset_value > 0 ? (data.buckets.cash_tools / data.net_asset_value) * 100 : null },
      { key: "other", value: data.buckets.other, pct: invested > 0 ? (data.buckets.other / invested) * 100 : null },
    ].filter((row) => row.value > 0)
  }, [data])

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
            <div className="text-sm font-medium text-zinc-800">
              {productName || data.product_name}
              <span className="ml-2 text-xs font-normal text-zinc-400">{beianHao}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              依据《私募证券投资基金运作指引》（2024-08-01）。FOF 持仓按底层最新估值表穿透后核验。
              估值日 {data.valuation_date ?? "—"} · 净资产 {fmtMoney(data.net_asset_value)} · 总资产 {fmtMoney(data.total_asset)}
              {data.is_fof
                ? ` · 穿透 ${data.lookthrough.penetrated_count}/${data.lookthrough.underlying_count}`
                : " · 非 FOF / 无底层基金持仓"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
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
          <span className="text-[11px] text-zinc-400">默认混合类</span>
        </div>
      </div>

      <div className={[
        "rounded-lg border p-4",
        conclusion === "pass"
          ? "border-emerald-200 bg-emerald-50"
          : conclusion === "fail"
            ? "border-red-200 bg-red-50"
            : "border-zinc-200 bg-zinc-50",
      ].join(" ")}>
        <div className="flex items-center gap-2">
          {conclusion === "pass" && <CircleCheck className="h-5 w-5 text-emerald-600" />}
          {conclusion === "fail" && <CircleX className="h-5 w-5 text-red-500" />}
          {(conclusion === "na" || conclusion === "incomplete") && <HelpCircle className="h-5 w-5 text-zinc-400" />}
          <div className="text-sm font-semibold text-zinc-800">
            {conclusion === "pass" && `按「${category}」核验：全部条款合规`}
            {conclusion === "fail" && `按「${category}」核验：${failed.length} 条未达标`}
            {conclusion === "incomplete" && "穿透未完全，无法判断"}
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
          <div className="mb-3 text-sm font-medium text-zinc-800">条款核验明细</div>
          <div className="space-y-2">
            {checks.map((check) => (
              <div key={check.id} className="rounded border border-zinc-100 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {check.passed
                      ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                    <div>
                      <div className="text-xs font-medium text-zinc-800">{check.title}</div>
                      <div className="text-[10px] text-zinc-400">{check.article}</div>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-zinc-500">
                    <div className={check.passed ? "text-emerald-700" : "text-red-600"}>{check.value}</div>
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
            <div className="mb-3 text-sm font-medium text-zinc-800">穿透后资产结构（占已投资产）</div>
            <div className="space-y-2">
              {mixRows.map((row) => (
                <div key={row.key} className="flex items-center gap-3 text-xs">
                  <div className="w-28 shrink-0 text-zinc-500">{BUCKET_LABEL[row.key] ?? row.key}</div>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-100">
                    <div
                      className="h-full rounded bg-red-400"
                      style={{ width: `${Math.min(100, Math.max(0, row.pct ?? 0))}%` }}
                    />
                  </div>
                  <div className="w-28 shrink-0 text-right tabular-nums text-zinc-600">
                    {fmtMoney(row.value)} · {fmtPct(row.pct)}
                  </div>
                </div>
              ))}
              {mixRows.length === 0 && (
                <div className="py-4 text-center text-xs text-zinc-400">无持仓结构</div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div>单一资产集中度 {fmtPct(data.ratios.max_single_asset_pct)}</div>
              <div>单一债券 {fmtPct(data.ratios.max_single_bond_pct)}</div>
              <div>
                杠杆（总资产/净资产） {fmtPct(data.ratios.leverage_pct)}
                {data.ratios.leverage_limit_pct != null ? ` · 上限 ${data.ratios.leverage_limit_pct}%` : ""}
              </div>
              <div>衍生品账户权益 {fmtPct(data.ratios.derivatives_equity_pct)}</div>
            </div>
          </div>

          {data.lookthrough.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              未穿透底层：{data.lookthrough.missing.map((m) => `${m.name}${m.code ? `（${m.code}）` : ""}`).join("、")}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-100 overflow-hidden">
        <div className="border-b border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-800">
          穿透后持仓明细
        </div>
        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">资产</th>
                <th className="px-3 py-2 text-left font-medium">分类</th>
                <th className="px-3 py-2 text-left font-medium">来源底层</th>
                <th className="px-3 py-2 text-right font-medium">市值</th>
                <th className="px-3 py-2 text-right font-medium">占净值</th>
              </tr>
            </thead>
            <tbody>
              {data.top_holdings.map((h, i) => (
                <tr key={`${h.name}-${h.symbol}-${i}`} className="border-t border-zinc-100">
                  <td className="px-3 py-2">
                    <div className="text-zinc-800">{h.name}</div>
                    {h.symbol && <div className="text-[10px] text-zinc-400">{h.symbol}</div>}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{BUCKET_LABEL[h.bucket] ?? h.bucket}</td>
                  <td className="px-3 py-2 text-zinc-400">{h.source_fund ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(h.market_value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.pct_nav)}</td>
                </tr>
              ))}
              {data.top_holdings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-zinc-400">无持仓明细</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
