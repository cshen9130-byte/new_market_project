"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Eye,
  HelpCircle,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import { ProductSelectionPanelBound } from "@/components/ma/product-selection-panel"
import { isCodeLikeProductName, preferNonCodeFundName, resolveFundDisplayLabel } from "@/lib/fund-display-name"
import type { SavedFundCompareFund } from "@/lib/ma-fund-compare-storage"

export interface FundCompareMeta {
  beian_hao: string
  product_name: string
  manager: string | null
  manager_scale: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  nav_start_date: string | null
  latest_nav_date: string | null
  unit_nav: string | null
  nav_frequency: string | null
  nav_source: string | null
  expected_ann_vol: string | null
  performance_fee_formula: string | null
  fund_alias: string | null
  remark: string | null
}

type SortKey =
  | "inception_date"
  | "nav_start_date"
  | "latest_nav_date"
  | "unit_nav"

type ColumnKey =
  | "fund_type"
  | "product_name"
  | "manager"
  | "manager_scale"
  | "strategy_l1"
  | "strategy_l2"
  | "inception_date"
  | "nav_start_date"
  | "latest_nav_date"
  | "unit_nav"
  | "nav_frequency"
  | "nav_source"
  | "expected_ann_vol"
  | "performance_fee_formula"
  | "fund_alias"
  | "remark"

const COLUMN_DEFS: { key: ColumnKey; label: string; defaultVisible: boolean; sortable?: SortKey }[] = [
  { key: "fund_type", label: "基金类型", defaultVisible: true },
  { key: "product_name", label: "基金名称", defaultVisible: true },
  { key: "manager", label: "管理人", defaultVisible: true },
  { key: "manager_scale", label: "管理人规模", defaultVisible: true },
  { key: "strategy_l1", label: "平台一级策略", defaultVisible: true },
  { key: "strategy_l2", label: "平台二级策略", defaultVisible: true },
  { key: "inception_date", label: "成立日期", defaultVisible: true, sortable: "inception_date" },
  { key: "nav_start_date", label: "净值开始日期", defaultVisible: true, sortable: "nav_start_date" },
  { key: "latest_nav_date", label: "最新净值日期", defaultVisible: true, sortable: "latest_nav_date" },
  { key: "unit_nav", label: "单位净值", defaultVisible: true, sortable: "unit_nav" },
  { key: "nav_frequency", label: "净值频率", defaultVisible: true },
  { key: "nav_source", label: "净值来源", defaultVisible: true },
  { key: "expected_ann_vol", label: "预期年化波动率", defaultVisible: true },
  { key: "performance_fee_formula", label: "业绩报酬公式", defaultVisible: true },
  { key: "fund_alias", label: "基金别名", defaultVisible: true },
  { key: "remark", label: "备注", defaultVisible: true },
]

function fmtDate(v: string | null | undefined) {
  if (!v) return "—"
  return v.slice(0, 10)
}

function fmtNav(v: string | null | undefined) {
  if (!v) return "—"
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toFixed(4) : "—"
}

function fundDetailHref(beianHao: string) {
  return `/ma/dashboard/private-funds/${encodeURIComponent(beianHao)}`
}

function mergeRow(fund: SavedFundCompareFund, meta?: FundCompareMeta) {
  const metaName = meta?.product_name?.trim() || ""
  const savedName = preferNonCodeFundName(fund.product_name, null, fund.beian_hao)
  const rawName = isCodeLikeProductName(metaName, fund.beian_hao)
    ? savedName
    : (metaName || savedName)
  const product_name = resolveFundDisplayLabel(null, rawName) || rawName || fund.beian_hao
  return {
    beian_hao: fund.beian_hao,
    fund_type: fund.fund_type,
    product_name,
    manager: meta?.manager ?? fund.manager,
    manager_scale: meta?.manager_scale ?? null,
    strategy_l1: meta?.strategy_l1 ?? null,
    strategy_l2: meta?.strategy_l2 ?? null,
    inception_date: meta?.inception_date ?? fund.inception_date,
    nav_start_date: meta?.nav_start_date ?? fund.nav_start_date,
    latest_nav_date: meta?.latest_nav_date ?? fund.latest_nav_date,
    unit_nav: meta?.unit_nav ?? null,
    nav_frequency: meta?.nav_frequency ?? null,
    nav_source: meta?.nav_source ?? "平台净值",
    expected_ann_vol: meta?.expected_ann_vol ?? null,
    performance_fee_formula: meta?.performance_fee_formula ?? "未设置",
    fund_alias: meta?.fund_alias ?? null,
    remark: meta?.remark ?? null,
  }
}

async function fetchFundMeta(funds: SavedFundCompareFund[]): Promise<Map<string, FundCompareMeta>> {
  if (funds.length === 0) return new Map()
  const res = await fetch("/ma/api/fund-compare/fund-meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      beian_haos: funds.map((f) => f.beian_hao),
      products: funds.map((f) => ({
        beian_hao: f.beian_hao,
        product_name: f.product_name,
      })),
    }),
  })
  if (!res.ok) return new Map()
  const json = await res.json() as { data?: FundCompareMeta[] }
  const map = new Map<string, FundCompareMeta>()
  for (const row of json.data ?? []) map.set(row.beian_hao, row)
  return map
}

export function FundCompareFundTable({
  funds,
  onRemove,
  onRefreshFund,
}: {
  funds: SavedFundCompareFund[]
  onRemove: (beianHao: string) => void
  onRefreshFund?: (beianHao: string) => void
}) {
  const [metaMap, setMetaMap] = useState<Map<string, FundCompareMeta>>(new Map())
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>("latest_nav_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(COLUMN_DEFS.filter((c) => c.defaultVisible).map((c) => c.key)),
  )
  const [showFieldConfig, setShowFieldConfig] = useState(false)

  const loadMeta = useCallback(async (ids?: string[]) => {
    const target = ids ? funds.filter((f) => ids.includes(f.beian_hao)) : funds
    if (target.length === 0) {
      if (!ids) setMetaMap(new Map())
      return
    }
    setLoadingMeta(true)
    try {
      const map = await fetchFundMeta(target)
      setMetaMap((prev) => {
        const next = ids ? new Map(prev) : new Map()
        for (const [k, v] of map) next.set(k, v)
        return next
      })
    } finally {
      setLoadingMeta(false)
    }
  }, [funds])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  const rows = useMemo(() => {
    const merged = funds.map((fund) => mergeRow(fund, metaMap.get(fund.beian_hao)))
    const dir = sortDir === "asc" ? 1 : -1
    return [...merged].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (sortKey === "unit_nav") {
        return ((parseFloat(av ?? "") || 0) - (parseFloat(bv ?? "") || 0)) * dir
      }
      return String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN") * dir
    })
  }, [funds, metaMap, sortKey, sortDir])

  const activeColumns = COLUMN_DEFS.filter((c) => visibleCols.has(c.key))

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(funds.map((f) => f.beian_hao)) : new Set())
  }

  function toggleOne(beianHao: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(beianHao)) next.delete(beianHao)
      else next.add(beianHao)
      return next
    })
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  async function refreshOne(beianHao: string) {
    await loadMeta([beianHao])
    onRefreshFund?.(beianHao)
  }

  function handleExport() {
    const headers = ["序号", ...activeColumns.map((c) => c.label)]
    const lines = rows.map((row, i) => {
      const values = activeColumns.map((col) => {
        switch (col.key) {
          case "fund_type": return row.fund_type
          case "product_name": return row.product_name
          case "manager": return row.manager ?? ""
          case "manager_scale": return row.manager_scale ?? ""
          case "strategy_l1": return row.strategy_l1 ?? ""
          case "strategy_l2": return row.strategy_l2 ?? ""
          case "inception_date": return fmtDate(row.inception_date)
          case "nav_start_date": return fmtDate(row.nav_start_date)
          case "latest_nav_date": return fmtDate(row.latest_nav_date)
          case "unit_nav": return fmtNav(row.unit_nav)
          case "nav_frequency": return row.nav_frequency ?? ""
          case "nav_source": return row.nav_source ?? ""
          case "expected_ann_vol": return row.expected_ann_vol ?? ""
          case "performance_fee_formula": return row.performance_fee_formula ?? ""
          case "fund_alias": return row.fund_alias ?? ""
          case "remark": return row.remark ?? ""
          default: return ""
        }
      })
      return [String(i + 1), ...values].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    })
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "基金对比.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderCell(columnKey: ColumnKey, row: ReturnType<typeof mergeRow>) {
    switch (columnKey) {
      case "fund_type":
        return (
          <span className="inline-block px-1.5 py-0.5 rounded text-[11px] border border-zinc-200 bg-zinc-50 text-zinc-600">
            {row.fund_type}
          </span>
        )
      case "product_name":
        return (
          <a
            href={fundDetailHref(row.beian_hao)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline whitespace-nowrap"
          >
            {row.product_name}
          </a>
        )
      case "manager":
        return row.manager ? (
          <a
            href={`/ma/dashboard/private-funds?tab=funds&side=private-funds&manager=${encodeURIComponent(row.manager)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline whitespace-nowrap"
          >
            {row.manager}
          </a>
        ) : "—"
      case "unit_nav":
        return <span className="tabular-nums">{fmtNav(row.unit_nav)}</span>
      case "inception_date":
      case "nav_start_date":
      case "latest_nav_date":
        return <span className="tabular-nums text-xs">{fmtDate(row[columnKey])}</span>
      case "expected_ann_vol":
      case "fund_alias":
      case "remark":
        return row[columnKey] ?? "—"
      case "performance_fee_formula":
        return row.performance_fee_formula ?? "未设置"
      case "manager_scale":
      case "strategy_l1":
      case "strategy_l2":
      case "nav_frequency":
      case "nav_source":
        return row[columnKey] ?? "—"
    }
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none border-b bg-muted/40"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const tdBase = "px-3 py-2 border-b text-sm whitespace-nowrap"

  return (
    <div className="px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-end gap-3 mb-3 text-xs text-zinc-600">
        <button
          type="button"
          onClick={() => setShowFieldConfig(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
        {loadingMeta && <span className="text-muted-foreground">指标加载中…</span>}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1800 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${thBase} w-8 px-2`}>
                <input
                  type="checkbox"
                  className="rounded h-3 w-3"
                  checked={selected.size === funds.length && funds.length > 0}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <th className={`${thBase} w-10 text-center`}>序号</th>
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  className={col.sortable ? thSort : thBase}
                  onClick={col.sortable ? () => handleSort(col.sortable!) : undefined}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {col.key === "fund_alias" || col.key === "remark" ? (
                      <HelpCircle className="h-3 w-3 opacity-40" />
                    ) : null}
                    {col.sortable ? <SortIcon col={col.sortable} /> : null}
                  </span>
                </th>
              ))}
              <th className={`${thBase} text-center w-28`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {funds.length === 0 ? (
              <tr>
                <td colSpan={activeColumns.length + 3} className="py-12 text-center text-muted-foreground text-sm">
                  暂无基金，点击右上角 + 添加
                </td>
              </tr>
            ) : rows.map((row, i) => {
              const isSelected = selected.has(row.beian_hao)
              return (
                <tr key={row.beian_hao} className={["group hover:bg-muted/20", isSelected ? "bg-blue-50/50" : ""].join(" ")}>
                  <td className={`${tdBase} px-2 text-center`}>
                    <input
                      type="checkbox"
                      className="rounded h-3 w-3"
                      checked={isSelected}
                      onChange={() => toggleOne(row.beian_hao)}
                    />
                  </td>
                  <td className={`${tdBase} text-center text-muted-foreground tabular-nums`}>{i + 1}</td>
                  {activeColumns.map((col) => (
                    <td key={col.key} className={tdBase}>{renderCell(col.key, row)}</td>
                  ))}
                  <td className={`${tdBase} text-center`}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => void refreshOne(row.beian_hao)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="刷新指标"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <a
                        href={fundDetailHref(row.beian_hao)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="查看详情"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a
                        href={fundDetailHref(row.beian_hao)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="新窗口打开"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => onRemove(row.beian_hao)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                        title="移除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showFieldConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowFieldConfig(false)}>
          <div
            className="bg-background rounded-lg shadow-xl w-[420px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <span className="font-semibold text-base">字段配置</span>
              <button type="button" onClick={() => setShowFieldConfig(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto px-5 py-4 space-y-2">
              {COLUMN_DEFS.map((col) => (
                <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleCols.has(col.key)}
                    disabled={col.key === "product_name"}
                    onChange={(e) => {
                      setVisibleCols((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(col.key)
                        else next.delete(col.key)
                        return next
                      })
                    }}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
            <div className="px-5 py-3 border-t flex justify-end">
              <button
                type="button"
                onClick={() => setShowFieldConfig(false)}
                className="px-4 py-2 rounded bg-red-600 text-white text-sm hover:bg-red-700"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      <ProductSelectionPanelBound
        data={funds}
        selected={selected}
        setSelected={setSelected}
        getId={(r) => r.beian_hao}
        getName={(r) => r.product_name}
        getBeianHao={(r) => r.beian_hao}
        getLatestNavDate={(r) => metaMap.get(r.beian_hao)?.latest_nav_date ?? null}
        showActions={false}
      />
    </div>
  )
}
