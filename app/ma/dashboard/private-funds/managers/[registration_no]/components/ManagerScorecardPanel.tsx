"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronsUpDown, ChevronUp, Inbox } from "lucide-react"

interface ScorecardOverviewRow {
  id: string
  name: string
  score: number | null
  score_date: string
  template_name: string
  creator: string
  last_modified: string
}

interface ScorecardDetailRow {
  category: string
  indicator: string
  weight: string | null
  score: number | null
  remark: string | null
}

interface ScorecardTemplateOption {
  id: string
  name: string
}

interface ScorecardData {
  templates: ScorecardTemplateOption[]
  overview: ScorecardOverviewRow[]
  details_by_key: Record<string, ScorecardDetailRow[]>
}

type SortKey = "score" | "score_date" | "last_modified"
type SortDir = "asc" | "desc"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
      <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
      {children}
    </div>
  )
}

function EmptyBlock() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
      <Inbox className="h-10 w-10 opacity-30 mb-2" strokeWidth={1} />
      <span className="text-sm">暂无数据</span>
    </div>
  )
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
  return sortDir === "asc"
    ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5" />
}

export function ManagerScorecardPanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<ScorecardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [latestOnly, setLatestOnly] = useState(false)
  const [overviewTemplate, setOverviewTemplate] = useState("")
  const [detailTemplate, setDetailTemplate] = useState("")
  const [detailDate, setDetailDate] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("score_date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)
  const pageSize = 10

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/scorecard`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<ScorecardData>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [registrationNo])

  const templateOptions = data?.templates ?? []

  const overviewRows = useMemo(() => {
    let rows = [...(data?.overview ?? [])]
    if (overviewTemplate) {
      rows = rows.filter((r) => r.template_name === overviewTemplate)
    }
    if (latestOnly && rows.length > 0) {
      const latest = [...rows].sort((a, b) => b.score_date.localeCompare(a.score_date))[0]
      rows = latest ? [latest] : []
    }
    rows.sort((a, b) => {
      const av = a[sortKey] ?? ""
      const bv = b[sortKey] ?? ""
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === "asc" ? cmp : -cmp
    })
    return rows
  }, [data?.overview, overviewTemplate, latestOnly, sortKey, sortDir])

  const total = overviewRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pagedOverview = overviewRows.slice((page - 1) * pageSize, page * pageSize)

  const detailDates = useMemo(() => {
    if (!detailTemplate) return []
    const keys = Object.keys(data?.details_by_key ?? {}).filter((k) => k.startsWith(`${detailTemplate}::`))
    return keys.map((k) => k.split("::")[1]).filter(Boolean).sort((a, b) => b.localeCompare(a))
  }, [data?.details_by_key, detailTemplate])

  const detailRows = useMemo(() => {
    if (!detailTemplate || !detailDate) return []
    return data?.details_by_key[`${detailTemplate}::${detailDate}`] ?? []
  }, [data?.details_by_key, detailTemplate, detailDate])

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(col)
      setSortDir("desc")
    }
    setPage(1)
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap bg-zinc-50/80"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800`
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 border-b border-zinc-50"

  if (loading) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="h-56 rounded-lg bg-zinc-100" />
        <div className="h-56 rounded-lg bg-zinc-100" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error ?? "未知错误"}
      </div>
    )
  }

  return (
    <div className="space-y-4 w-full">
      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SectionTitle>评分概览</SectionTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5 text-zinc-600 cursor-pointer">
              <input
                type="checkbox"
                className="rounded h-3.5 w-3.5"
                checked={latestOnly}
                onChange={(e) => { setLatestOnly(e.target.checked); setPage(1) }}
              />
              仅看最新评分
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">评分模版</span>
              <select
                value={overviewTemplate}
                onChange={(e) => { setOverviewTemplate(e.target.value); setPage(1) }}
                className="h-8 min-w-[160px] rounded border border-zinc-200 bg-white px-2 text-zinc-700 outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="">请选择评分模版</option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={`${thBase} w-12 text-center`}>序号</th>
                <th className={`${thBase} min-w-[140px]`}>评分表名称</th>
                <th className={thSort} onClick={() => handleSort("score")}>
                  评分<SortIcon col="score" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thSort} onClick={() => handleSort("score_date")}>
                  评分日期<SortIcon col="score_date" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={`${thBase} min-w-[120px]`}>评分模版</th>
                <th className={`${thBase} min-w-[80px]`}>创建人</th>
                <th className={thSort} onClick={() => handleSort("last_modified")}>
                  最后修改<SortIcon col="last_modified" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={`${thBase} text-center w-20`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedOverview.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyBlock />
                  </td>
                </tr>
              ) : (
                pagedOverview.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-zinc-50/40">
                    <td className={`${tdBase} text-center tabular-nums text-zinc-500`}>
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    <td className={tdBase}>{row.name}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.score ?? "—"}</td>
                    <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.score_date}</td>
                    <td className={tdBase}>{row.template_name}</td>
                    <td className={tdBase}>{row.creator}</td>
                    <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.last_modified}</td>
                    <td className={`${tdBase} text-center`}>
                      <button type="button" className="text-blue-600 hover:underline text-xs">查看</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-zinc-600">
          <span>共 {total} 条</span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="min-w-[28px] h-7 flex items-center justify-center rounded border bg-red-500 text-white border-red-500 font-medium">
            {page}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SectionTitle>评分明细</SectionTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">评分模版</span>
              <select
                value={detailTemplate}
                onChange={(e) => {
                  setDetailTemplate(e.target.value)
                  setDetailDate("")
                }}
                className="h-8 min-w-[160px] rounded border border-zinc-200 bg-white px-2 text-zinc-700 outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="">请选择评分模版</option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">评分日期</span>
              <select
                value={detailDate}
                onChange={(e) => setDetailDate(e.target.value)}
                disabled={!detailTemplate}
                className="h-8 min-w-[140px] rounded border border-zinc-200 bg-white px-2 text-zinc-700 outline-none focus:ring-1 focus:ring-red-200 disabled:opacity-50"
              >
                <option value="">请选择评分日期</option>
                {detailDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {detailRows.length === 0 ? (
          <EmptyBlock />
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="text-sm border-collapse w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className={thBase}>分类</th>
                  <th className={thBase}>指标</th>
                  <th className={thBase}>权重</th>
                  <th className={thBase}>评分</th>
                  <th className={thBase}>备注</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row, idx) => (
                  <tr key={`${row.category}-${row.indicator}-${idx}`} className="hover:bg-zinc-50/40">
                    <td className={tdBase}>{row.category}</td>
                    <td className={tdBase}>{row.indicator}</td>
                    <td className={tdBase}>{row.weight ?? "—"}</td>
                    <td className={`${tdBase} tabular-nums`}>{row.score ?? "—"}</td>
                    <td className={tdBase}>{row.remark ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-zinc-600">
          <span>共 {detailRows.length} 条</span>
          <button type="button" disabled className="w-7 h-7 flex items-center justify-center rounded border opacity-30">‹</button>
          <span className="min-w-[28px] h-7 flex items-center justify-center rounded border bg-red-500 text-white border-red-500 font-medium">1</span>
          <button type="button" disabled className="w-7 h-7 flex items-center justify-center rounded border opacity-30">›</button>
        </div>
      </div>
    </div>
  )
}
