"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ExposureRow = { date: string } & Record<string, number | string>

const CATS = ["商品", "股指", "国债"] as const
const SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债"] as const
const CAT_TO_SECTORS: Record<string, readonly string[]> = {
  商品: ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运"],
  股指: ["股指"],
  国债: ["国债"],
}
const SECTOR_TO_SUB: Record<string, readonly string[]> = {
  农产: ["谷物", "油脂油料", "软商品", "林业"],
  生鲜: ["生鲜"],
  贵金属: ["贵金属"],
  有色: ["有色"],
  新能源: ["新能源"],
  黑色: ["原材", "成材", "煤炭", "建材"],
  能源化工: ["油品", "聚酯", "烯烃", "芳烃", "橡胶", "盐化工", "煤化工"],
  航运: ["航运"],
  股指: ["股指"],
  国债: ["国债"],
}
const PROD_CAT: Record<string, string> = {
  C: "商品", CS: "商品", WH: "商品", PM: "商品", RR: "商品", RI: "商品", JR: "商品", LR: "商品",
  A: "商品", B: "商品", M: "商品", Y: "商品", RM: "商品", OI: "商品", RS: "商品", PK: "商品", P: "商品",
  SR: "商品", CF: "商品", CY: "商品", LG: "商品", SP: "商品", OP: "商品",
  AP: "商品", CJ: "商品", LH: "商品", JD: "商品",
  AU: "商品", AG: "商品", PT: "商品", PD: "商品",
  CU: "商品", BC: "商品", AL: "商品", AO: "商品", AD: "商品", ZN: "商品", PB: "商品", NI: "商品", SN: "商品",
  LC: "商品", PS: "商品", SI: "商品",
  I: "商品", SF: "商品", SM: "商品", RB: "商品", HC: "商品", SS: "商品", WR: "商品",
  JM: "商品", J: "商品", ZC: "商品", FG: "商品", BB: "商品", FB: "商品",
  SC: "商品", FU: "商品", LU: "商品", PG: "商品", BU: "商品",
  TA: "商品", EG: "商品", PF: "商品", PR: "商品", PL: "商品", PP: "商品", L: "商品",
  BZ: "商品", PX: "商品", EB: "商品", RU: "商品", BR: "商品", NR: "商品",
  SA: "商品", SH: "商品", V: "商品", UR: "商品", MA: "商品", EC: "商品",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
const PROD_SECTOR: Record<string, string> = {
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工", PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工", RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工", UR: "能源化工", MA: "能源化工", EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
const PROD_SUB: Record<string, string> = {
  C: "谷物", CS: "谷物", WH: "谷物", PM: "谷物", RR: "谷物", RI: "谷物", JR: "谷物", LR: "谷物",
  A: "油脂油料", B: "油脂油料", M: "油脂油料", Y: "油脂油料", RM: "油脂油料", OI: "油脂油料", RS: "油脂油料", PK: "油脂油料", P: "油脂油料",
  SR: "软商品", CF: "软商品", CY: "软商品", LG: "林业", SP: "林业", OP: "林业",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "原材", SF: "原材", SM: "原材", RB: "成材", HC: "成材", SS: "成材", WR: "成材",
  JM: "煤炭", J: "煤炭", ZC: "煤炭", FG: "建材", BB: "建材", FB: "建材",
  SC: "油品", FU: "油品", LU: "油品", PG: "油品", BU: "油品",
  TA: "聚酯", EG: "聚酯", PF: "聚酯", PR: "聚酯", PL: "烯烃", PP: "烯烃", L: "烯烃",
  BZ: "芳烃", PX: "芳烃", EB: "芳烃", RU: "橡胶", BR: "橡胶", NR: "橡胶",
  SA: "盐化工", SH: "盐化工", V: "盐化工", UR: "煤化工", MA: "煤化工", EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
const PROD_NAMES: Record<string, string> = {
  C: "玉米", CS: "淀粉", A: "豆一", M: "豆粕", Y: "豆油", P: "棕榈油", SR: "白糖", CF: "棉花",
  AP: "苹果", LH: "生猪", JD: "鸡蛋", AU: "黄金", AG: "白银", CU: "沪铜", AL: "沪铝", ZN: "沪锌",
  NI: "沪镍", SN: "沪锡", LC: "碳酸锂", SI: "工业硅", I: "铁矿", RB: "螺纹", HC: "热卷",
  JM: "焦煤", J: "焦炭", FG: "玻璃", SC: "原油", FU: "燃油", TA: "PTA", MA: "甲醇",
  SA: "纯碱", UR: "尿素", RU: "橡胶", EC: "集运", IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000",
  T: "十年债", TF: "五年债", TS: "二年债", TL: "三十年债",
}

const EXPOSURE_SERIES = [
  { key: "long商品", name: "多-商品", stack: "long", cat: "商品", color: "#38bdf8" },
  { key: "long股指", name: "多-股指", stack: "long", cat: "股指", color: "#818cf8" },
  { key: "long国债", name: "多-国债", stack: "long", cat: "国债", color: "#2dd4bf" },
  { key: "short商品", name: "空-商品", stack: "short", cat: "商品", color: "#fb923c" },
  { key: "short股指", name: "空-股指", stack: "short", cat: "股指", color: "#f87171" },
  { key: "short国债", name: "空-国债", stack: "short", cat: "国债", color: "#e879f9" },
] as const

const VAR_SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"] as const
const VAR_SUBS = ["谷物", "油脂油料", "软商品", "林业", "生鲜", "贵金属", "有色", "新能源", "原材", "成材", "煤炭", "建材", "油品", "聚酯", "烯烃", "芳烃", "橡胶", "盐化工", "煤化工", "航运", "股指", "国债", "其他"] as const
const SECTOR_COLORS: Record<string, string> = {
  农产: "#a3e635", 生鲜: "#fb7185", 贵金属: "#fbbf24", 有色: "#fb923c", 新能源: "#34d399",
  黑色: "#60a5fa", 能源化工: "#f97316", 航运: "#8b5cf6", 股指: "#c084fc", 国债: "#ef4444", 其他: "#94a3b8",
  商品: "#fb923c",
  谷物: "#84cc16", 油脂油料: "#a3e635", 软商品: "#facc15", 林业: "#86efac",
  原材: "#38bdf8", 成材: "#60a5fa", 煤炭: "#6366f1", 建材: "#a78bfa",
  油品: "#f87171", 聚酯: "#2dd4bf", 烯烃: "#0ea5e9", 芳烃: "#e879f9",
  橡胶: "#f472b6", 盐化工: "#c084fc", 煤化工: "#818cf8",
}

type VarPayload = {
  dates: string[]
  catData: Record<string, number[]>
  sectorData: Record<string, number[]>
  subSectorData: Record<string, number[]>
}

function dayKey(date: string): string {
  return date.slice(0, 10)
}

function moneyScale(maxAbs: number): { div: number; suffix: string; digits: number } {
  if (maxAbs >= 1e8) return { div: 1e8, suffix: "亿", digits: 2 }
  if (maxAbs >= 1e4) return { div: 1e4, suffix: "万", digits: 1 }
  return { div: 1, suffix: "元", digits: 0 }
}

export function QuantTraderExposureCharts({
  accountId,
  from,
  to,
}: {
  accountId: string
  from: string
  to: string
}) {
  const [series, setSeries] = useState<ExposureRow[]>([])
  const [varPayload, setVarPayload] = useState<VarPayload | null>(null)
  const [mvLoading, setMvLoading] = useState(true)
  const [varLoading, setVarLoading] = useState(true)
  const [mvError, setMvError] = useState("")
  const [varError, setVarError] = useState("")
  const [cat, setCat] = useState("全部")
  const [sector, setSector] = useState("全部")
  const [sub, setSub] = useState("全部")
  const [prod, setProd] = useState("全部")
  const [varMode, setVarMode] = useState<"大类" | "板块" | "细分">("板块")

  useEffect(() => {
    let cancelled = false
    setMvLoading(true)
    setVarLoading(true)
    setMvError("")
    setVarError("")
    fetch(`/ma/api/mom-analysis/category-exposure?account=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (!j.ok) setMvError(j.error || "持仓市值没有取到")
        else setSeries(j.series ?? [])
      })
      .catch(() => { if (!cancelled) setMvError("持仓市值没有取到") })
      .finally(() => { if (!cancelled) setMvLoading(false) })
    fetch(`/ma/api/mom-analysis/var-sector-timeseries?account=${encodeURIComponent(accountId)}&corrDays=252`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (!j.ok) setVarError(j.error || "持仓 VaR 没有取到")
        else setVarPayload({ dates: j.dates ?? [], catData: j.catData ?? {}, sectorData: j.sectorData ?? {}, subSectorData: j.subSectorData ?? {} })
      })
      .catch(() => { if (!cancelled) setVarError("持仓 VaR 没有取到") })
      .finally(() => { if (!cancelled) setVarLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  const ranged = useMemo(
    () => series.filter((row) => {
      const d = dayKey(String(row.date))
      return d >= from && d <= to
    }),
    [series, from, to],
  )

  const sectorChoices = cat === "全部" ? SECTORS : (CAT_TO_SECTORS[cat] ?? [])
  const subChoices = sector !== "全部"
    ? (SECTOR_TO_SUB[sector] ?? [])
    : cat !== "全部"
      ? (CAT_TO_SECTORS[cat] ?? []).flatMap((s) => SECTOR_TO_SUB[s] ?? [])
      : Object.values(SECTOR_TO_SUB).flat()

  const products = useMemo(() => {
    const used = new Set<string>()
    for (const row of ranged) {
      for (const key of Object.keys(row)) {
        if (!key.startsWith("long_p_") && !key.startsWith("short_p_")) continue
        if (!Number(row[key])) continue
        used.add(key.slice(key.indexOf("_p_") + 3))
      }
    }
    return [...used].filter((code) => {
      if (sub !== "全部") return PROD_SUB[code] === sub
      if (sector !== "全部") return PROD_SECTOR[code] === sector
      if (cat !== "全部") return PROD_CAT[code] === cat
      return true
    }).sort()
  }, [ranged, cat, sector, sub])

  const visible = useMemo(() => (
    prod !== "全部"
      ? [
          { key: `long_p_${prod}`, name: "多", stack: "long", color: "#38bdf8" },
          { key: `short_p_${prod}`, name: "空", stack: "short", color: "#fb923c" },
        ]
      : sub !== "全部"
        ? [
            { key: `long_ss_${sub}`, name: "多", stack: "long", color: "#38bdf8" },
            { key: `short_ss_${sub}`, name: "空", stack: "short", color: "#fb923c" },
          ]
        : sector !== "全部"
          ? [
              { key: `long_s_${sector}`, name: "多", stack: "long", color: "#38bdf8" },
              { key: `short_s_${sector}`, name: "空", stack: "short", color: "#fb923c" },
            ]
          : EXPOSURE_SERIES.filter((c) => cat === "全部" || c.cat === cat)
  ), [cat, sector, sub, prod])

  const exposureOption = useMemo(() => {
    if (!ranged.length) return null
    const dates = ranged.map((r) => dayKey(String(r.date)))
    const net = ranged.map((r) => visible.reduce((sum, c) => sum + (Number(r[c.key]) || 0), 0))
    let maxAbs = 0
    for (const row of ranged) {
      for (const c of visible) maxAbs = Math.max(maxAbs, Math.abs(Number(row[c.key]) || 0))
    }
    for (const v of net) maxAbs = Math.max(maxAbs, Math.abs(v))
    const scale = moneyScale(maxAbs || 1)
    const fmt = (v: number) => `${v < 0 ? "-" : ""}${(Math.abs(v) / scale.div).toFixed(scale.digits)}${scale.suffix}`
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const longTotal = params.filter((p) => p.seriesName === "多" || p.seriesName.startsWith("多-")).reduce((s, p) => s + p.value, 0)
          const shortTotal = params.filter((p) => p.seriesName === "空" || p.seriesName.startsWith("空-")).reduce((s, p) => s + Math.abs(p.value), 0)
          const netV = params.find((p) => p.seriesName === "净持仓")?.value ?? (longTotal - shortTotal)
          return [
            date,
            `多头合计 ${fmt(longTotal)}`,
            `空头合计 ${fmt(shortTotal)}`,
            `净持仓 ${fmt(netV)}`,
          ].join("<br/>")
        },
      },
      legend: { top: 4, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 64, right: 64, top: 36, bottom: 48 },
      dataZoom: [
        { type: "inside" as const },
        { type: "slider" as const, height: 16, bottom: 4 },
      ],
      xAxis: { type: "category" as const, data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: {
        type: "value" as const,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${(v / scale.div).toFixed(scale.digits)}${scale.suffix}` },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: [
        ...visible.map((c) => ({
          name: c.name,
          type: "bar" as const,
          stack: c.stack,
          data: ranged.map((r) => Number(r[c.key]) || 0),
          itemStyle: { color: c.color },
        })),
        {
          name: "净持仓",
          type: "line" as const,
          data: net,
          symbol: "none",
          lineStyle: { color: "#dc2626", width: 2 },
          itemStyle: { color: "#dc2626" },
          endLabel: {
            show: true,
            formatter: (p: { value: number }) => fmt(p.value),
            color: "#dc2626",
            fontSize: 11,
            fontWeight: "bold" as const,
          },
          z: 10,
        },
      ],
    }
  }, [ranged, visible])

  const varOption = useMemo(() => {
    if (!varPayload?.dates.length) return null
    const groups = varMode === "大类" ? CATS : varMode === "板块" ? VAR_SECTORS : VAR_SUBS
    const raw = varMode === "大类" ? varPayload.catData : varMode === "板块" ? varPayload.sectorData : varPayload.subSectorData
    const kept: number[] = []
    const dates: string[] = []
    varPayload.dates.forEach((date, i) => {
      const d = dayKey(date)
      if (d >= from && d <= to) {
        kept.push(i)
        dates.push(d)
      }
    })
    if (!dates.length) return null
    const data: Record<string, number[]> = {}
    for (const g of groups) data[g] = kept.map((i) => raw[g]?.[i] ?? 0)
    const active = groups.filter((g) => data[g]?.some((v) => v > 0))
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
            .map((p) => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 4, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 52, right: 16, top: 36, bottom: 48 },
      dataZoom: [
        { type: "inside" as const },
        { type: "slider" as const, height: 16, bottom: 4 },
      ],
      xAxis: { type: "category" as const, data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: active.map((g) => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: SECTOR_COLORS[g] ?? "#94a3b8" },
        lineStyle: { width: 0 },
        itemStyle: { color: SECTOR_COLORS[g] ?? "#94a3b8" },
        symbol: "none",
        data: data[g],
        emphasis: { focus: "series" as const },
      })),
    }
  }, [varPayload, varMode, from, to])

  const selectCls = "text-xs border border-border rounded px-2 py-0.5 bg-background"

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">持仓结构</h2>
        <span className="text-[11px] text-muted-foreground">{from} 至 {to}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">大类资产多空持仓市值</CardTitle>
            <select className={selectCls} value={cat} onChange={(e) => { setCat(e.target.value); setSector("全部"); setSub("全部"); setProd("全部") }}>
              <option value="全部">全部</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={selectCls} value={sector} onChange={(e) => { setSector(e.target.value); setSub("全部"); setProd("全部") }}>
              <option value="全部">全部板块</option>
              {sectorChoices.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={sub} onChange={(e) => { setSub(e.target.value); setProd("全部") }}>
              <option value="全部">全部细分</option>
              {subChoices.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={prod} onChange={(e) => setProd(e.target.value)}>
              <option value="全部">全部品种</option>
              {products.map((p) => <option key={p} value={p}>{p} {PROD_NAMES[p] ?? ""}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">多头在上，空头在下。红线是当前筛选下的净持仓。只含这个账户。</p>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {mvLoading ? <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
            : mvError ? <p className="text-sm text-destructive px-4 py-6">{mvError}</p>
            : !exposureOption ? <p className="text-sm text-muted-foreground px-4 py-6">这段没有持仓市值。</p>
            : <ReactECharts option={exposureOption} style={{ height: 340, width: "100%" }} notMerge />}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">持仓VaR走势（各板块VaR占比）</CardTitle>
            <div className="flex text-xs border border-border rounded overflow-hidden">
              {(["大类", "板块", "细分"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVarMode(mode)}
                  className={`px-2.5 py-0.5 ${varMode === mode ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
                >
                  {mode === "大类" ? "大类资产" : mode === "板块" ? "板块" : "细分板块"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">每个板块占这个账户组合方差的边际贡献。20 日波动，252 日相关，和日间风控 VaR 同一套公式。</p>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {varLoading ? <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
            : varError ? <p className="text-sm text-destructive px-4 py-6">{varError}</p>
            : !varOption ? <p className="text-sm text-muted-foreground px-4 py-6">这段没有 VaR。</p>
            : <ReactECharts key={varMode} option={varOption} style={{ height: 340, width: "100%" }} notMerge />}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
