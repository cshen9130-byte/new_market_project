"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Eye,
  GitBranch,
  HelpCircle,
  LayoutTemplate,
} from "lucide-react"
import type {
  InvestmentAssetAllocationResult,
  InvestmentOverviewGroupRow,
  InvestmentOverviewProduct,
} from "@/lib/server/investment-overview-query"
import type {
  InvestmentUnderlyingStatsResult,
} from "@/lib/server/investment-underlying-stats-query"

const RED = "#D93025"
const BLUE = "#1A73E8"
const ORANGE = "#FBBC04"

/** Donut chart — each segment gets a distinct color (no duplicate blues). */
const DONUT_GROUP_COLORS: Record<string, string> = {
  组合策略: BLUE,
  股票多头: RED,
  期货策略: ORANGE,
  股票对冲: "#9333ea",
  套利策略: "#22c55e",
  多资产策略: "#14b8a6",
  债券策略: "#8B5CF6",
  期权策略: "#EC4899",
  其他: "#78716C",
  策略未配置: "#6B7280",
  标签未配置: "#6B7280",
  底层未配置: "#D93025",
  管理人未配置: "#6B7280",
}

const DONUT_PALETTE = [RED, ORANGE, "#9333ea", "#22c55e", "#14b8a6", "#EC4899", "#78716C", "#6B7280"]

const TREND_LINE_COLORS: Record<string, string> = {
  总规模: RED,
  组合策略: BLUE,
  策略未配置: ORANGE,
  股票多头: RED,
  期货策略: ORANGE,
}

function trendXAxisLabel(dateStr: string, index: number, dates: string[]): string {
  const d = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  const prev = index > 0 ? new Date(`${dates[index - 1]}T12:00:00`) : null
  const monthChanged = !prev || d.getMonth() !== prev.getMonth() || d.getFullYear() !== prev.getFullYear()
  if (!monthChanged) return ""
  // January → year label; other months → N月
  if (d.getMonth() === 0) return String(d.getFullYear())
  return `${d.getMonth() + 1}月`
}

function pctXAxisLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${mm}-${dd}`
}

function trendLineColor(group: string, index: number): string {
  return TREND_LINE_COLORS[group] ?? colorForGroup(group, index, TREND_LINE_COLORS)
}

function donutColorForGroup(name: string, index: number): string {
  return DONUT_GROUP_COLORS[name] ?? DONUT_PALETTE[index % DONUT_PALETTE.length]
}

function colorForGroup(name: string, index: number, map: Record<string, string>): string {
  return map[name] ?? DONUT_GROUP_COLORS[name] ?? DONUT_PALETTE[index % DONUT_PALETTE.length]
}

type SortKey = "group_name" | "product_count" | "net_asset_value" | "pct"
type UnderlyingSortKey = "group_name" | "product_count" | "market_value" | "pct"
type DetailSortKey = "valuation_date" | "net_asset_value"
type UnderlyingDetailSortKey = "product_name" | "market_value"

function formatStrategyPath(
  l1: string | null | undefined,
  l2: string | null | undefined,
  l3?: string | null | undefined,
): string {
  const parts = [l1, l2, l3].map((v) => (v ?? "").trim()).filter(Boolean)
  return parts.length > 0 ? parts.join("/") : "—"
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join("、") : "—"
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultRange(): { start: string; end: string } {
  const end = new Date()
  const start = addMonths(end, -6)
  return { start: fmtIsoDate(start), end: fmtIsoDate(end) }
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

function fmtWanYuan(v: number): string {
  return (v / 10000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
  return dir === "asc"
    ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
}

function levelLabel(level: 1 | 2 | 3): string {
  return level === 3 ? "三级" : level === 2 ? "二级" : "一级"
}

function groupColumnLabel(
  groupBy: "strategy" | "tag",
  strategySource: "company" | "platform",
  strategyLevel: 1 | 2 | 3,
): string {
  if (groupBy === "tag") return "团队标签"
  if (strategySource === "platform") {
    return strategyLevel === 1 ? "平台策略" : `平台${levelLabel(strategyLevel)}策略`
  }
  return strategyLevel === 1 ? "团队名称" : `团队${levelLabel(strategyLevel)}策略`
}

function underlyingGroupColumnLabel(
  groupBy: "strategy" | "manager",
  strategySource: "company" | "platform",
  strategyLevel: 1 | 2 | 3,
): string {
  if (groupBy === "manager") return "管理人"
  if (strategySource === "platform") {
    return strategyLevel === 1 ? "平台策略" : `平台${levelLabel(strategyLevel)}策略`
  }
  return strategyLevel === 1 ? "团队策略" : `团队${levelLabel(strategyLevel)}策略`
}

export function InvestmentOverviewView() {
  const defaults = defaultRange()
  const [draftStart, setDraftStart] = useState(defaults.start)
  const [draftEnd, setDraftEnd] = useState(defaults.end)
  const [queryStart, setQueryStart] = useState(defaults.start)
  const [queryEnd, setQueryEnd] = useState(defaults.end)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allProducts, setAllProducts] = useState<InvestmentOverviewProduct[]>([])
  const [data, setData] = useState<InvestmentAssetAllocationResult | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [seriesLoading, setSeriesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showProductMenu, setShowProductMenu] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("net_asset_value")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [seriesSelectAll, setSeriesSelectAll] = useState(true)
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set())
  const [groupBy, setGroupBy] = useState<"strategy" | "tag">("strategy")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("company")
  const [strategyLevel, setStrategyLevel] = useState<1 | 2 | 3>(1)
  const [showDetails, setShowDetails] = useState(false)
  const [detailStrategySource, setDetailStrategySource] = useState<"company" | "platform">("company")
  const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>("valuation_date")
  const [detailSortDir, setDetailSortDir] = useState<"asc" | "desc">("desc")
  const [underlyingData, setUnderlyingData] = useState<InvestmentUnderlyingStatsResult | null>(null)
  const [underlyingLoading, setUnderlyingLoading] = useState(true)
  const [underlyingError, setUnderlyingError] = useState<string | null>(null)
  const [underlyingGroupBy, setUnderlyingGroupBy] = useState<"strategy" | "manager">("strategy")
  const [underlyingStrategySource, setUnderlyingStrategySource] = useState<"company" | "platform">("company")
  const [underlyingStrategyLevel, setUnderlyingStrategyLevel] = useState<1 | 2 | 3>(1)
  const [underlyingSortKey, setUnderlyingSortKey] = useState<UnderlyingSortKey>("market_value")
  const [underlyingSortDir, setUnderlyingSortDir] = useState<"asc" | "desc">("desc")
  const [showUnderlyingDetails, setShowUnderlyingDetails] = useState(false)
  const [underlyingDetailStrategySource, setUnderlyingDetailStrategySource] = useState<"company" | "platform">("company")
  const [underlyingDetailSortKey, setUnderlyingDetailSortKey] = useState<UnderlyingDetailSortKey>("market_value")
  const [underlyingDetailSortDir, setUnderlyingDetailSortDir] = useState<"asc" | "desc">("desc")
  const productMenuRef = useRef<HTMLDivElement>(null)
  const fetchGenRef = useRef(0)
  const underlyingFetchGenRef = useRef(0)
  const selectedIdsRef = useRef(selectedIds)
  const allProductsLenRef = useRef(allProducts.length)
  const productsInitializedRef = useRef(false)
  const [selectionRevision, setSelectionRevision] = useState(0)
  selectedIdsRef.current = selectedIds
  allProductsLenRef.current = allProducts.length

  const loadData = useCallback(async (
    start: string,
    end: string,
    ids: Set<string>,
    productCount: number,
    opts: { groupBy: "strategy" | "tag"; strategySource: "company" | "platform"; strategyLevel: 1 | 2 | 3 },
  ) => {
    const fetchGen = ++fetchGenRef.current
    setSummaryLoading(true)
    setSeriesLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        start,
        end,
        group_by: opts.groupBy,
        strategy_source: opts.strategySource,
        strategy_level: String(opts.strategyLevel),
        include_series: "1",
      })
      if (ids.size > 0 && productCount > 0 && ids.size < productCount) {
        ids.forEach((id) => params.append("product_id", id))
      }
      const res = await fetch(`/ma/api/investment/overview/asset-allocation?${params}`, { cache: "no-store" })
      const json = await res.json()
      if (fetchGen !== fetchGenRef.current) return
      if (!res.ok) throw new Error(json.error || "加载失败")
      const payload = json as InvestmentAssetAllocationResult
      setData(payload)
      if (Array.isArray(payload.products) && !productsInitializedRef.current) {
        productsInitializedRef.current = true
        setAllProducts(payload.products)
        setSelectedIds(new Set(payload.products.map((p) => p.id)))
      }
      if (Array.isArray(payload.summary)) {
        setVisibleGroups(new Set(payload.summary.map((r) => r.group_name)))
        setSeriesSelectAll(true)
      }
    } catch (e) {
      if (fetchGen !== fetchGenRef.current) return
      setError(e instanceof Error ? e.message : "加载失败")
      setData(null)
    } finally {
      if (fetchGen === fetchGenRef.current) {
        setSummaryLoading(false)
        setSeriesLoading(false)
      }
    }
  }, [])

  const loadUnderlyingData = useCallback(async (
    ids: Set<string>,
    productCount: number,
    opts: {
      groupBy: "strategy" | "manager"
      strategySource: "company" | "platform"
      strategyLevel: 1 | 2 | 3
    },
  ) => {
    const fetchGen = ++underlyingFetchGenRef.current
    setUnderlyingLoading(true)
    setUnderlyingError(null)
    try {
      const params = new URLSearchParams({
        group_by: opts.groupBy,
        strategy_source: opts.strategySource,
        strategy_level: String(opts.strategyLevel),
      })
      if (ids.size > 0 && productCount > 0 && ids.size < productCount) {
        ids.forEach((id) => params.append("product_id", id))
      }
      const res = await fetch(`/ma/api/investment/overview/underlying-stats?${params}`, { cache: "no-store" })
      const json = await res.json()
      if (fetchGen !== underlyingFetchGenRef.current) return
      if (!res.ok) throw new Error(json.error || "加载失败")
      setUnderlyingData(json as InvestmentUnderlyingStatsResult)
    } catch (e) {
      if (fetchGen !== underlyingFetchGenRef.current) return
      setUnderlyingError(e instanceof Error ? e.message : "加载失败")
      setUnderlyingData(null)
    } finally {
      if (fetchGen === underlyingFetchGenRef.current) setUnderlyingLoading(false)
    }
  }, [])

  useEffect(() => {
    const opts = { groupBy, strategySource, strategyLevel }
    const underlyingOpts = {
      groupBy: underlyingGroupBy,
      strategySource: underlyingStrategySource,
      strategyLevel: underlyingStrategyLevel,
    }
    const ids = selectedIdsRef.current
    const productCount = allProductsLenRef.current

    void loadData(queryStart, queryEnd, ids, productCount, opts)
    void loadUnderlyingData(ids, productCount, underlyingOpts)

    return () => {
      fetchGenRef.current += 1
      underlyingFetchGenRef.current += 1
    }
  }, [
    queryStart,
    queryEnd,
    groupBy,
    strategySource,
    strategyLevel,
    selectionRevision,
    underlyingGroupBy,
    underlyingStrategySource,
    underlyingStrategyLevel,
    loadData,
    loadUnderlyingData,
  ])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (productMenuRef.current && !productMenuRef.current.contains(e.target as Node)) {
        setShowProductMenu(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  function handleQuery() {
    setQueryStart(draftStart)
    setQueryEnd(draftEnd)
  }

  function handleReset() {
    const range = defaultRange()
    setDraftStart(range.start)
    setDraftEnd(range.end)
    setQueryStart(range.start)
    setQueryEnd(range.end)
    setSelectedIds(new Set(allProducts.map((p) => p.id)))
    setSelectionRevision((v) => v + 1)
  }

  function toggleProduct(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelectionRevision((v) => v + 1)
  }

  function toggleAllProducts(checked: boolean) {
    if (checked) setSelectedIds(new Set(allProducts.map((p) => p.id)))
    else setSelectedIds(new Set())
    setSelectionRevision((v) => v + 1)
  }

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
  }

  const selectedCount = selectedIds.size > 0
    ? selectedIds.size
    : (allProducts.length || data?.products.length || 0)

  const groupLabel = groupColumnLabel(groupBy, strategySource, strategyLevel)
  const chartKey = `${groupBy}-${strategySource}-${strategyLevel}-${data?.as_of_date ?? ""}`
  const underlyingGroupLabel = underlyingGroupColumnLabel(
    underlyingGroupBy,
    underlyingStrategySource,
    underlyingStrategyLevel,
  )
  const underlyingChartKey = `${underlyingGroupBy}-${underlyingStrategySource}-${underlyingStrategyLevel}-${underlyingData?.as_of_date ?? ""}`

  function openUnderlyingDetails() {
    setUnderlyingDetailStrategySource(underlyingStrategySource)
    setUnderlyingDetailSortKey("market_value")
    setUnderlyingDetailSortDir("desc")
    setShowUnderlyingDetails(true)
  }

  function handleUnderlyingSort(col: UnderlyingSortKey) {
    if (underlyingSortKey === col) setUnderlyingSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setUnderlyingSortKey(col); setUnderlyingSortDir("desc") }
  }

  function handleUnderlyingDetailSort(col: UnderlyingDetailSortKey) {
    if (underlyingDetailSortKey === col) setUnderlyingDetailSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setUnderlyingDetailSortKey(col); setUnderlyingDetailSortDir("desc") }
  }

  function openDetails() {
    setDetailStrategySource(strategySource)
    setDetailSortKey("valuation_date")
    setDetailSortDir("desc")
    setShowDetails(true)
  }

  function handleDetailSort(col: DetailSortKey) {
    if (detailSortKey === col) setDetailSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setDetailSortKey(col); setDetailSortDir("desc") }
  }

  const detailRows = useMemo(() => {
    if (!data?.products) return []
    const rows = data.products.filter((p) => p.net_asset_value != null && p.net_asset_value > 0)
    rows.sort((a, b) => {
      if (detailSortKey === "valuation_date") {
        const av = a.valuation_date ?? ""
        const bv = b.valuation_date ?? ""
        return detailSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const av = a.net_asset_value ?? 0
      const bv = b.net_asset_value ?? 0
      return detailSortDir === "asc" ? av - bv : bv - av
    })
    return rows
  }, [data?.products, detailSortKey, detailSortDir])

  const detailTotalNav = useMemo(
    () => detailRows.reduce((sum, p) => sum + (p.net_asset_value ?? 0), 0),
    [detailRows],
  )

  function handleDetailExport() {
    if (!data) return
    const escape = (v: string | number) => {
      const s = String(v)
      return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ["序号", "基金名称", "策略", "标签", "估值表日期", "资产净值"]
    const csvRows = detailRows.map((p, i) => {
      const strategy = detailStrategySource === "platform"
        ? formatStrategyPath(p.platform_strategy_l1, p.platform_strategy_l2, p.platform_strategy_l3)
        : formatStrategyPath(p.company_strategy_l1, p.company_strategy_l2, p.company_strategy_l3)
      return [
        i + 1,
        p.short_name || p.product_name,
        strategy,
        formatTags(p.team_tags),
        p.valuation_date ?? "—",
        p.net_asset_value ?? "",
      ]
    })
    csvRows.push(["", "合计", "", "", "", detailTotalNav.toFixed(2)])
    const csv = ["\uFEFF" + headers.join(","), ...csvRows.map((r) => r.map(escape).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    a.download = `规模统计明细_${data.as_of_date}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const sortedSummary = useMemo(() => {
    if (!data?.summary) return []
    const rows = [...data.summary]
    rows.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv, "zh-CN") : bv.localeCompare(av, "zh-CN")
      }
      const an = Number(av)
      const bn = Number(bv)
      return sortDir === "asc" ? an - bn : bn - an
    })
    return rows
  }, [data?.summary, sortKey, sortDir])

  const sortedUnderlyingSummary = useMemo(() => {
    if (!underlyingData?.summary) return []
    const rows = [...underlyingData.summary]
    rows.sort((a, b) => {
      const av = a[underlyingSortKey]
      const bv = b[underlyingSortKey]
      if (typeof av === "string" && typeof bv === "string") {
        return underlyingSortDir === "asc" ? av.localeCompare(bv, "zh-CN") : bv.localeCompare(av, "zh-CN")
      }
      const an = Number(av)
      const bn = Number(bv)
      return underlyingSortDir === "asc" ? an - bn : bn - an
    })
    return rows
  }, [underlyingData?.summary, underlyingSortKey, underlyingSortDir])

  const underlyingDetailRows = useMemo(() => {
    if (!underlyingData?.products) return []
    const rows = underlyingData.products.filter((p) => p.market_value != null && p.market_value > 0)
    rows.sort((a, b) => {
      if (underlyingDetailSortKey === "product_name") {
        const av = a.product_name
        const bv = b.product_name
        return underlyingDetailSortDir === "asc" ? av.localeCompare(bv, "zh-CN") : bv.localeCompare(av, "zh-CN")
      }
      const av = a.market_value ?? 0
      const bv = b.market_value ?? 0
      return underlyingDetailSortDir === "asc" ? av - bv : bv - av
    })
    return rows
  }, [underlyingData?.products, underlyingDetailSortKey, underlyingDetailSortDir])

  const underlyingDetailTotalMv = useMemo(
    () => underlyingDetailRows.reduce((sum, p) => sum + (p.market_value ?? 0), 0),
    [underlyingDetailRows],
  )

  function handleUnderlyingExport() {
    if (!underlyingData) return
    const escape = (v: string | number) => {
      const s = String(v)
      return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ["序号", underlyingGroupLabel, "产品数量", "投资市值", "投资市值占比"]
    const csvRows = sortedUnderlyingSummary.map((row, i) => [
      i + 1,
      row.group_name,
      row.product_count,
      row.market_value,
      `${row.pct.toFixed(2)}%`,
    ])
    if (underlyingData.total) {
      csvRows.push([
        "",
        underlyingData.total.group_name,
        underlyingData.total.product_count,
        underlyingData.total.market_value,
        `${underlyingData.total.pct.toFixed(2)}%`,
      ])
    }
    const csv = ["\uFEFF" + headers.join(","), ...csvRows.map((r) => r.map(escape).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    a.download = `底层统计_${underlyingData.as_of_date}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function handleUnderlyingDetailExport() {
    if (!underlyingData) return
    const escape = (v: string | number) => {
      const s = String(v)
      return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ["序号", "底层基金", "备案编码", "策略", "管理人", "估值表日期", "投资市值"]
    const csvRows = underlyingDetailRows.map((p, i) => {
      const strategy = underlyingDetailStrategySource === "platform"
        ? formatStrategyPath(p.platform_strategy_l1, p.platform_strategy_l2, p.platform_strategy_l3)
        : formatStrategyPath(p.company_strategy_l1, p.company_strategy_l2, p.company_strategy_l3)
      return [
        i + 1,
        p.product_name,
        p.beian_hao ?? "—",
        strategy,
        p.manager_name ?? "—",
        p.valuation_date ?? "—",
        p.market_value ?? "",
      ]
    })
    csvRows.push(["", "合计", "", "", "", "", underlyingDetailTotalMv.toFixed(2)])
    const csv = ["\uFEFF" + headers.join(","), ...csvRows.map((r) => r.map(escape).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    a.download = `底层统计明细_${underlyingData.as_of_date}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const groupNames = useMemo(
    () => data?.summary.map((r) => r.group_name) ?? [],
    [data?.summary],
  )

  const donutOption = useMemo(() => {
    if (!data?.summary.length) return {}
    return {
      color: data.summary.map((r, i) => donutColorForGroup(r.group_name, i)),
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>${fmtMoney(p.value)} (${p.percent.toFixed(2)}%)`,
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "#666" },
        data: data.summary.map((r) => r.group_name),
      },
      series: [{
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: (p: { name: string; percent: number }) => `${p.name}: ${p.percent.toFixed(2)}%`,
          fontSize: 12,
        },
        labelLine: { length: 12, length2: 8 },
        data: data.summary.map((r, i) => ({
          name: r.group_name,
          value: r.net_asset_value,
          itemStyle: { color: donutColorForGroup(r.group_name, i) },
        })),
      }],
    }
  }, [data?.summary])

  const underlyingDonutOption = useMemo(() => {
    if (!underlyingData?.summary.length) return {}
    return {
      color: underlyingData.summary.map((r, i) => donutColorForGroup(r.group_name, i)),
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>${fmtMoney(p.value)} (${p.percent.toFixed(2)}%)`,
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "#666" },
        data: underlyingData.summary.map((r) => r.group_name),
      },
      series: [{
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: (p: { name: string; percent: number }) => `${p.name}: ${p.percent.toFixed(2)}%`,
          fontSize: 12,
        },
        labelLine: { length: 12, length2: 8 },
        data: underlyingData.summary.map((r, i) => ({
          name: r.group_name,
          value: r.market_value,
          itemStyle: { color: donutColorForGroup(r.group_name, i) },
        })),
      }],
    }
  }, [underlyingData?.summary])

  const trendOption = useMemo(() => {
    if (!data?.series.length) return {}
    const activeGroups = seriesSelectAll
      ? groupNames
      : groupNames.filter((g) => visibleGroups.has(g))
    const dates = data.series.map((p) => p.date)

    const groupLines = activeGroups.map((group, i) => {
      const color = trendLineColor(group, i)
      return {
        name: group,
        type: "line" as const,
        symbol: "none",
        smooth: false,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        emphasis: { focus: "series" as const },
        data: data.series.map((p) => p.groups[group] ?? 0),
      }
    })

    const totalLine = {
      name: "总规模",
      type: "line" as const,
      symbol: "none",
      smooth: false,
      lineStyle: { color: RED, width: 2 },
      itemStyle: { color: RED },
      data: data.series.map((p) => p.total),
      z: 10,
    }

    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => `${fmtMoney(v)} 元`,
      },
      legend: {
        data: [...activeGroups, "总规模"],
        top: 0,
        textStyle: { fontSize: 12 },
      },
      grid: { left: 72, right: 24, top: 40, bottom: 48 },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#666",
          interval: 0,
          formatter: (value: string, index: number) => trendXAxisLabel(value, index, dates),
        },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: "value",
        name: "规模(万元)",
        nameTextStyle: { fontSize: 11, color: "#666" },
        axisLabel: {
          fontSize: 11,
          formatter: (v: number) => fmtWanYuan(v),
        },
        splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
      },
      series: [...groupLines, totalLine],
    }
  }, [data?.series, groupNames, seriesSelectAll, visibleGroups])

  const pctStackOption = useMemo(() => {
    if (!data?.series.length) return {}
    const activeGroups = seriesSelectAll
      ? groupNames
      : groupNames.filter((g) => visibleGroups.has(g))
    const dates = data.series.map((p) => p.date)

    const groupAreas = activeGroups.map((group, i) => {
      const color = trendLineColor(group, i)
      return {
        name: group,
        type: "line" as const,
        stack: "pct",
        symbol: "none",
        smooth: false,
        lineStyle: { color, width: 0 },
        areaStyle: { color, opacity: 1 },
        itemStyle: { color },
        emphasis: { focus: "series" as const },
        data: data.series.map((p) => {
          const total = p.total > 0
            ? p.total
            : Object.values(p.groups).reduce((sum, v) => sum + v, 0)
          if (total <= 0) return 0
          return ((p.groups[group] ?? 0) / total) * 100
        }),
      }
    })

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      legend: {
        data: activeGroups,
        top: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12 },
      },
      grid: { left: 56, right: 24, top: 40, bottom: 48 },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#666",
          formatter: (value: string) => pctXAxisLabel(value),
        },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: "value",
        name: "占比",
        min: 0,
        max: 100,
        nameTextStyle: { fontSize: 11, color: "#666" },
        axisLabel: {
          fontSize: 11,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { type: "dashed", color: "#eee" } },
      },
      series: groupAreas,
    }
  }, [data?.series, groupNames, seriesSelectAll, visibleGroups])

  function handleExport() {
    if (!data) return
    const escape = (v: string | number) => {
      const s = String(v)
      return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ["序号", groupLabel, "产品数量", "资产净值", "资产净值占比"]
    const rows = [
      ...sortedSummary.map((r, i) => [
        i + 1, r.group_name, r.product_count, r.net_asset_value, `${r.pct.toFixed(2)}%`,
      ]),
      ["", data.total.group_name, data.total.product_count, data.total.net_asset_value, `${data.total.pct.toFixed(2)}%`],
    ]
    const csv = ["\uFEFF" + headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    a.download = `资产配置_${data.as_of_date}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col gap-4 min-w-0 text-xs">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 bg-background border rounded-xl px-4 py-3 shadow-sm">
        <div className="relative" ref={productMenuRef}>
          <button
            type="button"
            onClick={() => setShowProductMenu((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-border bg-background text-zinc-600 dark:text-zinc-300 hover:border-red-300"
          >
            已选中{selectedCount}只产品
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          </button>
          {showProductMenu && (
            <div className="absolute left-0 top-full mt-1 z-50 w-72 max-h-72 overflow-y-auto rounded-lg border bg-background shadow-lg p-2">
              <label className="flex items-center gap-2 px-2 py-1.5 border-b mb-1 cursor-pointer hover:bg-muted/50 rounded">
                <input
                  type="checkbox"
                  checked={selectedIds.size === allProducts.length && allProducts.length > 0}
                  onChange={(e) => toggleAllProducts(e.target.checked)}
                />
                <span className="font-medium">全选</span>
              </label>
              {allProducts.map((p) => (
                <label key={p.id} className="flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50 rounded">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleProduct(p.id)}
                    className="mt-0.5"
                  />
                  <span className="leading-snug">{p.short_name || p.product_name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-zinc-500">
          <input
            type="date"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-zinc-600 dark:text-zinc-300"
          />
          <span>至</span>
          <input
            type="date"
            value={draftEnd}
            onChange={(e) => setDraftEnd(e.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-zinc-600 dark:text-zinc-300"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleReset}
            className="h-8 px-4 rounded border border-border bg-background text-zinc-600 hover:bg-muted/50"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleQuery}
            className="h-8 px-4 rounded bg-red-500 text-white hover:bg-red-600"
          >
            查询
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-600 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {summaryLoading && !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 bg-background border rounded-xl shadow-sm p-4 h-[340px] animate-pulse bg-muted/20" />
          <div className="lg:col-span-2 bg-background border rounded-xl shadow-sm h-[340px] animate-pulse bg-muted/20" />
        </div>
      ) : (
        <>
          {/* Donut + table */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 bg-background border rounded-xl shadow-sm p-4 relative">
              {summaryLoading && data && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                  更新中…
                </div>
              )}
              <div className="text-red-500 font-semibold text-sm mb-0.5">资产配置</div>
              <div className="text-zinc-400 text-xs mb-2">
                规模统计 {data?.as_of_date ?? "—"}
              </div>
              <ReactECharts key={`donut-${chartKey}`} option={donutOption} style={{ height: 280 }} notMerge />
            </div>

            <div className="lg:col-span-2 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col relative">
              {summaryLoading && data && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                  更新中…
                </div>
              )}
              <div className="flex flex-col items-end gap-2 px-4 py-2 border-b">
                <div className="inline-flex rounded border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setGroupBy("strategy")}
                    className={[
                      "h-7 px-3 text-xs transition-colors",
                      groupBy === "strategy"
                        ? "border border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "text-zinc-600 hover:bg-muted/50",
                    ].join(" ")}
                  >
                    按策略
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupBy("tag")}
                    className={[
                      "h-7 px-3 text-xs border-l border-border transition-colors",
                      groupBy === "tag"
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "text-zinc-600 hover:bg-muted/50",
                    ].join(" ")}
                  >
                    按标签
                  </button>
                </div>

                <div className="flex items-center gap-2 text-zinc-500">
                  {groupBy === "strategy" && (
                    <>
                      <div className="relative">
                        <LayoutTemplate className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                        <select
                          value={strategySource}
                          onChange={(e) => setStrategySource(e.target.value as "company" | "platform")}
                          className="h-7 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                        >
                          <option value="company">团队策略</option>
                          <option value="platform">平台策略</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                      </div>
                      <div className="relative">
                        <GitBranch className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                        <select
                          value={strategyLevel}
                          onChange={(e) => setStrategyLevel(Number(e.target.value) as 1 | 2 | 3)}
                          className="h-7 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                        >
                          <option value={1}>一级</option>
                          <option value={2}>二级</option>
                          <option value={3}>三级</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                      </div>
                    </>
                  )}
                  <span className="text-zinc-300">|</span>
                  <button type="button" onClick={handleExport} className="inline-flex items-center gap-1 hover:text-foreground">
                    <Download className="h-3.5 w-3.5" />导出
                  </button>
                  <button
                    type="button"
                    onClick={openDetails}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Eye className="h-3.5 w-3.5" />查看明细
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30 text-zinc-500">
                      <th className="px-3 py-2.5 text-left font-medium w-12">序号</th>
                      <th className="px-3 py-2.5 text-left font-medium cursor-pointer" onClick={() => handleSort("group_name")}>
                        {groupLabel}<SortIcon active={sortKey === "group_name"} dir={sortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleSort("product_count")}>
                        产品数量<SortIcon active={sortKey === "product_count"} dir={sortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleSort("net_asset_value")}>
                        资产净值<SortIcon active={sortKey === "net_asset_value"} dir={sortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleSort("pct")}>
                        <span className="inline-flex items-center justify-end gap-0.5">
                          资产净值占比
                          <HelpCircle className="h-3 w-3 opacity-50" />
                          <SortIcon active={sortKey === "pct"} dir={sortDir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummary.map((row, i) => (
                      <tr key={row.group_name} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-2.5 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2.5">{row.group_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.product_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(row.net_asset_value)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(row.pct)}</td>
                      </tr>
                    ))}
                    {data?.total && (
                      <tr className="bg-muted/40 font-medium">
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5">{data.total.group_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{data.total.product_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(data.total.net_asset_value)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(data.total.pct)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <div className="bg-background border rounded-xl shadow-sm p-4 relative">
            {seriesLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                {data?.series.length ? "更新中…" : "加载走势…"}
              </div>
            )}
            <div className="flex items-center justify-between mb-2 text-xs text-zinc-500">
              <span>统计区间: {data?.start_date} ~ {data?.end_date}</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seriesSelectAll}
                  onChange={(e) => {
                    setSeriesSelectAll(e.target.checked)
                    if (e.target.checked) setVisibleGroups(new Set(groupNames))
                  }}
                />
                全选
              </label>
            </div>
            {data?.series.length ? (
              <ReactECharts key={`trend-${chartKey}`} option={trendOption} style={{ height: 320 }} notMerge />
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                暂无区间规模走势数据
              </div>
            )}
          </div>

          {/* Underlying stats — donut + table */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 bg-background border rounded-xl shadow-sm p-4 relative">
              {underlyingLoading && underlyingData && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                  更新中…
                </div>
              )}
              <div className="text-red-500 font-semibold text-sm mb-0.5">底层统计</div>
              <div className="text-zinc-400 text-xs mb-2">
                {underlyingData?.as_of_date ?? "—"}
              </div>
              {underlyingError ? (
                <div className="flex items-center justify-center h-48 text-red-500 text-sm px-4 text-center">
                  {underlyingError}
                </div>
              ) : underlyingData?.summary.length ? (
                <ReactECharts key={`underlying-donut-${underlyingChartKey}`} option={underlyingDonutOption} style={{ height: 280 }} notMerge />
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                  {underlyingLoading ? "加载中…" : "暂无底层统计数据"}
                </div>
              )}
            </div>

            <div className="lg:col-span-2 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col relative">
              {underlyingLoading && underlyingData && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                  更新中…
                </div>
              )}
              <div className="flex flex-col items-end gap-2 px-4 py-2 border-b">
                <div className="inline-flex rounded border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUnderlyingGroupBy("strategy")}
                    className={[
                      "h-7 px-3 text-xs transition-colors",
                      underlyingGroupBy === "strategy"
                        ? "border border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "text-zinc-600 hover:bg-muted/50",
                    ].join(" ")}
                  >
                    按策略
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnderlyingGroupBy("manager")}
                    className={[
                      "h-7 px-3 text-xs border-l border-border transition-colors",
                      underlyingGroupBy === "manager"
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "text-zinc-600 hover:bg-muted/50",
                    ].join(" ")}
                  >
                    按管理人
                  </button>
                </div>

                <div className="flex items-center gap-2 text-zinc-500">
                  {underlyingGroupBy === "strategy" && (
                    <>
                      <div className="relative">
                        <LayoutTemplate className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                        <select
                          value={underlyingStrategySource}
                          onChange={(e) => setUnderlyingStrategySource(e.target.value as "company" | "platform")}
                          className="h-7 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                        >
                          <option value="company">团队策略</option>
                          <option value="platform">平台策略</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                      </div>
                      <div className="relative">
                        <GitBranch className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                        <select
                          value={underlyingStrategyLevel}
                          onChange={(e) => setUnderlyingStrategyLevel(Number(e.target.value) as 1 | 2 | 3)}
                          className="h-7 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                        >
                          <option value={1}>一级</option>
                          <option value={2}>二级</option>
                          <option value={3}>三级</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                      </div>
                    </>
                  )}
                  <span className="text-zinc-300">|</span>
                  <button type="button" onClick={handleUnderlyingExport} className="inline-flex items-center gap-1 hover:text-foreground">
                    <Download className="h-3.5 w-3.5" />导出
                  </button>
                  <button
                    type="button"
                    onClick={openUnderlyingDetails}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Eye className="h-3.5 w-3.5" />查看明细
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30 text-zinc-500">
                      <th className="px-3 py-2.5 text-left font-medium w-12">序号</th>
                      <th className="px-3 py-2.5 text-left font-medium cursor-pointer" onClick={() => handleUnderlyingSort("group_name")}>
                        {underlyingGroupLabel}<SortIcon active={underlyingSortKey === "group_name"} dir={underlyingSortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleUnderlyingSort("product_count")}>
                        产品数量<SortIcon active={underlyingSortKey === "product_count"} dir={underlyingSortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleUnderlyingSort("market_value")}>
                        投资市值<SortIcon active={underlyingSortKey === "market_value"} dir={underlyingSortDir} />
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium cursor-pointer" onClick={() => handleUnderlyingSort("pct")}>
                        <span className="inline-flex items-center justify-end gap-0.5">
                          投资市值占比
                          <HelpCircle className="h-3 w-3 opacity-50" />
                          <SortIcon active={underlyingSortKey === "pct"} dir={underlyingSortDir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUnderlyingSummary.map((row, i) => (
                      <tr key={row.group_name} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-2.5 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2.5">{row.group_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.product_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(row.market_value)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(row.pct)}</td>
                      </tr>
                    ))}
                    {underlyingData?.total && (
                      <tr className="bg-muted/40 font-medium">
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5">{underlyingData.total.group_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{underlyingData.total.product_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(underlyingData.total.market_value)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(underlyingData.total.pct)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Allocation proportion — stacked area */}
          <div className="bg-background border rounded-xl shadow-sm p-4 relative">
            {seriesLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60 text-xs text-muted-foreground">
                {data?.series.length ? "更新中…" : "加载走势…"}
              </div>
            )}
            <div className="flex items-center justify-between mb-2 text-xs text-zinc-500">
              <span>统计区间: {data?.start_date} ~ {data?.end_date}</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seriesSelectAll}
                  onChange={(e) => {
                    setSeriesSelectAll(e.target.checked)
                    if (e.target.checked) setVisibleGroups(new Set(groupNames))
                  }}
                />
                全选
              </label>
            </div>
            {data?.series.length ? (
              <ReactECharts key={`pct-stack-${chartKey}`} option={pctStackOption} style={{ height: 320 }} notMerge />
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                暂无占比走势数据
              </div>
            )}
          </div>
        </>
      )}

      {showDetails && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-xl border bg-background shadow-xl flex flex-col">
            <div className="flex items-start justify-between px-5 py-4 border-b">
              <div>
                <div className="font-semibold text-base">规模统计明细</div>
                <div className="text-xs text-zinc-400 mt-1">统计日期：{data.as_of_date}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="text-zinc-400 hover:text-foreground text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-b text-zinc-500">
              <div className="relative">
                <LayoutTemplate className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <select
                  value={detailStrategySource}
                  onChange={(e) => setDetailStrategySource(e.target.value as "company" | "platform")}
                  className="h-8 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                >
                  <option value="company">团队策略</option>
                  <option value="platform">平台策略</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
              <button
                type="button"
                onClick={handleDetailExport}
                className="inline-flex items-center gap-1 h-8 px-3 rounded border border-border hover:bg-muted/50"
              >
                <Download className="h-3.5 w-3.5" />导出
              </button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-zinc-500 sticky top-0">
                    <th className="px-4 py-2.5 text-left font-medium w-12">序号</th>
                    <th className="px-4 py-2.5 text-left font-medium">基金名称</th>
                    <th className="px-4 py-2.5 text-left font-medium">策略</th>
                    <th className="px-4 py-2.5 text-left font-medium">标签</th>
                    <th
                      className="px-4 py-2.5 text-left font-medium cursor-pointer whitespace-nowrap"
                      onClick={() => handleDetailSort("valuation_date")}
                    >
                      估值表日期
                      <SortIcon active={detailSortKey === "valuation_date"} dir={detailSortDir} />
                    </th>
                    <th
                      className="px-4 py-2.5 text-right font-medium cursor-pointer whitespace-nowrap"
                      onClick={() => handleDetailSort("net_asset_value")}
                    >
                      资产净值
                      <SortIcon active={detailSortKey === "net_asset_value"} dir={detailSortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((p, i) => {
                    const strategy = detailStrategySource === "platform"
                      ? formatStrategyPath(p.platform_strategy_l1, p.platform_strategy_l2, p.platform_strategy_l3)
                      : formatStrategyPath(p.company_strategy_l1, p.company_strategy_l2, p.company_strategy_l3)
                    return (
                      <tr key={p.id} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-zinc-400 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">{p.short_name || p.product_name}</td>
                        <td className="px-4 py-2.5">{strategy}</td>
                        <td className="px-4 py-2.5">{formatTags(p.team_tags)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{p.valuation_date ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(p.net_asset_value)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-muted/40 font-medium">
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5">合计</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(detailTotalNav)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showUnderlyingDetails && underlyingData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-xl border bg-background shadow-xl flex flex-col">
            <div className="flex items-start justify-between px-5 py-4 border-b">
              <div>
                <div className="font-semibold text-base">底层统计明细</div>
                <div className="text-xs text-zinc-400 mt-1">统计日期：{underlyingData.as_of_date}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnderlyingDetails(false)}
                className="text-zinc-400 hover:text-foreground text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-b text-zinc-500">
              <div className="relative">
                <LayoutTemplate className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <select
                  value={underlyingDetailStrategySource}
                  onChange={(e) => setUnderlyingDetailStrategySource(e.target.value as "company" | "platform")}
                  className="h-8 appearance-none rounded border border-border bg-background pl-7 pr-6 text-xs text-zinc-600 dark:text-zinc-300"
                >
                  <option value="company">团队策略</option>
                  <option value="platform">平台策略</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
              <button
                type="button"
                onClick={handleUnderlyingDetailExport}
                className="inline-flex items-center gap-1 h-8 px-3 rounded border border-border hover:bg-muted/50"
              >
                <Download className="h-3.5 w-3.5" />导出
              </button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-zinc-500 sticky top-0">
                    <th className="px-4 py-2.5 text-left font-medium w-12">序号</th>
                    <th
                      className="px-4 py-2.5 text-left font-medium cursor-pointer whitespace-nowrap"
                      onClick={() => handleUnderlyingDetailSort("product_name")}
                    >
                      底层基金
                      <SortIcon active={underlyingDetailSortKey === "product_name"} dir={underlyingDetailSortDir} />
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">备案编码</th>
                    <th className="px-4 py-2.5 text-left font-medium">策略</th>
                    <th className="px-4 py-2.5 text-left font-medium">管理人</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">估值表日期</th>
                    <th
                      className="px-4 py-2.5 text-right font-medium cursor-pointer whitespace-nowrap"
                      onClick={() => handleUnderlyingDetailSort("market_value")}
                    >
                      投资市值
                      <SortIcon active={underlyingDetailSortKey === "market_value"} dir={underlyingDetailSortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {underlyingDetailRows.map((p, i) => {
                    const strategy = underlyingDetailStrategySource === "platform"
                      ? formatStrategyPath(p.platform_strategy_l1, p.platform_strategy_l2, p.platform_strategy_l3)
                      : formatStrategyPath(p.company_strategy_l1, p.company_strategy_l2, p.company_strategy_l3)
                    return (
                      <tr key={p.product_key} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-zinc-400 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">{p.product_name}</td>
                        <td className="px-4 py-2.5 tabular-nums">{p.beian_hao ?? "—"}</td>
                        <td className="px-4 py-2.5">{strategy}</td>
                        <td className="px-4 py-2.5">{p.manager_name ?? "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums">{p.valuation_date ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(p.market_value)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-muted/40 font-medium">
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5">合计</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(underlyingDetailTotalMv)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
