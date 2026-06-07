"use client"

import { memo, useState, useMemo, Fragment } from "react"
import type React from "react"
import { RED, GREEN, getNavFieldValue, type NavRow, type PeerMonthlyRow } from "./shared"

interface MonthlyReturn {
  year: number
  month: number
  ret: number | null
}

function computeMonthlyReturns(rows: NavRow[], navType: string): MonthlyReturn[] {
  if (!rows.length) return []
  const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const monthFirst = new Map<string, number>()
  const monthLast  = new Map<string, number>()
  for (const row of sorted) {
    const ym = row.price_date.slice(0, 7)
    const v  = getNavFieldValue(row, navType)
    if (!monthFirst.has(ym)) monthFirst.set(ym, v)
    monthLast.set(ym, v)
  }
  const keys = [...monthLast.keys()].sort()
  return keys.map((key, i) => {
    const [yearStr, monthStr] = key.split("-")
    const year  = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    const cur   = monthLast.get(key)!
    const prev  = i === 0 ? monthFirst.get(key) : monthLast.get(keys[i - 1])
    if (!prev || prev <= 0 || !isFinite(cur)) return { year, month, ret: null }
    return { year, month, ret: (cur / prev - 1) * 100 }
  })
}

const CALENDAR_MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]

export const MonthlyReturnsCalendar = memo(function MonthlyReturnsCalendar({
  productName, sampleGroup, rows, navType, peerMonthly,
}: {
  productName: string
  sampleGroup: string | null
  rows: NavRow[]
  navType: string
  peerMonthly: PeerMonthlyRow[]
}) {
  const INITIAL_YEARS = 2
  const [expanded, setExpanded] = useState(false)

  const monthly = useMemo(() => computeMonthlyReturns(rows, navType), [rows, navType])

  const peerByYm = useMemo(() => {
    const m = new Map<string, PeerMonthlyRow>()
    for (const r of peerMonthly) m.set(r.ym, r)
    return m
  }, [peerMonthly])

  const yearGroups = useMemo(() => {
    const map = new Map<number, (number | null)[]>()
    for (const { year, month, ret } of monthly) {
      if (!map.has(year)) map.set(year, Array(12).fill(null))
      map.get(year)![month - 1] = ret
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [monthly])

  if (!yearGroups.length) return null

  function yearTotalReturn(rets: (number | null)[]): number | null {
    const valid = rets.filter((r): r is number => r !== null)
    if (!valid.length) return null
    return valid.reduce((acc, r) => acc * (1 + r / 100), 1) * 100 - 100
  }

  function calcWinRate(rets: (number | null)[]): number | null {
    const valid = rets.filter((r): r is number => r !== null)
    if (!valid.length) return null
    return (valid.filter((r) => r > 0).length / valid.length) * 100
  }

  function fmtPctCell(v: number | null): { text: string; style?: React.CSSProperties } {
    if (v === null) return { text: "—" }
    const color = v > 0 ? RED : v < 0 ? GREEN : undefined
    return { text: (v > 0 ? "+" : "") + v.toFixed(2) + "%", style: color ? { color } : undefined }
  }

  function quartileBar(ym: string): React.ReactNode {
    const p = peerByYm.get(ym)
    if (!p || p.rank_num === null || p.sample_n <= 0) {
      return <div className="h-1.5 w-full rounded-full bg-zinc-100 mx-auto max-w-[40px]" />
    }
    const score = Math.max(0, Math.min(1, 1 - (p.rank_num - 1) / p.sample_n))
    const pct = Math.round(score * 100)
    const barColor = score > 0.75 ? "#ef4444" : score > 0.5 ? "#f97316" : score > 0.25 ? "#eab308" : "#a1a1aa"
    return (
      <div className="w-full rounded-full bg-zinc-100 mx-auto max-w-[40px] h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
    )
  }

  const visibleYears = expanded ? yearGroups : yearGroups.slice(0, INITIAL_YEARS)
  const hasMore = yearGroups.length > INITIAL_YEARS
  const hasPeer = peerMonthly.length > 0

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
          月度收益
        </div>
        {sampleGroup && (
          <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
            <span className="text-zinc-500">样本组：</span>
            <select defaultValue={sampleGroup} className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]">
              <option value={sampleGroup}>{sampleGroup}</option>
            </select>
            <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">平台</span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-xs min-w-[960px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-12 border-r border-zinc-100">年份</th>
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 min-w-[100px] border-r border-zinc-100">基金名称</th>
              {CALENDAR_MONTHS.map((m) => (
                <th key={m} className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{m}</th>
              ))}
              <th className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap border-l border-zinc-100">胜率</th>
              <th className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">全年</th>
            </tr>
          </thead>
          <tbody>
            {visibleYears.map(([year, rets], yi) => {
              const yr = yearTotalReturn(rets)
              const wr = calcWinRate(rets)
              const yrFmt = fmtPctCell(yr)
              const wrText = wr !== null ? wr.toFixed(2) + "%" : "—"
              const isLastGroup = yi === visibleYears.length - 1

              type SampleRowDef = { label: string; render: (ym: string) => React.ReactNode }
              const sampleRows: SampleRowDef[] = hasPeer ? [
                { label: "样本平均值", render: (ym) => { const p = peerByYm.get(ym); if (!p) return <span className="text-zinc-300">—</span>; const { text, style } = fmtPctCell(p.mean_ret); return <span className="text-zinc-500 tabular-nums" style={style}>{text}</span> } },
                { label: "样本中位数", render: (ym) => { const p = peerByYm.get(ym); if (!p) return <span className="text-zinc-300">—</span>; const { text, style } = fmtPctCell(p.median_ret); return <span className="text-zinc-500 tabular-nums" style={style}>{text}</span> } },
                { label: "样本排名",   render: (ym) => { const p = peerByYm.get(ym); if (!p || p.rank_num === null) return <span className="text-zinc-300">—</span>; return <span className="text-zinc-500 tabular-nums">{p.rank_num}/{p.sample_n}</span> } },
                { label: "四分位",     render: (ym) => quartileBar(ym) },
              ] : [
                { label: "样本平均值", render: () => <span className="text-zinc-300">—</span> },
                { label: "样本中位数", render: () => <span className="text-zinc-300">—</span> },
                { label: "样本排名",   render: () => <span className="text-zinc-300">—</span> },
                { label: "四分位",     render: () => <div className="h-1.5 w-full rounded-full bg-zinc-100 mx-auto max-w-[40px]" /> },
              ]

              return (
                <Fragment key={year}>
                  <tr className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className="px-3 py-2.5 text-zinc-700 font-semibold border-r border-zinc-100 align-top" rowSpan={sampleRows.length + 1}>{year}</td>
                    <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 truncate max-w-[120px]">{productName}</td>
                    {rets.map((r, mi) => {
                      const { text, style } = fmtPctCell(r)
                      return <td key={mi} className="px-2 py-2.5 text-center tabular-nums font-medium" style={style}>{text}</td>
                    })}
                    <td className="px-2 py-2.5 text-center tabular-nums text-zinc-700 border-l border-zinc-100">{wrText}</td>
                    <td className="px-2 py-2.5 text-center tabular-nums font-medium" style={yrFmt.style}>{yrFmt.text}</td>
                  </tr>
                  {sampleRows.map(({ label, render }, ri) => {
                    const isLast = ri === sampleRows.length - 1
                    const rowCls = ["border-b", isLast && !isLastGroup ? "border-b-zinc-200" : "border-b-zinc-50"].join(" ")
                    return (
                      <tr key={label} className={rowCls}>
                        <td className="px-3 py-1.5 text-zinc-400 border-r border-zinc-100">{label}</td>
                        {Array.from({ length: 12 }, (_, mi) => {
                          const ym = `${year}-${String(mi + 1).padStart(2, "0")}`
                          return <td key={mi} className="px-2 py-1.5 text-center">{render(ym)}</td>
                        })}
                        <td className="px-2 py-1.5 text-center text-zinc-300 border-l border-zinc-100">—</td>
                        <td className="px-2 py-1.5 text-center text-zinc-300">—</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full text-xs text-blue-500 hover:text-blue-600 transition-colors py-1 text-center">
          {expanded ? "收起" : "展开更多年份"}
        </button>
      )}
    </div>
  )
})
MonthlyReturnsCalendar.displayName = "MonthlyReturnsCalendar"
