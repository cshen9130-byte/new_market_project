"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  buildMomSignals,
  classifyExposure,
  exposurePct,
  type ActionKind,
  type ExposureMetric,
  type SignalKind,
} from "@/lib/ma/quant-vs-subjective-signals"
import QuantVsSubjectiveHoldingTs, { type HoldingFocus, type HoldingTs } from "@/components/ma/quant-vs-subjective-holding-ts"
import { QUANT_ACCOUNT_IDS, accountNumericId } from "@/lib/ma/quant-accounts"

const QUANT_COLOR = "#3b82f6"
const SUBJ_COLOR = "#f59e0b"
const QUANT_IDS_STORAGE = "ma-qvs-quant-ids"

interface SleeveMv {
  longMv: number
  shortMv: number
  netMv: number
  equityPctGroup: number
  equityPctBook: number
  grossPctGroup: number
  riskPctGroup: number
  riskPctBook: number
}

interface CompareRow {
  key: string
  name: string
  sector?: string
  volAnnPct?: number
  quant: SleeveMv
  subjective: SleeveMv
}

interface GroupInfo {
  accounts: string[]
  nAccounts: number
  equity: number
  margin: number
}

interface ApiData {
  ok: boolean
  date: string | null
  quantIds: number[]
  missingQuantIds: number[]
  groups: { quant: GroupInfo; subjective: GroupInfo } | null
  bookEquity: number
  quantShare: number
  volDays?: number
  sectors: CompareRow[]
  products: CompareRow[]
  sectorTs: {
    date: string
    sector: string
    quantNetPct: number
    subjNetPct: number
    quantEquityPct?: number
    subjEquityPct?: number
  }[]
  productTs?: {
    date: string
    product: string
    quantNetPct: number
    subjNetPct: number
    quantEquityPct?: number
    subjEquityPct?: number
  }[]
  holdingTs?: HoldingTs
  error?: string
}

const ACTION_STYLE: Record<ActionKind, string> = {
  加码: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  观望: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  补风格: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  控拥挤: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  扩容: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
}

const SIGNAL_COLOR: Record<string, string> = {
  consensus_long: "#ef4444",
  consensus_short: "#22c55e",
  divergence: "#8b5cf6",
  quant_only: QUANT_COLOR,
  subj_only: SUBJ_COLOR,
  crowded: "#f97316",
  allocation: "#64748b",
  neutral: "#94a3b8",
}

function fmtYi(n: number): string {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)} 万`
  return n.toLocaleString("zh-CN")
}

function fmtPct(n: number, signed = true): string {
  const body = `${Math.abs(n).toFixed(1)}%`
  if (!signed) return body
  if (n > 0.05) return `+${body}`
  if (n < -0.05) return `-${body}`
  return body
}

function axisPct(v: number) {
  return `${v.toFixed(0)}%`
}

type Metric = ExposureMetric

function groupPct(s: SleeveMv, metric: Metric): number {
  return exposurePct(s, metric)
}

function bookPct(s: SleeveMv, metric: Metric): number {
  return metric === "risk" ? s.riskPctBook : s.equityPctBook
}

function buildConsensusScatterOption(
  rows: CompareRow[],
  metric: Metric,
  unitHint: string,
  names: (row: CompareRow) => { label: string; tooltip: string },
) {
  const filtered = rows.filter(
    (r) => Math.abs(groupPct(r.quant, metric)) + Math.abs(groupPct(r.subjective, metric)) >= 1,
  )
  if (!filtered.length) return {}
  const pts = filtered.map((r) => {
    const signal = classifyExposure(r.quant, r.subjective, metric).signal
    const { label, tooltip } = names(r)
    return {
      value: [
        groupPct(r.quant, metric),
        groupPct(r.subjective, metric),
        Math.max(6, Math.abs(bookPct(r.quant, metric)) + Math.abs(bookPct(r.subjective, metric))),
      ],
      name: tooltip,
      label,
      itemStyle: { color: SIGNAL_COLOR[signal] ?? "#94a3b8" },
      signal,
    }
  })
  const xs = pts.map((p) => p.value[0])
  const ys = pts.map((p) => p.value[1])
  const lim = Math.max(8, ...xs.map(Math.abs), ...ys.map(Math.abs)) * 1.15
  return {
    grid: { left: 52, right: 16, top: 36, bottom: 40 },
    tooltip: {
      formatter: (p: { data: { name: string; value: number[]; signal: string } }) =>
        `<b>${p.data.name}</b><br/>量化 ${fmtPct(p.data.value[0])}<br/>主观 ${fmtPct(p.data.value[1])}<br/>${signalLabel(p.data.signal)}`,
    },
    xAxis: {
      type: "value", min: -lim, max: lim, name: `量化${unitHint}`, nameLocation: "middle", nameGap: 24,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: axisPct },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      axisLine: { lineStyle: { color: "#94a3b8" } },
    },
    yAxis: {
      type: "value", min: -lim, max: lim, name: `主观${unitHint}`, nameLocation: "middle", nameGap: 36,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: axisPct },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      axisLine: { lineStyle: { color: "#94a3b8" } },
    },
    series: [
      {
        type: "scatter",
        data: pts,
        symbolSize: (val: number[]) => Math.min(28, 8 + val[2] * 1.2),
        label: { show: true, formatter: (p: { data: { label: string } }) => p.data.label, fontSize: 9, color: "#64748b" },
        labelLayout: { hideOverlap: true },
      },
    ],
    graphic: [
      { type: "text", left: "62%", top: "18%", style: { text: "共识做多", fill: "#ef444480", fontSize: 12 } },
      { type: "text", left: "18%", top: "72%", style: { text: "共识做空", fill: "#22c55e80", fontSize: 12 } },
      { type: "text", left: "18%", top: "18%", style: { text: "分歧", fill: "#8b5cf680", fontSize: 12 } },
      { type: "text", left: "68%", top: "72%", style: { text: "分歧", fill: "#8b5cf680", fontSize: 12 } },
    ],
  }
}

type TsPoint = {
  date: string
  quantNetPct: number
  subjNetPct: number
  quantEquityPct?: number
  subjEquityPct?: number
}

function buildExposureTsOption(rows: TsPoint[], metric: Metric, axisName: string) {
  if (!rows.length) return {}
  const q = rows.map((r) => metric === "risk" ? r.quantNetPct : (r.quantEquityPct ?? r.quantNetPct))
  const s = rows.map((r) => metric === "risk" ? r.subjNetPct : (r.subjEquityPct ?? r.subjNetPct))
  return {
    grid: { left: 48, right: 16, top: 36, bottom: 48 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 }, data: ["量化", "主观"] },
    tooltip: { trigger: "axis" },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 6, textStyle: { fontSize: 9 } }],
    xAxis: { type: "category", data: rows.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: {
      type: "value",
      name: axisName,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: axisPct },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    series: [
      { name: "量化", type: "line", data: q, showSymbol: false, lineStyle: { width: 2, color: QUANT_COLOR }, itemStyle: { color: QUANT_COLOR } },
      { name: "主观", type: "line", data: s, showSymbol: false, lineStyle: { width: 2, color: SUBJ_COLOR }, itemStyle: { color: SUBJ_COLOR } },
    ],
  }
}

export default function QuantVsSubjectiveCharts() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tsSector, setTsSector] = useState<string>("")
  const [tsProd, setTsProd] = useState<string>("")
  const [prodLimit, setProdLimit] = useState(16)
  const [signalFilter, setSignalFilter] = useState<"all" | ActionKind>("all")
  const [metric, setMetric] = useState<Metric>("risk")
  const [holdingFocus, setHoldingFocus] = useState<HoldingFocus | null>(null)
  const [quantIds, setQuantIds] = useState<number[] | null>(null)
  const [quantAccs, setQuantAccs] = useState<string[]>([])
  const [subjAccs, setSubjAccs] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUANT_IDS_STORAGE)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setQuantIds(parsed.map(Number).filter((n) => Number.isFinite(n) && n >= 0))
          return
        }
      }
    } catch { /* ignore */ }
    setQuantIds([...QUANT_ACCOUNT_IDS])
  }, [])

  const persistQuantIds = (ids: number[]) => {
    setQuantIds(ids)
    try { localStorage.setItem(QUANT_IDS_STORAGE, JSON.stringify(ids)) } catch { /* ignore */ }
  }

  const load = useCallback(() => {
    if (!quantIds) return
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ quantIds: quantIds.join(",") })
    fetch(`/ma/api/mom-analysis/quant-vs-subjective?${qs}`)
      .then((r) => r.json())
      .then((j: ApiData) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setData(j)
        setQuantAccs(j.groups?.quant.accounts ?? [])
        setSubjAccs(j.groups?.subjective.accounts ?? [])
        const secs = [...new Set((j.sectorTs ?? []).map((x) => x.sector))]
        setTsSector((prev) => (prev && secs.includes(prev) ? prev : secs[0] ?? ""))
        const prodCodes = [...new Set((j.productTs ?? []).map((x) => x.product))]
        const ranked = (j.products ?? []).map((p) => p.key).filter((k) => prodCodes.includes(k))
        const pick = ranked[0] ?? prodCodes[0] ?? ""
        setTsProd((prev) => (prev && prodCodes.includes(prev) ? prev : pick))
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [quantIds])

  useEffect(() => { load() }, [load])

  const moveAccount = (account: string, to: "quant" | "subjective") => {
    const idStr = accountNumericId(account)
    if (!idStr || !quantIds) return
    const id = Number(idStr)
    if (!Number.isFinite(id) || id < 0) return
    const alreadyQuant = quantIds.includes(id)
    if (to === "quant" && alreadyQuant) return
    if (to === "subjective" && !alreadyQuant) return
    setQuantAccs((prev) => to === "quant"
      ? [...new Set([...prev, account])].sort()
      : prev.filter((a) => a !== account))
    setSubjAccs((prev) => to === "subjective"
      ? [...new Set([...prev, account])].sort()
      : prev.filter((a) => a !== account))
    const next = new Set(quantIds)
    if (to === "quant") next.add(id)
    else next.delete(id)
    persistQuantIds([...next].sort((a, b) => a - b))
  }

  const sectors = data?.sectors ?? []
  const products = data?.products ?? []
  const allSignals = useMemo(
    () => data
      ? buildMomSignals(
          sectors,
          products.slice(0, 40),
          metric,
          data.quantShare,
          data.groups?.quant.nAccounts ?? 0,
          data.groups?.subjective.nAccounts ?? 0,
        )
      : [],
    [data, sectors, products, metric],
  )
  const signals = allSignals.filter((s) => signalFilter === "all" || s.action === signalFilter)
  const rowSignal = (row: CompareRow) => classifyExposure(row.quant, row.subjective, metric).signal
  const tsSectors = useMemo(
    () => [...new Set((data?.sectorTs ?? []).map((x) => x.sector))],
    [data?.sectorTs],
  )
  const tsProds = useMemo(() => {
    const codes = [...new Set((data?.productTs ?? []).map((x) => x.product))]
    const nameOf = (code: string) =>
      products.find((p) => p.key === code)?.name
      ?? data?.holdingTs?.products.find((p) => p.code === code)?.name
      ?? code
    const ranked = products.map((p) => p.key).filter((k) => codes.includes(k))
    const rest = codes.filter((c) => !ranked.includes(c)).sort()
    return [...ranked, ...rest].map((code) => ({ code, name: nameOf(code) }))
  }, [data?.productTs, data?.holdingTs, products])
  const axisName = metric === "risk" ? "占本组风险预算 %" : "占本组权益 %"
  const unitHint = metric === "risk" ? "风险敞口占比" : "权益占比"

  const sectorBarOption = useMemo(() => {
    if (!sectors.length) return {}
    const sorted = [...sectors].sort(
      (a, b) =>
        Math.abs(groupPct(b.quant, metric)) + Math.abs(groupPct(b.subjective, metric)) -
        (Math.abs(groupPct(a.quant, metric)) + Math.abs(groupPct(a.subjective, metric))),
    )
    return {
      grid: { left: 64, right: 24, top: 36, bottom: 28 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 }, data: ["量化", "主观"] },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { seriesName: string; value: number; dataIndex: number }[]) => {
          const row = sorted[params[0]?.dataIndex]
          if (!row) return ""
          return [
            `<b>${row.name}</b>`,
            `量化风险 ${fmtPct(row.quant.riskPctGroup)}　权益 ${fmtPct(row.quant.equityPctGroup)}`,
            `主观风险 ${fmtPct(row.subjective.riskPctGroup)}　权益 ${fmtPct(row.subjective.equityPctGroup)}`,
            `信号：${signalLabel(rowSignal(row))}`,
          ].join("<br/>")
        },
      },
      xAxis: {
        type: "value",
        name: axisName,
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: axisPct },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      },
      yAxis: { type: "category", data: sorted.map((r) => r.name), axisLabel: { fontSize: 11 }, inverse: true },
      series: [
        { name: "量化", type: "bar", data: sorted.map((r) => groupPct(r.quant, metric)), barMaxWidth: 10, itemStyle: { color: QUANT_COLOR, borderRadius: 2 } },
        { name: "主观", type: "bar", data: sorted.map((r) => groupPct(r.subjective, metric)), barMaxWidth: 10, itemStyle: { color: SUBJ_COLOR, borderRadius: 2 } },
      ],
    }
  }, [sectors, metric, axisName])

  const productBarOption = useMemo(() => {
    const ranked = [...products].sort(
      (a, b) =>
        Math.abs(groupPct(b.quant, metric)) + Math.abs(groupPct(b.subjective, metric)) -
        (Math.abs(groupPct(a.quant, metric)) + Math.abs(groupPct(a.subjective, metric))),
    )
    const rows = ranked.slice(0, prodLimit)
    if (!rows.length) return {}
    return {
      grid: { left: 88, right: 24, top: 36, bottom: 28 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 }, data: ["量化", "主观"] },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const row = rows[params[0]?.dataIndex]
          if (!row) return ""
          const vol = row.volAnnPct != null ? `　年化波动 ${row.volAnnPct.toFixed(1)}%` : ""
          return [
            `<b>${row.name} (${row.key})</b>　${row.sector ?? ""}${vol}`,
            `量化风险 ${fmtPct(row.quant.riskPctGroup)}　权益 ${fmtPct(row.quant.equityPctGroup)}`,
            `主观风险 ${fmtPct(row.subjective.riskPctGroup)}　权益 ${fmtPct(row.subjective.equityPctGroup)}`,
            `信号：${signalLabel(rowSignal(row))}`,
          ].join("<br/>")
        },
      },
      xAxis: {
        type: "value",
        name: axisName,
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: axisPct },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      },
      yAxis: {
        type: "category",
        data: rows.map((r) => `${r.name}`),
        axisLabel: { fontSize: 10 },
        inverse: true,
      },
      series: [
        { name: "量化", type: "bar", data: rows.map((r) => groupPct(r.quant, metric)), barMaxWidth: 9, itemStyle: { color: QUANT_COLOR, borderRadius: 2 } },
        { name: "主观", type: "bar", data: rows.map((r) => groupPct(r.subjective, metric)), barMaxWidth: 9, itemStyle: { color: SUBJ_COLOR, borderRadius: 2 } },
      ],
    }
  }, [products, prodLimit, metric, axisName])

  const productScatterOption = useMemo(
    () => buildConsensusScatterOption(products, metric, unitHint, (r) => ({
      label: r.name,
      tooltip: `${r.name}(${r.key})`,
    })),
    [products, metric, unitHint],
  )

  const sectorScatterOption = useMemo(
    () => buildConsensusScatterOption(sectors, metric, unitHint, (r) => ({
      label: r.name,
      tooltip: r.name,
    })),
    [sectors, metric, unitHint],
  )

  const tsOption = useMemo(
    () => buildExposureTsOption((data?.sectorTs ?? []).filter((x) => x.sector === tsSector), metric, axisName),
    [data?.sectorTs, tsSector, metric, axisName],
  )

  const prodTsOption = useMemo(
    () => buildExposureTsOption((data?.productTs ?? []).filter((x) => x.product === tsProd), metric, axisName),
    [data?.productTs, tsProd, metric, axisName],
  )

  const pieOption = useMemo(() => {
    const g = data?.groups
    if (!g) return {}
    return {
      tooltip: { formatter: (p: { name: string; value: number; percent: number }) => `${p.name} ${fmtYi(p.value)}（${p.percent.toFixed(1)}%）` },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{
        type: "pie",
        radius: ["38%", "62%"],
        center: ["50%", "48%"],
        label: { formatter: "{b}\n{d}%", fontSize: 11 },
        data: [
          { name: "量化", value: g.quant.equity, itemStyle: { color: QUANT_COLOR } },
          { name: "主观", value: g.subjective.equity, itemStyle: { color: SUBJ_COLOR } },
        ],
      }],
    }
  }, [data?.groups])

  const nConsensus = allSignals.filter((s) => s.action === "加码").length
  const nDiv = allSignals.filter((s) => s.action === "观望").length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            拖动右侧账户可划分量化 / 主观，本页全部图表会按新口径重算。风险敞口 = 净名义市值 × 近{data?.volDays ?? 20}日品种波动率，占比为占本组风险预算（|σ×净市值| 之和）。
            国债等高权益、低波动品种的风险占比会明显低于权益占比。切换「风险敞口 / 权益」会重算图表、对照表和决策信号。
          </p>
          {data?.date && (
            <p className="text-xs text-muted-foreground mt-1">持仓截面 {data.date}{data.missingQuantIds?.length ? `　未找到量化账户：${data.missingQuantIds.join("、")}` : ""}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-input text-xs">
            <button
              type="button"
              onClick={() => setMetric("risk")}
              className={`px-2.5 py-1 ${metric === "risk" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              风险敞口
            </button>
            <button
              type="button"
              onClick={() => setMetric("equity")}
              className={`px-2.5 py-1 border-l border-input ${metric === "equity" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              权益
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi title="量化权益" value={data ? fmtYi(data.groups?.quant.equity ?? 0) : "—"} hint={data ? `${data.groups?.quant.nAccounts ?? 0} 户 · 占比 ${fmtPct(data.quantShare, false)}` : ""} accent={QUANT_COLOR} />
        <Kpi title="主观权益" value={data ? fmtYi(data.groups?.subjective.equity ?? 0) : "—"} hint={data ? `${data.groups?.subjective.nAccounts ?? 0} 户 · 占比 ${fmtPct(100 - (data.quantShare ?? 0), false)}` : ""} accent={SUBJ_COLOR} />
        <Kpi title="共识加码信号" value={loading ? "…" : String(nConsensus)} hint="两边同向，可考虑加 beta" />
        <Kpi title="方向分歧信号" value={loading ? "…" : String(nDiv)} hint="暂不加该方向 beta" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <Card className="lg:col-span-2 flex flex-col min-h-[520px]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">MOM 决策信号</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">当前按{unitHint}生成。点击信号可筛选下方多空持仓图。</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(["all", "加码", "观望", "补风格", "控拥挤", "扩容"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSignalFilter(k)}
                    className={`rounded border px-2 py-0.5 text-xs ${signalFilter === k ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:text-foreground"}`}
                  >
                    {k === "all" ? "全部" : k}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 flex-1 min-h-0 overflow-y-auto">
            {loading && !data ? (
              <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>
            ) : !signals.length ? (
              <p className="text-sm text-muted-foreground py-8 text-center">当前截面没有达到阈值的信号。</p>
            ) : (
              <ul className="divide-y divide-border">
                {signals.map((s) => {
                  const clickable = s.level === "product" || s.level === "sector"
                  const active = clickable && holdingFocus?.level === s.level && holdingFocus.key === s.key
                  return (
                    <li key={`${s.level}-${s.key}-${s.type}`}>
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => {
                          if (!clickable) return
                          setHoldingFocus({ level: s.level, key: s.key })
                          document.getElementById("section-holding-ts")?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }}
                        className={`w-full text-left py-3 first:pt-1 ${clickable ? "cursor-pointer rounded-md px-1 -mx-1 hover:bg-muted/60" : "cursor-default"} ${active ? "bg-muted/80" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${ACTION_STYLE[s.action]}`}>{s.action}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium leading-snug">{s.title}</div>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.detail}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 min-h-[520px]">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-1 flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">资金在量化 / 主观之间的分配</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">客户权益合计 · {data?.date ?? ""}</p>
              </div>
              <button
                type="button"
                onClick={() => persistQuantIds([...QUANT_ACCOUNT_IDS])}
                className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
              >
                恢复默认
              </button>
            </CardHeader>
            <CardContent className="pt-0 flex-1 min-h-[280px] relative">
              {data?.groups ? (
                <ReactECharts option={pieOption} style={{ height: "100%", minHeight: 280, width: "100%" }} notMerge />
              ) : (
                <div className="h-full min-h-[280px]" />
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <AccountLane
              title="量化账户"
              hint="拖入设为量化"
              accounts={quantAccs}
              tone="quant"
              onDropAccount={(a) => moveAccount(a, "quant")}
            />
            <AccountLane
              title="主观账户"
              hint="拖入设为主观"
              accounts={subjAccs}
              tone="subjective"
              onDropAccount={(a) => moveAccount(a, "subjective")}
            />
          </div>
        </div>
      </div>

      <QuantVsSubjectiveHoldingTs holdingTs={data?.holdingTs} metric={metric} focus={holdingFocus} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">板块风险敞口：量化 vs 主观</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{axisName} · 正=净多 负=净空 · 截面 {data?.date ?? ""}</p>
          </CardHeader>
          <CardContent className="pt-1">
            {loading && !sectors.length ? (
              <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : (
              <ReactECharts key={`sector-${metric}`} option={sectorBarOption} style={{ height: 360, width: "100%" }} notMerge />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">板块方向共识散点</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">横轴量化、纵轴主观（{unitHint}）；第一/三象限为共识，二/四象限为分歧。</p>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`sector-scatter-${metric}`} option={sectorScatterOption} style={{ height: 360, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-medium">品种风险敞口对比</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">按当前口径 |量化%| + |主观%| 排序 · 同向且都大 → 共识加码；反向 → 观望</p>
            </div>
            <div className="flex items-center gap-1 text-xs shrink-0">
              {[12, 16, 24].map((n) => (
                <button
                  key={n}
                  onClick={() => setProdLimit(n)}
                  className={`rounded border px-2 py-0.5 ${prodLimit === n ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground"}`}
                >
                  Top {n}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`prod-${metric}-${prodLimit}`} option={productBarOption} style={{ height: Math.max(280, prodLimit * 22), width: "100%" }} notMerge />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">品种方向共识散点</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">横轴量化、纵轴主观（{unitHint}）；第一/三象限为共识，二/四象限为分歧。</p>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`prod-scatter-${metric}`} option={productScatterOption} style={{ height: 360, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-medium">板块风险敞口时序</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">近 45 日 · {unitHint} · 两边曲线贴在一起且远离 0 线 = 持续共识；交叉变号 = 共识破裂</p>
            </div>
            <select
              value={tsSector}
              onChange={(e) => setTsSector(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs shrink-0"
            >
              {tsSectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`ts-${metric}-${tsSector}`} option={tsOption} style={{ height: 280, width: "100%" }} notMerge />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-medium">品种风险敞口时序</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">近 45 日 · {unitHint} · 两边曲线贴在一起且远离 0 线 = 持续共识；交叉变号 = 共识破裂</p>
            </div>
            <select
              value={tsProd}
              onChange={(e) => setTsProd(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs shrink-0 max-w-[160px]"
            >
              {tsProds.map((p) => <option key={p.code} value={p.code}>{p.name}({p.code})</option>)}
            </select>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`prod-ts-${metric}-${tsProd}`} option={prodTsOption} style={{ height: 280, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      {sectors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">板块对照表</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">风险% = 占本组风险预算；权益% = 净市值 / 本组权益。解读按风险口径。</p>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">板块</th>
                  <th className="text-right py-2 font-medium">量化风险%</th>
                  <th className="text-right py-2 font-medium">主观风险%</th>
                  <th className="text-right py-2 font-medium">量化权益%</th>
                  <th className="text-right py-2 font-medium">主观权益%</th>
                  <th className="text-left py-2 pl-3 font-medium">解读</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map((r) => (
                  <tr key={r.key} className="border-b border-border/60">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.quant.riskPctGroup)}`}>{fmtPct(r.quant.riskPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.subjective.riskPctGroup)}`}>{fmtPct(r.subjective.riskPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.quant.equityPctGroup)}`}>{fmtPct(r.quant.equityPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.subjective.equityPctGroup)}`}>{fmtPct(r.subjective.equityPctGroup)}</td>
                    <td className="py-1.5 pl-3 text-muted-foreground">{signalLabel(rowSignal(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {products.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">品种对照表</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">年化波动 = 近{data?.volDays ?? 20}日收益标准差 × √252。国债波动低，同样权益占比对应更小风险。</p>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">品种</th>
                  <th className="text-left py-2 font-medium">板块</th>
                  <th className="text-right py-2 font-medium">年化波动</th>
                  <th className="text-right py-2 font-medium">量化风险%</th>
                  <th className="text-right py-2 font-medium">主观风险%</th>
                  <th className="text-right py-2 font-medium">量化权益%</th>
                  <th className="text-right py-2 font-medium">主观权益%</th>
                  <th className="text-left py-2 pl-3 font-medium">解读</th>
                </tr>
              </thead>
              <tbody>
                {products.map((r) => (
                  <tr key={r.key} className="border-b border-border/60">
                    <td className="py-1.5 font-medium">{r.name} <span className="text-muted-foreground font-normal">{r.key}</span></td>
                    <td className="py-1.5 text-muted-foreground">{r.sector ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.volAnnPct != null ? `${r.volAnnPct.toFixed(1)}%` : "—"}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.quant.riskPctGroup)}`}>{fmtPct(r.quant.riskPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.subjective.riskPctGroup)}`}>{fmtPct(r.subjective.riskPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.quant.equityPctGroup)}`}>{fmtPct(r.quant.equityPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.subjective.equityPctGroup)}`}>{fmtPct(r.subjective.equityPctGroup)}</td>
                    <td className="py-1.5 pl-3 text-muted-foreground">{signalLabel(rowSignal(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AccountLane({
  title,
  hint,
  accounts,
  tone,
  onDropAccount,
}: {
  title: string
  hint: string
  accounts: string[]
  tone: "quant" | "subjective"
  onDropAccount: (account: string) => void
}) {
  const [over, setOver] = useState(false)
  const chip = tone === "quant"
    ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
  return (
    <Card
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true) }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const acc = e.dataTransfer.getData("text/plain").trim()
        if (acc) onDropAccount(acc)
      }}
      className={over ? "ring-2 ring-primary" : undefined}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium">{title} · {accounts.length}</CardTitle>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[168px] overflow-y-auto pr-0.5">
          <div className="flex flex-wrap gap-1.5 content-start min-h-[148px]">
            {accounts.length === 0 && (
              <span className="text-xs text-muted-foreground">拖入账户到这里</span>
            )}
            {accounts.map((a) => (
              <span
                key={a}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", a)
                  e.dataTransfer.effectAllowed = "move"
                }}
                className={`cursor-grab active:cursor-grabbing select-none rounded border px-2 py-0.5 text-xs ${chip}`}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function signalLabel(s: SignalKind): string {
  switch (s) {
    case "consensus_long": return "共识做多"
    case "consensus_short": return "共识做空"
    case "divergence": return "方向分歧"
    case "quant_only": return "仅量化"
    case "subj_only": return "仅主观"
    case "crowded": return "共识但拥挤"
    case "allocation": return "资金配置"
    default: return "中性"
  }
}

function pctClass(n: number): string {
  if (n > 0.15) return "text-red-600 dark:text-red-400"
  if (n < -0.15) return "text-emerald-600 dark:text-emerald-400"
  return "text-muted-foreground"
}

function Kpi({ title, value, hint, accent }: { title: string; value: string; hint: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}
