"use client"

import { useState, useEffect } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface NavPoint { date: string; dailyReturn: number }
interface BmPoint  { date: string; close: number }
interface NhciLagMeta {
  positionAsOf?: string | null
  nhciAsOf?: string | null
  lagging?: boolean
  lagReason?: string | null
}

/** Beijing calendar YYYY-MM-DD (cache / trade-date convention). */
function todayCst(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b
}

export default function RollingVolChart({ height = 260 }: { height?: number }) {
  const [navData,  setNavData]  = useState<NavPoint[]>([])
  const [bmData,   setBmData]   = useState<BmPoint[]>([])
  const [lagMeta,  setLagMeta]  = useState<NhciLagMeta | null>(null)
  const [volWindow, setVolWindow] = useState<5 | 10 | 20>(20)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const navRes = await fetch("/ma/api/mom-analysis/product-nav")
        const j = await navRes.json()
        const rows: NavPoint[] = (j.data ?? []).map((p: { date: string; dailyReturn: number }) => ({
          date: p.date,
          dailyReturn: p.dailyReturn,
        }))
        if (cancelled) return
        setNavData(rows)
        if (rows.length === 0) return

        const from = rows[0].date
        // Do NOT cap NHCI at product last date: if product-nav cache/ETL lags,
        // that cap blanked NHCI to the same early end (both lines stopped).
        // Request through max(productLast, today) so each series keeps its own tip.
        const productTo = rows[rows.length - 1].date
        const to = maxDate(productTo, todayCst())
        const params = new URLSearchParams({ from, to, codes: "NHCI.NH" })
        const bj = await (await fetch(`/ma/api/mom-analysis/benchmark?${params}`)).json()
        if (cancelled) return
        const series = bj.series?.[0]
        setBmData(series?.data ?? [])
        setLagMeta(bj.meta ?? null)
        // If API reports lag, force a nocache re-read once in case file cache was
        // written before NHCI advanced (freshness token should usually prevent this).
        if (bj.meta?.lagging) {
          const fresh = await (await fetch(`/ma/api/mom-analysis/benchmark?${params}&nocache=1`)).json()
          if (cancelled) return
          const s2 = fresh.series?.[0]
          setBmData(s2?.data ?? [])
          setLagMeta(fresh.meta ?? bj.meta)
        }
      } catch {
        /* non-fatal */
      }
    })()
    return () => { cancelled = true }
  }, [])

  const option = (() => {
    const WINDOW = Math.min(volWindow, Math.max(2, navData.length - 1))
    const start = navData.length <= volWindow ? 2 : WINDOW
    const ANN = Math.sqrt(252)

    // Product vol is computed solely from product-nav — never trimmed to NHCI dates.
    const fundVol: [string, number][] = []
    for (let i = start; i < navData.length; i++) {
      const w = Math.min(WINDOW, i)
      // Include return on day i so product vol aligns with NHCI window ending at i.
      const slice = navData.slice(i - w + 1, i + 1).map((p) => p.dailyReturn)
      const mu  = slice.reduce((s, r) => s + r, 0) / slice.length
      const vol = slice.length > 1
        ? Math.sqrt(slice.reduce((s, r) => s + (r - mu) ** 2, 0) / (slice.length - 1)) * ANN
        : 0
      fundVol.push([navData[i].date, parseFloat((vol * 100).toFixed(4))])
    }

    // NHCI vol uses its own closes through its true last bar (may lag or lead product).
    const bmVol: [string, number][] = []
    if (bmData.length > 2) {
      const bmStart = bmData.length <= volWindow ? 2 : WINDOW
      for (let i = bmStart; i < bmData.length; i++) {
        const w = Math.min(WINDOW, i)
        const slice  = bmData.slice(i - w, i + 1)
        const bmRets = slice.slice(1).map((p, j) => (p.close - slice[j].close) / slice[j].close)
        const mu  = bmRets.reduce((s, r) => s + r, 0) / bmRets.length
        const vol = Math.sqrt(bmRets.reduce((s, r) => s + (r - mu) ** 2, 0) / (bmRets.length - 1)) * ANN
        bmVol.push([bmData[i].date, parseFloat((vol * 100).toFixed(4))])
      }
    }

    // Ratio only where both exist; missing NHCI must not drop product points.
    const ratioData: [string, number][] = (() => {
      const m = new Map(bmVol.map(([d, v]) => [d, v]))
      return fundVol
        .filter(([d]) => m.has(d) && m.get(d)! > 0)
        .map(([d, fv]) => [d, parseFloat((fv / m.get(d)!).toFixed(4))] as [string, number])
    })()

    return {
      animation: false,
      backgroundColor: "transparent",
      legend: { top: 4, right: 72, icon: "roundRect", itemWidth: 10, itemHeight: 4, textStyle: { fontSize: 10 } },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown[]) => {
          const ps = params as Array<{ seriesName: string; value: [string, number]; marker: string }>
          if (!ps.length) return ""
          return [
            ps[0].value[0],
            ...ps.map((p) =>
              p.seriesName === "波动比率"
                ? `${p.marker}${p.seriesName}: ${p.value[1].toFixed(3)}x`
                : `${p.marker}${p.seriesName}: ${p.value[1].toFixed(2)}%`
            ),
          ].join("<br/>")
        },
      },
      xAxis: { type: "time", axisLabel: { fontSize: 11 }, splitLine: { show: false } },
      yAxis: [
        {
          type: "value",
          name: "波动率",
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 11, formatter: (v: number) => `${v.toFixed(0)}%` },
          splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } },
        },
        {
          type: "value",
          name: "比率",
          nameTextStyle: { fontSize: 10 },
          position: "right",
          axisLabel: { fontSize: 11, formatter: (v: number) => `${v.toFixed(1)}x` },
          splitLine: { show: false },
        },
      ],
      series: [
        { name: "产品",    type: "line", yAxisIndex: 0, data: fundVol,   smooth: false, symbol: "none", lineStyle: { color: "#ef4444", width: 1.5 }, itemStyle: { color: "#ef4444" }, areaStyle: { color: "#ef444422" } },
        ...(bmVol.length > 0 ? [
          { name: "南华商品", type: "line", yAxisIndex: 0, data: bmVol,   smooth: false, symbol: "none", lineStyle: { color: "#60a5fa", width: 1.5 }, itemStyle: { color: "#60a5fa" }, areaStyle: { color: "#60a5fa22" } },
          { name: "波动比率", type: "line", yAxisIndex: 1, data: ratioData, smooth: true,  symbol: "none", lineStyle: { color: "#a78bfa", width: 1.5, type: "dashed" }, itemStyle: { color: "#a78bfa" } },
        ] : []),
      ],
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", height: 20, bottom: 0, start: 0, end: 100 },
      ],
      grid: { top: 28, right: 52, bottom: 48, left: 56 },
    }
  })()

  const latestNav = navData.at(-1)?.date
  const latestBm = bmData.at(-1)?.date
  const showLag =
    !!lagMeta?.lagging ||
    (!!latestNav && !!latestBm && latestBm < latestNav) ||
    (!!latestNav && bmData.length > 0 && !latestBm)

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{volWindow}日滚动波动率（年化）</CardTitle>
          <div className="flex gap-1">
            {([5, 10, 20] as const).map((w) => (
              <button
                key={w}
                onClick={() => setVolWindow(w)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  volWindow === w
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {w}日
              </button>
            ))}
          </div>
        </div>
        {showLag && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            南华商品 NHCI 未对齐最新持仓日
            {latestNav ? `（产品 ${latestNav}` : "（产品 ?"}
            {latestBm ? ` / NHCI ${latestBm}` : " / NHCI 缺失"}
            {lagMeta?.positionAsOf ? `；持仓截至 ${lagMeta.positionAsOf}` : ""}
            ）。EmQuant 当日结算未入库或缓存未失效时波动比率在共有日期上计算——产品线仍绘至其自身最新交易日。请等待盘后 NHCI 抓取或检查 nanhua ETL。
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {navData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>
        ) : (
          <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
        )}
      </CardContent>
    </Card>
  )
}
