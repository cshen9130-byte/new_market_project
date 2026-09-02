"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DateInput } from "@/components/ui/date-input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  buildMomSignals,
  buildSignalHistory,
  classifyExposure,
  classifyRowFlow,
  exposurePct,
  fmtFlowYuan,
  lookupFlow,
  signalRowKey,
  tagSignalsVsPrev,
  type ActionKind,
  type ExposureMetric,
  type FlowMap,
  type FlowView,
  type MarginTag,
} from "@/lib/ma/quant-vs-subjective-signals"
import { ACTION_ORDER, MomSignalTable, compareByAction } from "@/components/ma/mom-signal-table"
import QuantVsSubjectiveHoldingTs, { type HoldingFocus, type HoldingTs } from "@/components/ma/quant-vs-subjective-holding-ts"
import { QUANT_ACCOUNT_IDS, accountNumericId } from "@/lib/ma/quant-accounts"
import {
  HelpConsensusKpi,
  HelpDivKpi,
  HelpFlowScatter,
  HelpMarginKpi,
  HelpPie,
  HelpProductBar,
  HelpProductTable,
  HelpQuantMargin,
  HelpScatter,
  HelpSectorBar,
  HelpSectorTable,
  HelpSignalHistory,
  HelpSignals,
  HelpSubjMargin,
  HelpTs,
} from "@/components/ma/quant-vs-subjective-help"

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
  latestDate?: string | null
  quantIds: number[]
  missingQuantIds: number[]
  groups: { quant: GroupInfo; subjective: GroupInfo } | null
  bookEquity: number
  bookMargin?: number
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
  flows?: FlowMap
  error?: string
}

const ACTION_STACK_COLOR: Record<ActionKind, string> = {
  加码: "#ef4444",
  暂缓加码: "#64748b",
  减码准备: "#ec4899",
  观望: "#8b5cf6",
  补风格: "#0ea5e9",
  控拥挤: "#f59e0b",
  扩容: "#10b981",
}

const ACTION_HEAT_CODE: Record<ActionKind, number> = {
  加码: 1,
  观望: 2,
  补风格: 3,
  控拥挤: 4,
  扩容: 5,
  暂缓加码: 6,
  减码准备: 7,
}

const FLOW_TAG_COLOR: Record<MarginTag, string> = {
  同向加仓: "#ef4444",
  同向减仓: "#ec4899",
  边际背离: "#64748b",
  分歧收敛: "#10b981",
  分歧加剧: "#8b5cf6",
  一侧变动: "#0ea5e9",
  变化很小: "#94a3b8",
}

const SECTOR_ORDER = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"]

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
    const signal = classifyExposure(r.quant, r.subjective, "risk").signal
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
  const maxAbs = Math.max(8, ...xs.map(Math.abs), ...ys.map(Math.abs)) * 1.15
  const signed = metric === "risk"
  const axisMin = signed ? -maxAbs : 0
  const pctFmt = signed
    ? (v: number) => fmtPct(v)
    : (v: number) => fmtPct(v, false)
  return {
    grid: { left: 52, right: 16, top: 36, bottom: 40 },
    tooltip: {
      formatter: (p: { data: { name: string; value: number[]; signal: string } }) =>
        `<b>${p.data.name}</b><br/>量化 ${pctFmt(p.data.value[0])}<br/>主观 ${pctFmt(p.data.value[1])}<br/>方向：${signalLabel(p.data.signal)}`,
    },
    xAxis: {
      type: "value", min: axisMin, max: maxAbs, name: `量化${unitHint}`, nameLocation: "middle", nameGap: 24,
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: axisPct },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      axisLine: { lineStyle: { color: "#94a3b8" } },
    },
    yAxis: {
      type: "value", min: axisMin, max: maxAbs, name: `主观${unitHint}`, nameLocation: "middle", nameGap: 36,
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
    graphic: signed
      ? [
          { type: "text", left: "62%", top: "18%", style: { text: "共识做多", fill: "#ef444480", fontSize: 12 } },
          { type: "text", left: "18%", top: "72%", style: { text: "共识做空", fill: "#22c55e80", fontSize: 12 } },
          { type: "text", left: "18%", top: "18%", style: { text: "分歧", fill: "#8b5cf680", fontSize: 12 } },
          { type: "text", left: "68%", top: "72%", style: { text: "分歧", fill: "#8b5cf680", fontSize: 12 } },
        ]
      : [
          { type: "text", left: "58%", top: "22%", style: { text: "两边都配", fill: "#64748b80", fontSize: 12 } },
          { type: "text", left: "22%", top: "22%", style: { text: "仅主观", fill: "#f59e0b80", fontSize: 12 } },
          { type: "text", left: "58%", top: "68%", style: { text: "仅量化", fill: "#3b82f680", fontSize: 12 } },
        ],
  }
}

function flowSrcFromHolding(h: HoldingTs | undefined): import("@/lib/ma/quant-vs-subjective-signals").FlowGridSource | undefined {
  if (!h?.quantLongLots || !h.quantShortLots || !h.subjLongLots || !h.subjShortLots) return undefined
  return {
    dates: h.dates,
    products: h.products,
    quantLong: h.quantLong,
    quantShort: h.quantShort,
    quantLongLots: h.quantLongLots,
    quantShortLots: h.quantShortLots,
    subjLong: h.subjLong,
    subjShort: h.subjShort,
    subjLongLots: h.subjLongLots,
    subjShortLots: h.subjShortLots,
  }
}

function buildFlowScatterOption(
  rows: { name: string; tooltip: string; qStock: number; sStock: number; flow: FlowView | null }[],
) {
  const pts = rows.filter((r) => r.flow && (Math.abs(r.flow.q1d) + Math.abs(r.flow.s1d) >= 5e5 || Math.abs(r.qStock) + Math.abs(r.sStock) >= 1))
  if (!pts.length) return {}
  const data = pts.map((r) => {
    const fv = r.flow!
    return {
      value: [fv.q1d / 1e4, fv.s1d / 1e4, Math.max(8, Math.abs(r.qStock) + Math.abs(r.sStock))],
      name: r.tooltip,
      label: r.name,
      itemStyle: { color: FLOW_TAG_COLOR[fv.tag] },
      tag: fv.tag,
      fv,
      qStock: r.qStock,
      sStock: r.sStock,
    }
  })
  const xs = data.map((p) => p.value[0])
  const ys = data.map((p) => p.value[1])
  const maxAbs = Math.max(20, ...xs.map(Math.abs), ...ys.map(Math.abs)) * 1.15
  return {
    grid: { left: 56, right: 16, top: 36, bottom: 40 },
    tooltip: {
      formatter: (p: { data: (typeof data)[number] }) => {
        const d = p.data
        if (!d) return ""
        return [
          `<b>${d.name}</b>　${d.tag}${d.fv.cutPnl ? ` · ${d.fv.cutPnl}` : ""}`,
          `存量 量化 ${fmtPct(d.qStock)}　主观 ${fmtPct(d.sStock)}`,
          `1日主动 量化 ${fmtFlowYuan(d.fv.q1d)}　主观 ${fmtFlowYuan(d.fv.s1d)}`,
          `5日主动 量化 ${fmtFlowYuan(d.fv.q5d)}　主观 ${fmtFlowYuan(d.fv.s5d)}`,
        ].join("<br/>")
      },
    },
    xAxis: {
      type: "value",
      name: "量化主动调仓（万）",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { fontSize: 10 },
      min: -maxAbs,
      max: maxAbs,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}` },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    yAxis: {
      type: "value",
      name: "主观主动调仓（万）",
      nameTextStyle: { fontSize: 10 },
      min: -maxAbs,
      max: maxAbs,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}` },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    series: [{
      type: "scatter",
      symbolSize: (val: number[]) => Math.min(28, 6 + (val[2] ?? 6) * 0.35),
      data,
      label: { show: true, formatter: (p: { data: { label: string } }) => p.data.label, fontSize: 9, color: "#64748b" },
      labelLayout: { hideOverlap: true },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { type: "dashed", color: "#94a3b8", width: 1 },
        data: [{ xAxis: 0 }, { yAxis: 0 }],
      },
    }],
    graphic: [
      { type: "text", left: "62%", top: "18%", style: { text: "两边加多", fill: "#ef444480", fontSize: 11 } },
      { type: "text", left: "18%", top: "18%", style: { text: "量化减 / 主观加", fill: "#64748b80", fontSize: 11 } },
      { type: "text", left: "18%", top: "72%", style: { text: "两边减多", fill: "#ec489980", fontSize: 11 } },
      { type: "text", left: "62%", top: "72%", style: { text: "量化加 / 主观减", fill: "#64748b80", fontSize: 11 } },
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
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => `${Number(v).toFixed(1)}%`,
    },
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
  const [asOf, setAsOf] = useState("")

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
    if (asOf) qs.set("date", asOf)
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
        if (asOf && j.date && j.date !== asOf) setAsOf(j.date)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [quantIds, asOf])

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
          "risk",
          data.quantShare,
          data.groups?.quant.nAccounts ?? 0,
          data.groups?.subjective.nAccounts ?? 0,
          data.flows,
        )
      : [],
    [data, sectors, products],
  )
  const signalHistory = useMemo(
    () => buildSignalHistory(
      data?.sectorTs ?? [],
      data?.productTs ?? [],
      (code) =>
        products.find((p) => p.key === code)?.name
        ?? data?.holdingTs?.products.find((p) => p.code === code)?.name
        ?? code,
      flowSrcFromHolding(data?.holdingTs),
    ),
    [data?.sectorTs, data?.productTs, data?.holdingTs, products],
  )
  const prevDay = useMemo(() => {
    if (!data?.date || !signalHistory.length) return undefined
    for (let i = signalHistory.length - 1; i >= 0; i--) {
      if (signalHistory[i].date < data.date) return signalHistory[i]
    }
    return undefined
  }, [data?.date, signalHistory])
  const prevExposure = useMemo(() => {
    const map = new Map<string, { q: number; s: number }>()
    const date = prevDay?.date
    if (!date) return map
    for (const r of data?.sectorTs ?? []) {
      if (r.date === date) map.set(signalRowKey("sector", r.sector), { q: r.quantNetPct, s: r.subjNetPct })
    }
    for (const r of data?.productTs ?? []) {
      if (r.date === date) map.set(signalRowKey("product", r.product), { q: r.quantNetPct, s: r.subjNetPct })
    }
    return map
  }, [data?.sectorTs, data?.productTs, prevDay?.date])
  const { tagged: taggedSignals, gone: goneSignals } = useMemo(
    () => tagSignalsVsPrev(allSignals, prevDay?.items),
    [allSignals, prevDay],
  )
  const signals = taggedSignals
    .filter((s) => signalFilter === "all" || s.action === signalFilter)
    .slice()
    .sort(compareByAction)
  const goneFiltered = goneSignals
    .filter((s) => signalFilter === "all" || s.action === signalFilter)
    .slice()
    .sort(compareByAction)
  const comparable = taggedSignals.filter((s) => s.level !== "allocation")
  const nNew = comparable.filter((s) => s.vsPrev === "new").length
  const nChanged = comparable.filter((s) => s.vsPrev === "changed").length
  const nSame = comparable.filter((s) => s.vsPrev === "same").length
  const tradingDates = signalHistory.map((d) => d.date)
  const dateIdx = data?.date ? tradingDates.indexOf(data.date) : -1
  const latestDate = data?.latestDate ?? data?.date ?? ""
  const viewingLatest = !asOf || asOf === latestDate
  const pickDate = (d: string) => {
    if (!d || d === asOf) return
    if (!asOf && d === data?.date) return
    setAsOf(d)
  }
  const rowSignal = (row: CompareRow) => classifyExposure(row.quant, row.subjective, "risk").signal
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
  const axisName = metric === "risk" ? "占本组风险预算 %" : "占本组保证金占用 %"
  const unitHint = metric === "risk" ? "风险敞口占比" : "保证金占用占比"
  const barHint = metric === "risk"
    ? `${axisName} · 正=净多 负=净空 · 截面 ${data?.date ?? ""}`
    : `${axisName} · 各板块合计约 100% · 截面 ${data?.date ?? ""}`
  const scatterHint = metric === "risk"
    ? `横轴量化、纵轴主观（${unitHint}）；第一/三象限为共识，二/四象限为分歧。`
    : `横轴量化、纵轴主观（${unitHint}）；右上=两边都配。点颜色仍按风险方向。`
  const tsHint = metric === "risk"
    ? `近 45 日 · ${unitHint} · 两边曲线贴在一起且远离 0 线 = 持续共识；交叉变号 = 共识破裂`
    : `近 45 日 · ${unitHint} · 各板块占用合计约 100%，曲线表示该板块占本组的份额`

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
            `量化风险 ${fmtPct(row.quant.riskPctGroup)}　保证金 ${fmtPct(row.quant.equityPctGroup, false)}`,
            `主观风险 ${fmtPct(row.subjective.riskPctGroup)}　保证金 ${fmtPct(row.subjective.equityPctGroup, false)}`,
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
            `量化风险 ${fmtPct(row.quant.riskPctGroup)}　保证金 ${fmtPct(row.quant.equityPctGroup, false)}`,
            `主观风险 ${fmtPct(row.subjective.riskPctGroup)}　保证金 ${fmtPct(row.subjective.equityPctGroup, false)}`,
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

  const sectorFlowScatter = useMemo(() => {
    const flows = data?.flows
    return buildFlowScatterOption(sectors.map((r) => {
      const q = r.quant.riskPctGroup
      const s = r.subjective.riskPctGroup
      const rowFlow = lookupFlow(flows, "sector", r.key)
      return {
        name: r.name,
        tooltip: r.name,
        qStock: q,
        sStock: s,
        flow: rowFlow ? classifyRowFlow(q, s, rowFlow) : null,
      }
    }))
  }, [sectors, data?.flows])

  const productFlowScatter = useMemo(() => {
    const flows = data?.flows
    return buildFlowScatterOption(products.slice(0, 40).map((r) => {
      const q = r.quant.riskPctGroup
      const s = r.subjective.riskPctGroup
      const rowFlow = lookupFlow(flows, "product", r.key)
      return {
        name: r.name,
        tooltip: `${r.name}(${r.key})`,
        qStock: q,
        sStock: s,
        flow: rowFlow ? classifyRowFlow(q, s, rowFlow) : null,
      }
    }))
  }, [products, data?.flows])

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
          { name: "量化", value: g.quant.margin, itemStyle: { color: QUANT_COLOR } },
          { name: "主观", value: g.subjective.margin, itemStyle: { color: SUBJ_COLOR } },
        ],
      }],
    }
  }, [data?.groups])

  const nConsensus = allSignals.filter((s) => s.action === "加码").length
  const nDiv = allSignals.filter((s) => s.action === "观望").length
  const nPause = allSignals.filter((s) => s.action === "暂缓加码").length
  const nTrim = allSignals.filter((s) => s.action === "减码准备").length

  const countHistoryOption = useMemo(() => {
    if (!signalHistory.length) return {}
    const dates = signalHistory.map((d) => d.date)
    const zoomStart = Math.max(0, 100 - 8000 / Math.max(dates.length, 1))
    const actions: ActionKind[] = ["加码", "暂缓加码", "减码准备", "观望", "补风格", "控拥挤"]
    const markIdx = data?.date ? dates.indexOf(data.date) : -1
    return {
      grid: { left: 40, right: 16, top: 28, bottom: 48 },
      legend: { top: 2, right: 8, textStyle: { fontSize: 11 }, data: actions },
      tooltip: { trigger: "axis" },
      dataZoom: [
        { type: "inside", start: zoomStart, end: 100 },
        { type: "slider", height: 14, bottom: 6, start: zoomStart, end: 100, textStyle: { fontSize: 9 } },
      ],
      xAxis: {
        type: "category",
        data: dates.map((d) => d.slice(5)),
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        name: "条数",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      },
      series: actions.map((action) => ({
        name: action,
        type: "bar",
        stack: "sig",
        barMaxWidth: 10,
        data: signalHistory.map((d) => d.counts[action]),
        itemStyle: { color: ACTION_STACK_COLOR[action] },
        markLine: markIdx >= 0 && action === "加码"
          ? {
              symbol: "none",
              silent: true,
              label: { formatter: data?.date?.slice(5) ?? "", fontSize: 10 },
              lineStyle: { color: "#334155", type: "dashed", width: 1.2 },
              data: [{ xAxis: markIdx }],
            }
          : undefined,
      })),
    }
  }, [signalHistory, data?.date])

  const sectorHeatOption = useMemo(() => {
    if (!signalHistory.length) return {}
    const dates = signalHistory.map((d) => d.date)
    const present = new Set<string>()
    for (const day of signalHistory) {
      for (const it of day.items) {
        if (it.level === "sector") present.add(it.key)
      }
    }
    const sectorsY = SECTOR_ORDER.filter((s) => present.has(s))
    for (const s of present) {
      if (!sectorsY.includes(s)) sectorsY.push(s)
    }
    if (!sectorsY.length) return {}
    const heat: [number, number, number][] = []
    signalHistory.forEach((day, xi) => {
      for (const it of day.items) {
        if (it.level !== "sector") continue
        const yi = sectorsY.indexOf(it.key)
        if (yi < 0) continue
        heat.push([xi, yi, ACTION_HEAT_CODE[it.action]])
      }
    })
    const zoomStart = Math.max(0, 100 - 8000 / Math.max(dates.length, 1))
    return {
      grid: { left: 72, right: 16, top: 36, bottom: 48 },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const item = (Array.isArray(p) ? p[0] : p) as { data?: unknown; value?: unknown } | undefined
          const tuple = item?.data ?? item?.value
          if (!Array.isArray(tuple) || tuple.length < 3) return ""
          const [xi, yi, code] = tuple as [number, number, number]
          const date = dates[xi]
          const sector = sectorsY[yi]
          if (date == null || sector == null) return ""
          const action = (Object.entries(ACTION_HEAT_CODE).find(([, v]) => v === code)?.[0] ?? "") as string
          return `${date}<br/>${sector}　${action}`
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: zoomStart, end: 100 },
        { type: "slider", xAxisIndex: 0, height: 14, bottom: 6, start: zoomStart, end: 100, textStyle: { fontSize: 9 } },
      ],
      xAxis: {
        type: "category",
        data: dates.map((d) => d.slice(5)),
        axisLabel: { fontSize: 10 },
        splitArea: { show: false },
      },
      yAxis: {
        type: "category",
        data: sectorsY,
        axisLabel: { fontSize: 10 },
        inverse: true,
      },
      visualMap: {
        type: "piecewise",
        orient: "horizontal",
        left: "center",
        top: 4,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10 },
        pieces: [
          { value: 1, label: "加码", color: ACTION_STACK_COLOR.加码 },
          { value: 6, label: "暂缓加码", color: ACTION_STACK_COLOR.暂缓加码 },
          { value: 7, label: "减码准备", color: ACTION_STACK_COLOR.减码准备 },
          { value: 2, label: "观望", color: ACTION_STACK_COLOR.观望 },
          { value: 3, label: "补风格", color: ACTION_STACK_COLOR.补风格 },
          { value: 4, label: "控拥挤", color: ACTION_STACK_COLOR.控拥挤 },
        ],
      },
      series: [{
        type: "heatmap",
        data: heat,
        itemStyle: { borderColor: "transparent", borderWidth: 0 },
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: "rgba(0,0,0,0.25)" } },
      }],
    }
  }, [signalHistory])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            拖动右侧账户可划分量化 / 主观，本页全部图表会按新口径重算。风险敞口 = 净名义市值 × 近{data?.volDays ?? 20}日品种波动率，占比为占本组风险预算（|σ×净市值| 之和）。
            保证金% = 该板块（或品种）持仓保证金 / 本组持仓保证金合计，量化、主观各自加总约 100%。国债等名义市值大、波动低的品种，风险占比会明显低于保证金占比。切换「风险敞口 / 保证金」会重算图表和对照表；决策信号始终按风险口径。资金分配按账户保证金占用（开仓实际占用），不以客户权益（名义资本）计。
          </p>
          {data?.date && (
            <p className="text-xs text-muted-foreground mt-1">
              持仓截面 {data.date}{viewingLatest ? "（最新）" : ` · 最新 ${latestDate}`}
              {data.missingQuantIds?.length ? `　未找到量化账户：${data.missingQuantIds.join("、")}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="上一交易日"
              disabled={dateIdx <= 0 || loading}
              onClick={() => dateIdx > 0 && pickDate(tradingDates[dateIdx - 1])}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <DateInput
              value={asOf || data?.date || ""}
              onChange={pickDate}
              placeholder="请选择日期"
              min={tradingDates[0]}
              max={latestDate || undefined}
              className="w-[148px]"
              inputClassName="h-8 rounded-md px-2 pr-8 text-xs"
              displayClassName="left-2 text-xs"
            />
            <button
              type="button"
              aria-label="下一交易日"
              disabled={dateIdx < 0 || dateIdx >= tradingDates.length - 1 || loading}
              onClick={() => dateIdx >= 0 && dateIdx < tradingDates.length - 1 && pickDate(tradingDates[dateIdx + 1])}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button
              size="sm"
              variant={viewingLatest ? "outline" : "default"}
              disabled={viewingLatest || loading}
              onClick={() => setAsOf("")}
            >
              最新
            </Button>
          </div>
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
              保证金
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi title="量化保证金" value={data ? fmtYi(data.groups?.quant.margin ?? 0) : "—"} hint={data ? `${data.groups?.quant.nAccounts ?? 0} 户 · 占比 ${fmtPct(data.quantShare, false)}` : ""} accent={QUANT_COLOR} help={<HelpQuantMargin />} />
        <Kpi title="主观保证金" value={data ? fmtYi(data.groups?.subjective.margin ?? 0) : "—"} hint={data ? `${data.groups?.subjective.nAccounts ?? 0} 户 · 占比 ${fmtPct(100 - (data.quantShare ?? 0), false)}` : ""} accent={SUBJ_COLOR} help={<HelpSubjMargin />} />
        <Kpi title="共识加码" value={loading ? "…" : String(nConsensus)} hint="存量同向且边际同向加仓" help={<HelpConsensusKpi />} />
        <Kpi title="暂缓加码" value={loading ? "…" : String(nPause)} hint="存量同向、边际反向" help={<HelpMarginKpi />} />
        <Kpi title="减码准备" value={loading ? "…" : String(nTrim)} hint="存量同向、两侧都在减" help={<HelpMarginKpi />} />
        <Kpi title="方向分歧" value={loading ? "…" : String(nDiv)} hint="暂不加该方向 beta" help={<HelpDivKpi />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="relative min-h-[280px] lg:col-span-2 lg:min-h-0">
          <Card className="flex h-full max-h-[70vh] flex-col overflow-hidden lg:absolute lg:inset-0 lg:max-h-none">
            <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-sm font-medium">MOM 决策信号</CardTitle>
                  <HelpSignals />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  风险口径 · {data?.date ?? "—"}
                  {prevDay ? ` · 对比上一交易日 ${prevDay.date}` : ""}
                  · 悬停看完整解读
                </p>
                {prevDay && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    新增 {nNew} · 变化 {nChanged} · 维持 {nSame} · 消失 {goneSignals.length}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(["all", ...ACTION_ORDER] as const).map((k) => (
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
            ) : (
              <MomSignalTable
                signals={signals}
                prevExposure={prevExposure}
                gone={goneFiltered}
                showPrevChange={Boolean(prevDay)}
                activeKey={holdingFocus ? `${holdingFocus.level}:${holdingFocus.key}` : undefined}
                onRowClick={(s) => {
                  if (s.level !== "product" && s.level !== "sector") return
                  setHoldingFocus({ level: s.level, key: s.key })
                  document.getElementById("section-holding-ts")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
              />
            )}
          </CardContent>
          </Card>
        </div>

        <div className="flex h-full flex-col gap-3">
          <Card>
            <CardHeader className="pb-1 flex flex-row items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-sm font-medium">资金在量化 / 主观之间的分配</CardTitle>
                  <HelpPie />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">保证金占用合计 · {data?.date ?? ""}</p>
              </div>
              <button
                type="button"
                onClick={() => persistQuantIds([...QUANT_ACCOUNT_IDS])}
                className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
              >
                恢复默认
              </button>
            </CardHeader>
            <CardContent className="pt-0">
              {data?.groups ? (
                <ReactECharts option={pieOption} style={{ height: 220, width: "100%" }} notMerge />
              ) : (
                <div className="h-[220px]" />
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

      {signalHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-sm font-medium">决策信号历史</CardTitle>
                  <HelpSignalHistory />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  每日按同一风险阈值重算 · 点击柱或色块切换截面日期
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            <ReactECharts
              option={countHistoryOption}
              style={{ height: 240, width: "100%" }}
              notMerge
              onEvents={{
                click: (params: { dataIndex?: number }) => {
                  const idx = params.dataIndex
                  if (idx != null && tradingDates[idx]) pickDate(tradingDates[idx])
                },
              }}
            />
            <ReactECharts
              option={sectorHeatOption}
              style={{ height: Math.max(220, 28 + 22 * Math.min(11, SECTOR_ORDER.length)), width: "100%" }}
              notMerge
              onEvents={{
                click: (params: { data?: [number, number, number] }) => {
                  const idx = params.data?.[0]
                  if (idx != null && tradingDates[idx]) pickDate(tradingDates[idx])
                },
              }}
            />
          </CardContent>
        </Card>
      )}

      <QuantVsSubjectiveHoldingTs
        holdingTs={data?.holdingTs}
        metric={metric}
        focus={holdingFocus}
        sectorTs={data?.sectorTs}
        productTs={data?.productTs}
        flows={data?.flows}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">板块风险敞口：量化 vs 主观</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{barHint}</p>
              </div>
              <HelpSectorBar metric={metric} volDays={data?.volDays ?? 20} />
            </div>
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
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">板块方向共识散点</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{scatterHint}</p>
              </div>
              <HelpScatter metric={metric} volDays={data?.volDays ?? 20} level="板块" />
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`sector-scatter-${metric}`} option={sectorScatterOption} style={{ height: 360, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">板块边际散点</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">横轴量化 1 日主动调仓、纵轴主观。第二象限 = 量化减多 / 主观加多（边际背离）。</p>
              </div>
              <HelpFlowScatter level="板块" />
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts option={sectorFlowScatter} style={{ height: 360, width: "100%" }} notMerge />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">品种边际散点</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">点大小按存量风险%；颜色是边际标签。主动调仓 = 手数变化 × 当日价，不含价格涨跌。</p>
              </div>
              <HelpFlowScatter level="品种" />
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts option={productFlowScatter} style={{ height: 360, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">品种风险敞口对比</CardTitle>
                <HelpProductBar metric={metric} volDays={data?.volDays ?? 20} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {metric === "risk"
                  ? "按当前口径 |量化%| + |主观%| 排序 · 同向且都大 → 共识加码；反向 → 观望"
                  : "按当前口径 量化% + 主观% 排序 · 保证金占用占比，各组合计约 100%"}
              </p>
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
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">品种方向共识散点</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{scatterHint}</p>
              </div>
              <HelpScatter metric={metric} volDays={data?.volDays ?? 20} level="品种" />
            </div>
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
              <p className="text-xs text-muted-foreground mt-0.5">{tsHint}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={tsSector}
                onChange={(e) => setTsSector(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {tsSectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <HelpTs metric={metric} volDays={data?.volDays ?? 20} level="板块" />
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`ts-${metric}-${tsSector}`} option={tsOption} style={{ height: 280, width: "100%" }} notMerge />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-medium">品种风险敞口时序</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{tsHint}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={tsProd}
                onChange={(e) => setTsProd(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs max-w-[160px]"
              >
                {tsProds.map((p) => <option key={p.code} value={p.code}>{p.name}({p.code})</option>)}
              </select>
              <HelpTs metric={metric} volDays={data?.volDays ?? 20} level="品种" />
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <ReactECharts key={`prod-ts-${metric}-${tsProd}`} option={prodTsOption} style={{ height: 280, width: "100%" }} notMerge />
          </CardContent>
        </Card>
      </div>

      {sectors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">板块对照表</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">风险% = 占本组风险预算；保证金% = 该板块持仓保证金 / 本组持仓保证金合计（各自约 100%）。解读按风险口径。</p>
              </div>
              <HelpSectorTable volDays={data?.volDays ?? 20} />
            </div>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">板块</th>
                  <th className="text-right py-2 font-medium">量化风险%</th>
                  <th className="text-right py-2 font-medium">主观风险%</th>
                  <th className="text-right py-2 font-medium">量化保证金%</th>
                  <th className="text-right py-2 font-medium">主观保证金%</th>
                  <th className="text-left py-2 pl-3 font-medium">解读</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map((r) => (
                  <tr key={r.key} className="border-b border-border/60">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.quant.riskPctGroup)}`}>{fmtPct(r.quant.riskPctGroup)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pctClass(r.subjective.riskPctGroup)}`}>{fmtPct(r.subjective.riskPctGroup)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(r.quant.equityPctGroup, false)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(r.subjective.equityPctGroup, false)}</td>
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
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium">品种对照表</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">年化波动 = 近{data?.volDays ?? 20}日收益标准差 × √252。国债波动低，同样保证金占比对应更小风险。</p>
              </div>
              <HelpProductTable volDays={data?.volDays ?? 20} />
            </div>
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
                  <th className="text-right py-2 font-medium">量化保证金%</th>
                  <th className="text-right py-2 font-medium">主观保证金%</th>
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
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(r.quant.equityPctGroup, false)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(r.subjective.equityPctGroup, false)}</td>
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

function signalLabel(s: string): string {
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

function Kpi({ title, value, hint, accent, help }: { title: string; value: string; hint: string; accent?: string; help?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
          {help}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}
