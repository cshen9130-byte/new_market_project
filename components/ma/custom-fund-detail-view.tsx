"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronDown, Inbox } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { FundPerformanceIndicatorsPanel } from "@/app/ma/dashboard/private-funds/[beian_hao]/components/FundPerformanceIndicatorsPanel"
import type { BenchmarkPoint } from "@/app/ma/dashboard/private-funds/[beian_hao]/components/shared"

const DETAIL_TABS = [
  { key: "performance", label: "业绩指标" },
  { key: "product", label: "产品表现" },
  { key: "scenario", label: "情景分析" },
  { key: "attribution", label: "净值归因" },
  { key: "materials", label: "相关资料" },
] as const

type DetailTab = (typeof DETAIL_TABS)[number]["key"]

export type CustomFundDetailData = {
  id: string
  product_name: string
  product_code: string
  benchmark_index: string
  scope: "team" | "mine"
  tags: string[]
  created_by: string
  created_at: string
  nav_series: []
}

function userFetchHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

function navigateFunds(tab: string, side?: string) {
  if (tab === "funds") {
    window.location.href = `/ma/dashboard/private-funds?tab=funds&side=${side ?? "custom-funds"}`
    return
  }
  window.location.href = `/ma/dashboard/private-funds?tab=${tab}`
}

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-sm text-muted-foreground">
      <Inbox className="h-10 w-10 opacity-30 mb-2" strokeWidth={1} />
      <span>{label}暂无数据</span>
    </div>
  )
}

export function CustomFundDetailView({ productCode }: { productCode: string }) {
  const [data, setData] = useState<CustomFundDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("performance")
  const [filterNavType, setFilterNavType] = useState("复权净值")
  const [filterNavFreq, setFilterNavFreq] = useState("日频")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (!productCode) return
    setLoading(true)
    setError(null)
    fetch(`/ma/api/custom-funds/detail?code=${encodeURIComponent(productCode)}`, {
      headers: userFetchHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "not_found" : "load_failed")
        return r.json() as Promise<CustomFundDetailData>
      })
      .then((json) => {
        setData(json)
        setDateFrom(json.created_at.slice(0, 10))
      })
      .catch((e) => setError(e.message === "not_found" ? "未找到该自建基金" : "加载失败"))
      .finally(() => setLoading(false))
  }, [productCode])

  const benchmarkLabel = data?.benchmark_index || "业绩基准"
  const emptyBenchmark: BenchmarkPoint[] = useMemo(() => [], [])

  if (loading) {
    return (
      <FundDatabaseShell activeSideItem="custom-funds" onNavigate={navigateFunds}>
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">加载中…</div>
      </FundDatabaseShell>
    )
  }

  if (error || !data) {
    return (
      <FundDatabaseShell activeSideItem="custom-funds" onNavigate={navigateFunds}>
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
          <p>{error ?? "未找到该自建基金"}</p>
          <a href="/ma/dashboard/private-funds?tab=funds&side=custom-funds" className="text-red-600 hover:underline">
            返回自建基金列表
          </a>
        </div>
      </FundDatabaseShell>
    )
  }

  return (
    <FundDatabaseShell activeSideItem="custom-funds" onNavigate={navigateFunds}>
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <a
              href="/ma/dashboard/private-funds?tab=funds&side=custom-funds"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors mb-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回列表
            </a>
            <h1 className="text-xl font-semibold text-zinc-900">{data.product_name}</h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
              <span>基金ID：{data.product_code}</span>
              {data.tags.length > 0 && (
                <>
                  <span className="text-zinc-300">|</span>
                  <span>{data.tags.join("、")}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="@container py-3 mb-4 border-y border-zinc-100">
          <div className="flex flex-nowrap items-start w-full gap-6 text-zinc-500">
            {[
              ["单位净值", "—"],
              ["累计净值", "—"],
              ["成立以来收益", "—"],
              ["今年以来收益", "—"],
              ["成立以来年化", "—"],
              ["成立以来最大回撤", "—"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <div className="text-lg font-bold tabular-nums text-zinc-400">{value}</div>
                <div className="text-xs mt-0.5 whitespace-nowrap">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-white px-4 py-3 mb-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-600">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">统计区间</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border rounded px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              <span>至</span>
              <input
                type="date"
                value={dateTo}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDateTo(e.target.value)}
                className="border rounded px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">净值类型</span>
              <div className="relative">
                <select
                  value={filterNavType}
                  onChange={(e) => setFilterNavType(e.target.value)}
                  className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["单位净值", "累计净值", "复权净值"].map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">净值频率</span>
              <div className="relative">
                <select
                  value={filterNavFreq}
                  onChange={(e) => setFilterNavFreq(e.target.value)}
                  className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["日频", "周频", "月频"].map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">业绩基准</span>
              <span className="font-medium text-zinc-700">{benchmarkLabel}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="px-3 py-1 rounded border text-xs hover:bg-muted transition-colors">重置</button>
              <button type="button" className="px-3 py-1 rounded bg-red-500 text-white text-xs hover:bg-red-600 transition-colors">开始分析</button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b mb-4">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setDetailTab(tab.key)}
              className={[
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                detailTab === tab.key
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {detailTab === "performance" && (
          <FundPerformanceIndicatorsPanel
            productName={data.product_name}
            rows={[]}
            navType={filterNavType}
            benchmarkSeries={emptyBenchmark}
            benchmarkLabel={benchmarkLabel}
            hasBenchmark={false}
            dateFrom={dateFrom || data.created_at.slice(0, 10)}
            dateTo={dateTo}
            navTableTitle="基金净值"
          />
        )}
        {detailTab === "product" && <PlaceholderPanel label="产品表现" />}
        {detailTab === "scenario" && <PlaceholderPanel label="情景分析" />}
        {detailTab === "attribution" && <PlaceholderPanel label="净值归因" />}
        {detailTab === "materials" && <PlaceholderPanel label="相关资料" />}
      </div>
    </FundDatabaseShell>
  )
}

function customFundDetailHref(productCode: string): string {
  return `/ma/dashboard/private-funds/${encodeURIComponent(productCode)}`
}

export { customFundDetailHref }
