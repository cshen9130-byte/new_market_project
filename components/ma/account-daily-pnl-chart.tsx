"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AccountLatest = { account: string; pnl: number }

export default function AccountDailyPnlChart({ height = 260 }: { height?: number }) {
  const [loading, setLoading] = useState(true)
  const [accountLatest, setAccountLatest] = useState<AccountLatest[]>([])

  useEffect(() => {
    fetch("/ma/api/mom-analysis/account-daily-pnl")
      .then((r) => r.json())
      .then((acctJson) => {
        const accountData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = acctJson.accountData ?? {}

        const acctDateCount = new Map<string, number>()
        for (const rows of Object.values(accountData)) {
          for (const row of rows) {
            if (row.pnl !== 0) acctDateCount.set(row.date, (acctDateCount.get(row.date) ?? 0) + 1)
          }
        }

        const latestAcctDate = [...acctDateCount.entries()]
          .filter(([, count]) => count >= 2)
          .sort(([a], [b]) => b.localeCompare(a))[0]?.[0] ?? null

        const acctList = Object.entries(accountData)
          .map(([account, rows]) => {
            const row = latestAcctDate
              ? [...rows].reverse().find((r) => r.date <= latestAcctDate)
              : rows[rows.length - 1]
            return { account, pnl: row?.pnl ?? 0 }
          })
          .filter((a) => a.pnl !== 0)
          .sort((a, b) => b.pnl - a.pnl)

        setAccountLatest(acctList)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const option = useMemo(() => ({
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>")
    },
    grid: { left: 55, right: 10, top: 15, bottom: 60 },
    xAxis: {
      type: "category",
      data: accountLatest.map((a) => a.account),
      axisLabel: { fontSize: 10, rotate: 30 }
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" }
    },
    series: [{
      type: "bar",
      data: accountLatest.map((a) => ({
        value: a.pnl,
        itemStyle: { color: a.pnl >= 0 ? "#ef4444" : "#22c55e" }
      })),
      label: { show: false }
    }]
  }), [accountLatest])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">账户当日盈亏</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
        ) : accountLatest.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-6">暂无数据</p>
        ) : (
          <ReactECharts option={option} style={{ height }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}