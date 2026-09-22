"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HelpJiaama } from "@/components/ma/quant-vs-subjective-help"

type Holding = {
  signalDate: string
  holdDate: string
  product: string
  name: string
  sector: string
  action: string
  dir: "多" | "空"
  lots: number
  price: number
  contract: string
  notional: number
  margin: number
  qPct: number
  sPct: number
  pnl: number
  openedAt?: string
  openedSession?: "夜盘" | "日盘"
  entryPrice?: number
  entrySignalDate?: string
  cumPnl?: number
}

type Trade = {
  signalDate: string
  tradeDate: string
  product: string
  name: string
  sector: string
  action: string
  side: string
  offset: string
  bs: string
  oldLots: number
  newLots: number
  dLots: number
  price: number
  contract: string
  notional: number
  cost: number
  session: "夜盘" | "日盘"
  openAt: string
  openHint: string
  status: "待执行" | "已成交"
  fromContract?: string
  toContract?: string
}

type Daily = {
  signalDate: string
  returnDate: string
  equity: number
  nav: number
  pnlNet: number
  dd: number
  n: number
}

type Stats = {
  start: number
  end: number
  pnl: number
  nav: number
  cagr: number | null
  vol: number | null
  sharpe: number | null
  maxdd: number | null
  hit: number | null
  n: number
  avgNames: number
  totalCost: number
}

type ApiData = {
  ok: boolean
  date: string | null
  latestDate: string | null
  pending: boolean
  startEquity: number
  stats: Stats | null
  daily: Daily[]
  holdings: Holding[]
  signalTrades: Trade[]
  sessionTrades?: Trade[]
  tradeHistory?: Trade[]
  signals: { product: string; name: string; sector: string; kind: string; qPct: number; sPct: number; dir: string }[]
  error?: string
}

function fmtYuan(v: number, signed = false): string {
  const sign = signed && v > 0 ? "+" : v < 0 ? "−" : ""
  const a = Math.abs(v)
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)}亿`
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(1)}万`
  return `${sign}${Math.round(a).toLocaleString("zh-CN")}`
}

function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const x = v * 100
  const sign = signed && x > 0 ? "+" : ""
  return `${sign}${x.toFixed(digits)}%`
}

function fmtPx(v: number): string {
  if (!v) return "—"
  return v >= 100 ? v.toFixed(1) : v.toFixed(2)
}

function signedClass(v: number): string {
  if (v > 0) return "text-red-600"
  if (v < 0) return "text-emerald-600"
  return "text-muted-foreground"
}

export default function JiaamaOnlyTracker({
  date,
  quantIds,
}: {
  date?: string | null
  quantIds?: number[] | null
}) {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const quantKey = quantIds?.join(",") ?? ""

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams()
    if (date) qs.set("date", date)
    if (quantKey) qs.set("quantIds", quantKey)
    setLoading(true)
    setErr(null)
    fetch(`/ma/api/mom-analysis/jiaama-only?${qs}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json() as ApiData
        if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
        return body
      })
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [date, quantKey])

  const historyOption = useMemo(() => {
    const hist = data?.tradeHistory ?? []
    if (!hist.length) return {}
    const byDate = new Map<string, { open: number; close: number }>()
    for (const t of hist) {
      const cur = byDate.get(t.tradeDate) ?? { open: 0, close: 0 }
      if (t.offset === "平仓" || t.offset === "减仓" || t.offset === "反手" || t.offset === "移仓") cur.close += Math.abs(t.notional)
      if (t.offset === "开仓" || t.offset === "加仓" || t.offset === "反手" || t.offset === "移仓") cur.open += Math.abs(t.notional)
      byDate.set(t.tradeDate, cur)
    }
    const dates = [...byDate.keys()].sort()
    const names = [...new Set(hist.map((t) => `${t.name}(${t.product})`))]
    const openPts: { date: string; name: string; openAt: string; action: string; lots: number; price: string }[] = []
    const closePts: { date: string; name: string; openAt: string; action: string; lots: number; price: string }[] = []
    const rollPts: { date: string; name: string; openAt: string; action: string; lots: number; price: string }[] = []
    for (const t of hist) {
      const name = `${t.name}(${t.product})`
      const row = { date: t.tradeDate, name, openAt: t.openAt, action: `${t.bs}${t.offset}`, lots: t.dLots, price: fmtPx(t.price) }
      if (t.offset === "移仓") rollPts.push(row)
      else if (t.offset === "开仓" || t.offset === "加仓") openPts.push(row)
      else closePts.push(row)
    }
    return {
      color: ["#ef4444", "#16a34a", "#1A365D", "#f59e0b"],
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 52, right: 16, top: 28, height: 150 },
        { left: 88, right: 16, top: 204, height: Math.max(140, names.length * 18) },
      ],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, axisLabel: { fontSize: 10 } },
        { type: "category", data: dates, gridIndex: 1, axisLabel: { fontSize: 10 } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, axisLabel: { fontSize: 10, formatter: (v: number) => `${(v / 1e4).toFixed(0)}万` } },
        { type: "category", data: names, gridIndex: 1, inverse: true, axisLabel: { fontSize: 10 } },
      ],
      series: [
        {
          name: "开/加 名义",
          type: "bar",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: dates.map((d) => Math.round((byDate.get(d)?.open ?? 0))),
          itemStyle: { color: "#ef4444" },
        },
        {
          name: "平/减 名义",
          type: "bar",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: dates.map((d) => Math.round((byDate.get(d)?.close ?? 0))),
          itemStyle: { color: "#16a34a" },
        },
        {
          name: "开仓",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          symbol: "triangle",
          symbolSize: 10,
          data: openPts.map((p) => ({ value: [p.date, p.name], openAt: p.openAt, action: p.action, lots: p.lots, price: p.price })),
          itemStyle: { color: "#ef4444" },
          tooltip: {
            formatter: (p: { data: { value: string[]; openAt: string; action: string; lots: number; price: string } }) =>
              `${p.data.value[1]}<br/>${p.data.openAt} ${p.data.action} ${p.data.lots > 0 ? "+" : ""}${p.data.lots}手 @ ${p.data.price}`,
          },
        },
        {
          name: "平仓",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          symbol: "diamond",
          symbolSize: 9,
          data: closePts.map((p) => ({ value: [p.date, p.name], openAt: p.openAt, action: p.action, lots: p.lots, price: p.price })),
          itemStyle: { color: "#16a34a" },
          tooltip: {
            formatter: (p: { data: { value: string[]; openAt: string; action: string; lots: number; price: string } }) =>
              `${p.data.value[1]}<br/>${p.data.openAt} ${p.data.action} ${p.data.lots > 0 ? "+" : ""}${p.data.lots}手 @ ${p.data.price}`,
          },
        },
        {
          name: "换月",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          symbol: "rect",
          symbolSize: 8,
          data: rollPts.map((p) => ({ value: [p.date, p.name], openAt: p.openAt, action: p.action, lots: p.lots, price: p.price })),
          itemStyle: { color: "#d97706" },
          tooltip: {
            formatter: (p: { data: { value: string[]; openAt: string; action: string; lots: number; price: string } }) =>
              `${p.data.value[1]}<br/>${p.data.openAt} ${p.data.action} ${p.data.lots > 0 ? "+" : ""}${p.data.lots}手 @ ${p.data.price}`,
          },
        },
      ],
    }
  }, [data])

  const navOption = useMemo(() => {
    const daily = data?.daily ?? []
    if (!daily.length) return {}
    const start = data?.startEquity ?? 20_000_000
    const dates = daily.map((d) => d.returnDate)
    const points = daily.map((d) => ({
      value: Math.round(d.equity / 100) / 100,
      dayPnl: d.pnlNet,
      cumPnl: d.equity - start,
      ret: d.equity / start - 1,
    }))
    const startWan = start / 1e4
    return {
      color: ["#1A365D"],
      tooltip: {
        trigger: "axis",
        formatter: (items: { axisValue: string; marker: string; data: { value: number; dayPnl: number; cumPnl: number; ret: number } }[]) => {
          const it = items?.[0]
          if (!it) return ""
          const d = it.data
          const signed = (v: number, body: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${body}`
          const wan = (v: number) => {
            const a = Math.abs(v)
            return a >= 1e8 ? `${(a / 1e8).toFixed(2)}亿` : `${(a / 1e4).toFixed(1)}万`
          }
          return [
            it.axisValue,
            `${it.marker}权益　${d.value.toFixed(1)}万`,
            `当日盈亏　${signed(d.dayPnl, wan(d.dayPnl))}`,
            `累计盈亏　${signed(d.cumPnl, wan(d.cumPnl))}`,
            `收益率　${signed(d.ret, `${(Math.abs(d.ret) * 100).toFixed(2)}%`)}`,
          ].join("<br/>")
        },
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 52, right: 16, top: 28, bottom: 28 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", scale: true, axisLabel: { fontSize: 10, formatter: "{value}万" } },
      series: [
        {
          name: "只做加码同向",
          type: "line",
          data: points,
          showSymbol: false,
          lineStyle: { width: 1.8 },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", color: "#94a3b8" },
            data: [{ yAxis: startWan, label: { formatter: "起始 2,000万", fontSize: 10 } }],
          },
        },
      ],
    }
  }, [data])

  const st = data?.stats
  const lastDay = data?.daily?.at(-1)
  const startEq = data?.startEquity ?? 20_000_000
  const holdings = data?.holdings ?? []
  const trades = data?.signalTrades ?? []
  const tradeHint = data?.pending
    ? `${data.date ?? ""} 收盘信号 · 夜盘当晚 21:00，无夜盘次日 09:00`
    : data?.date
      ? `${data.date} 收盘信号`
      : "当日收盘信号"

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">只做加码同向 · 2,000 万账户净值</CardTitle>
                <HelpJiaama />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                只交易「加码」共识同向，其余空仓。信号日收盘后调仓，下一交易日生效；换月按主力合约真实开平
                {data?.date ? ` · 信号 ${data.date}` : ""}
                {data?.pending ? " · 下单尚未成交" : ""}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {st && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2 mb-2 text-xs">
              <Kpi label="权益" value={fmtYuan(st.end)} />
              <Kpi label="净值" value={st.nav.toFixed(3)} />
              <Kpi label="当日盈亏" value={fmtYuan(lastDay?.pnlNet ?? 0, true)} tone={lastDay?.pnlNet} />
              <Kpi label="累计盈亏" value={fmtYuan(st.pnl, true)} tone={st.pnl} />
              <Kpi label="收益率" value={fmtPct(st.end / startEq - 1)} tone={st.end - startEq} />
              <Kpi label="年化" value={fmtPct(st.cagr)} tone={st.cagr} />
              <Kpi label="夏普" value={st.sharpe == null ? "—" : st.sharpe.toFixed(2)} />
              <Kpi label="最大回撤" value={fmtPct(st.maxdd)} tone={st.maxdd} />
              <Kpi label="持仓数" value={String(holdings.length)} />
            </div>
          )}
          {loading && !data?.daily.length ? (
            <p className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">计算策略净值…</p>
          ) : err ? (
            <p className="h-[120px] flex items-center justify-center text-sm text-destructive">{err}</p>
          ) : !data?.daily.length ? (
            <p className="h-[120px] flex items-center justify-center text-sm text-muted-foreground">暂无回测路径</p>
          ) : (
            <ReactECharts option={navOption} style={{ height: 260, width: "100%" }} notMerge />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">当前持仓</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {holdings[0]?.holdDate
                ? `持仓日 ${holdings[0].holdDate} · 开仓时间为该笔仓位首次开出的夜盘/日盘`
                : "当日无持仓"}
            </p>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            {holdings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">空仓（当日没有加码，或已按规则平掉）</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2 font-medium">品种</th>
                    <th className="text-left py-2 font-medium">合约</th>
                    <th className="text-center py-2 font-medium">方向</th>
                    <th className="text-left py-2 font-medium">开仓时间</th>
                    <th className="text-right py-2 font-medium">开仓价</th>
                    <th className="text-right py-2 font-medium">手数</th>
                    <th className="text-right py-2 font-medium">现价</th>
                    <th className="text-right py-2 font-medium">名义</th>
                    <th className="text-right py-2 font-medium">当日盈亏</th>
                    <th className="text-right py-2 font-medium">累计盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={`${h.product}-${h.contract}`} className="border-b border-border/60">
                      <td className="py-1.5 font-medium">{h.name}<span className="text-muted-foreground font-normal"> {h.product}</span></td>
                      <td className="py-1.5 tabular-nums">{h.contract || "—"}</td>
                      <td className={`py-1.5 text-center ${h.dir === "多" ? "text-red-600" : "text-emerald-600"}`}>{h.dir}</td>
                      <td className="py-1.5 tabular-nums">
                        {h.openedAt || "—"}
                        {h.openedSession ? <span className="text-muted-foreground"> {h.openedSession}</span> : null}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPx(h.entryPrice ?? 0)}</td>
                      <td className="py-1.5 text-right tabular-nums">{h.lots}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPx(h.price)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtYuan(h.notional)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${signedClass(h.pnl)}`}>{fmtYuan(h.pnl, true)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${signedClass(h.cumPnl ?? 0)}`}>{fmtYuan(h.cumPnl ?? 0, true)}</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-1.5">合计</td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td className="py-1.5 text-right tabular-nums">{holdings.reduce((s, h) => s + Math.abs(h.lots), 0)}</td>
                    <td />
                    <td className="py-1.5 text-right tabular-nums">{fmtYuan(holdings.reduce((s, h) => s + h.notional, 0))}</td>
                    <td className={`py-1.5 text-right tabular-nums ${signedClass(holdings.reduce((s, h) => s + h.pnl, 0))}`}>
                      {fmtYuan(holdings.reduce((s, h) => s + h.pnl, 0), true)}
                    </td>
                    <td className={`py-1.5 text-right tabular-nums ${signedClass(holdings.reduce((s, h) => s + (h.cumPnl ?? 0), 0))}`}>
                      {fmtYuan(holdings.reduce((s, h) => s + (h.cumPnl ?? 0), 0), true)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">当日交易</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{tradeHint}</p>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            {trades.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">当日无成交</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2 font-medium">状态</th>
                    <th className="text-left py-2 font-medium">开仓时间</th>
                    <th className="text-left py-2 font-medium">品种</th>
                    <th className="text-left py-2 font-medium">合约</th>
                    <th className="text-left py-2 font-medium">动作</th>
                    <th className="text-right py-2 font-medium">手数</th>
                    <th className="text-right py-2 font-medium">参考价</th>
                    <th className="text-right py-2 font-medium">名义</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={`${t.product}-${t.side}-${t.dLots}`} className="border-b border-border/60">
                      <td className="py-1.5">
                        <span className={`rounded px-1.5 py-0.5 ${t.status === "待执行" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="py-1.5 tabular-nums" title={t.openHint}>
                        {t.openAt}
                        <span className="text-muted-foreground"> {t.session}</span>
                      </td>
                      <td className="py-1.5 font-medium">{t.name}<span className="text-muted-foreground font-normal"> {t.product}</span></td>
                      <td className="py-1.5 tabular-nums">
                        {t.offset === "移仓" && t.fromContract && t.toContract
                          ? `${t.fromContract}→${t.toContract}`
                          : (t.contract || "—")}
                      </td>
                      <td className="py-1.5">
                        {t.bs}{t.offset}
                        <span className="text-muted-foreground"> {t.oldLots}→{t.newLots}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{t.dLots > 0 ? "+" : ""}{t.dLots}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPx(t.price)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtYuan(t.notional)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium">成交历史</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            上图每日开/平名义；下图三角=开仓、菱形=平仓、方块=主力换月。时间是该笔订单的开盘时段（夜盘 21:00 / 日盘 09:00）。
          </p>
        </CardHeader>
        <CardContent className="pt-1 space-y-3">
          {!(data?.tradeHistory?.length) ? (
            <p className="h-[120px] flex items-center justify-center text-sm text-muted-foreground">暂无成交</p>
          ) : (
            <ReactECharts
              option={historyOption}
              style={{ height: Math.max(380, 220 + new Set((data.tradeHistory ?? []).map((t) => t.product)).size * 18), width: "100%" }}
              notMerge
            />
          )}
          {(data?.tradeHistory?.length ?? 0) > 0 && (
            <div className="overflow-x-auto max-h-[320px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2 font-medium">开仓/平仓时间</th>
                    <th className="text-left py-2 font-medium">品种</th>
                    <th className="text-left py-2 font-medium">合约</th>
                    <th className="text-left py-2 font-medium">动作</th>
                    <th className="text-right py-2 font-medium">手数</th>
                    <th className="text-right py-2 font-medium">价格</th>
                    <th className="text-right py-2 font-medium">名义</th>
                    <th className="text-left py-2 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(data?.tradeHistory ?? [])].reverse().slice(0, 80).map((t, i) => (
                    <tr key={`${t.tradeDate}-${t.product}-${t.dLots}-${i}`} className="border-b border-border/60">
                      <td className="py-1.5 tabular-nums">{t.openAt}<span className="text-muted-foreground"> {t.session}</span></td>
                      <td className="py-1.5 font-medium">{t.name}<span className="text-muted-foreground font-normal"> {t.product}</span></td>
                      <td className="py-1.5 tabular-nums">
                        {t.offset === "移仓" && t.fromContract && t.toContract
                          ? `${t.fromContract}→${t.toContract}`
                          : (t.contract || "—")}
                      </td>
                      <td className="py-1.5">{t.bs}{t.offset}<span className="text-muted-foreground"> {t.oldLots}→{t.newLots}</span></td>
                      <td className="py-1.5 text-right tabular-nums">{t.dLots > 0 ? "+" : ""}{t.dLots}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPx(t.price)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtYuan(t.notional)}</td>
                      <td className="py-1.5 text-muted-foreground">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  const cls = tone == null ? "" : signedClass(tone)
  return (
    <div className="rounded border border-border/70 px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`tabular-nums font-medium ${cls}`}>{value}</div>
    </div>
  )
}
