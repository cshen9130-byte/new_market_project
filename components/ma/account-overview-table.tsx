"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"

type OverviewRow = {
  fundName: string
  companyName: string
  accountNo: string
  tradeDate: string
  equity: number | null
  margin: number | null
  totalPl: number | null
  holdingPl: number | null
  closedPl: number | null
  riskPct: number | null
  unilateralRiskPct: number | null
  commission: number | null
}

function fmtMoney(v: number | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

function pnlClass(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return ""
  return v > 0 ? "text-red-500" : "text-green-500"
}

export function AccountOverviewTable() {
  const [rows, setRows] = useState<OverviewRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stop = false
    setLoading(true)
    fetch("/ma/api/account-risk/account-overview")
      .then((r) => r.json())
      .then((j: { ok?: boolean; rows?: OverviewRow[] }) => {
        if (stop) return
        setRows(j.rows ?? [])
      })
      .catch(() => {
        if (stop) return
        setRows([])
      })
      .finally(() => {
        if (!stop) setLoading(false)
      })
    return () => { stop = true }
  }, [])

  const asOf = rows[0]?.tradeDate ?? ""

  return (
    <>
      <div id="section-product" className="flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
        <h2 className="text-sm font-semibold whitespace-nowrap">账户明细</h2>
        <div className="h-px flex-1 bg-border" />
        {asOf && <span className="text-xs text-muted-foreground tabular-nums">截至 {asOf}</span>}
      </div>
      <Card>
        <CardContent className="px-3 py-3">
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">暂无账户数据</div>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card shadow-sm">
                  <tr className="border-b text-left">
                    <th className="px-2 py-1.5 font-medium">私募基金</th>
                    <th className="px-2 py-1.5 font-medium">期货公司</th>
                    <th className="px-2 py-1.5 font-medium">账号</th>
                    <th className="px-2 py-1.5 text-right font-medium">动态权益</th>
                    <th className="px-2 py-1.5 text-right font-medium">保证金</th>
                    <th className="px-2 py-1.5 text-right font-medium">总盈亏</th>
                    <th className="px-2 py-1.5 text-right font-medium">持盈</th>
                    <th className="px-2 py-1.5 text-right font-medium">平盈</th>
                    <th className="px-2 py-1.5 text-right font-medium">风险度</th>
                    <th className="px-2 py-1.5 text-right font-medium">单边风险度</th>
                    <th className="px-2 py-1.5 text-right font-medium">手续费</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.accountNo} className="border-b last:border-b-0">
                      <td className="whitespace-nowrap px-2 py-1.5">{row.fundName || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.companyName || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{row.accountNo || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.equity)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.margin)}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.totalPl)}`}>
                        {fmtMoney(row.totalPl, 0)}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.holdingPl)}`}>
                        {fmtMoney(row.holdingPl, 0)}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.closedPl)}`}>
                        {fmtMoney(row.closedPl, 0)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtPct(row.riskPct)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtPct(row.unilateralRiskPct)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
