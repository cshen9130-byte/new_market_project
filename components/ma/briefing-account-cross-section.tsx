"use client"

import { useEffect, useMemo, useState } from "react"

type PositionRow = {
  contract: string
  longLots: number
  shortLots: number
  positionMv: number
  positionPnl: number
  margin: number
}

function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`
  if (abs === 0) return "0"
  return `${sign}${Math.round(abs).toLocaleString("zh-CN")}`
}

function directionOf(row: PositionRow): string {
  if (row.longLots > 0 && row.shortLots > 0) return "锁"
  if (row.longLots > 0) return "多"
  if (row.shortLots > 0) return "空"
  return "—"
}

function lotsOf(row: PositionRow): number {
  if (row.longLots > 0 && row.shortLots > 0) return row.longLots + row.shortLots
  return row.longLots || row.shortLots || 0
}

export default function BriefingAccountCrossSection({ scopeKey = "" }: { scopeKey?: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [rows, setRows] = useState<PositionRow[]>([])

  useEffect(() => {
    let stop = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const resp = await fetch("/ma/api/mom-analysis/today-position-detail")
        const json = await resp.json() as {
          ok?: boolean
          date?: string | null
          rows?: Array<Record<string, unknown>>
          error?: string
        }
        if (stop) return
        if (json.ok === false) {
          setError(json.error ?? "加载失败")
          setDate(null)
          setRows([])
          return
        }
        setDate((json.date ?? "").slice(0, 10) || null)
        setRows((json.rows ?? []).map((row) => ({
          contract: String(row.contract ?? "").trim(),
          longLots: toNum(row.longLots),
          shortLots: toNum(row.shortLots),
          positionMv: toNum(row.positionMv),
          positionPnl: toNum(row.positionPnl),
          margin: toNum(row.margin),
        })).filter((row) => row.contract))
      } catch (e) {
        if (stop) return
        setError(e instanceof Error ? e.message : "请求失败")
        setDate(null)
        setRows([])
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => { stop = true }
  }, [scopeKey])

  const ranked = useMemo(() => {
    return [...rows]
      .sort((a, b) => Math.abs(b.positionMv) - Math.abs(a.positionMv) || Math.abs(b.margin) - Math.abs(a.margin))
      .slice(0, 12)
  }, [rows])

  const totals = useMemo(() => {
    const netMv = rows.reduce((sum, row) => {
      const long = row.longLots > 0 ? Math.abs(row.positionMv) : 0
      const short = row.shortLots > 0 ? Math.abs(row.positionMv) : 0
      // If both sides exist, positionMv is already the signed residual when provided as notional.
      if (row.longLots > 0 && row.shortLots > 0) return sum + row.positionMv
      if (row.shortLots > 0 && row.longLots <= 0) return sum - Math.abs(row.positionMv)
      return sum + long - short
    }, 0)
    const margin = rows.reduce((sum, row) => sum + row.margin, 0)
    const pnl = rows.reduce((sum, row) => sum + row.positionPnl, 0)
    return { contracts: rows.length, netMv, margin, pnl }
  }, [rows])

  if (loading) {
    return <p className="text-sm text-[#8a9aaa] py-4">加载持仓截面…</p>
  }
  if (error) {
    return <p className="text-sm text-red-700 py-4">{error}</p>
  }

  return (
    <>
      <p className="text-sm leading-7 text-[#2a3a4a] mb-4 pl-1 border-l-4 border-[#c8a84b] bg-[#faf7ef] py-2 px-3 rounded-r">
        当前按单账户风险口径生成
        {date ? <>，持仓截面 <span className="font-semibold">{date}</span></> : null}
        。共 {totals.contracts} 条合约
        {rows.length > 0 ? <>，净市值 {money(totals.netMv)}，保证金 {money(totals.margin)}，浮动盈亏 {money(totals.pnl)}</> : null}
        。
      </p>
      <div className="rounded border border-[#d4c9a8] overflow-hidden mb-4 px-3 py-3" style={{ background: "#ffffff" }}>
        <p className="text-sm font-semibold text-[#1a3a5c] mb-2">主要合约持仓</p>
        {ranked.length === 0 ? (
          <p className="text-sm text-[#8a9aaa]">当前没有持仓截面数据。</p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[#5a6a7a] text-left">
                <th className="font-medium py-1.5 pr-2">合约</th>
                <th className="font-medium py-1.5 pr-2 text-right">方向</th>
                <th className="font-medium py-1.5 pr-2 text-right">手数</th>
                <th className="font-medium py-1.5 pr-2 text-right">市值</th>
                <th className="font-medium py-1.5 pr-2 text-right">保证金</th>
                <th className="font-medium py-1.5 text-right">浮动盈亏</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => {
                const dir = directionOf(row)
                return (
                  <tr key={`${row.contract}-${dir}-${lotsOf(row)}`} className="border-t border-[#eadfc4] text-[#2a3a4a]">
                    <td className="py-1.5 pr-2 font-medium">{row.contract}</td>
                    <td className="py-1.5 pr-2 text-right">{dir}</td>
                    <td className="py-1.5 pr-2 text-right">{lotsOf(row)}</td>
                    <td className="py-1.5 pr-2 text-right">{money(row.positionMv)}</td>
                    <td className="py-1.5 pr-2 text-right">{money(row.margin)}</td>
                    <td className={`py-1.5 text-right ${row.positionPnl > 0 ? "text-red-600" : row.positionPnl < 0 ? "text-emerald-600" : ""}`}>
                      {money(row.positionPnl)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
