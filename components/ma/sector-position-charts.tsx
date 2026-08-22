"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── constants (mirror of page.tsx) ──────────────────────────────────────────
const CAT_WEIGHT_GROUPS = ["商品", "股指", "国债"] as const
const EXPOSURE_SECTORS  = ["农产","生鲜","贵金属","有色","新能源","黑色","能源化工","航运","股指","国债"] as const
const EXPOSURE_SUB_SECTORS = ["谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债"] as const
const WEIGHT_SECTORS = ["农产","生鲜","贵金属","有色","新能源","黑色","能源化工","航运","股指","国债","其他"] as const
const SECTOR_COLORS: Record<string, string> = {
  农产:"#a3e635",生鲜:"#fb7185",贵金属:"#fbbf24",有色:"#fb923c",新能源:"#34d399",
  黑色:"#60a5fa",能源化工:"#f97316",航运:"#8b5cf6",股指:"#c084fc",国债:"#ef4444",其他:"#94a3b8",
}
const CAT_COLORS: Record<string, string> = { 商品:"#fb923c", 股指:"#818cf8", 国债:"#ef4444" }
const SUB_SECTOR_COLORS: Record<string, string> = {
  谷物:"#84cc16",油脂油料:"#a3e635",软商品:"#facc15",林业:"#86efac",
  生鲜:"#fb7185",贵金属:"#fbbf24",有色:"#fb923c",新能源:"#34d399",
  原材:"#38bdf8",成材:"#60a5fa",煤炭:"#6366f1",建材:"#a78bfa",
  油品:"#f87171",聚酯:"#2dd4bf",烯烃:"#0ea5e9",芳烃:"#e879f9",
  橡胶:"#f472b6",盐化工:"#c084fc",煤化工:"#818cf8",航运:"#8b5cf6",
  股指:"#d946ef",国债:"#ef4444",其他:"#94a3b8",
}

type BarMode = "大类" | "板块" | "细分"
type SortCol = "sector" | "longMv" | "longPct" | "shortMv" | "shortPct" | "netMv" | "netPctNorm"
type Sort = { col: SortCol; dir: "asc" | "desc" } | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExposureRow = Record<string, any> & { date: string }

interface SectorBarRow {
  sector: string
  longMv: number; longPct: number
  shortMv: number; shortPct: number
  netMv: number; netPctNorm: number
}

export default function SectorPositionCharts({ height = 300, capturing = false }: { height?: number; capturing?: boolean }) {
  const [series,     setSeries]     = useState<ExposureRow[]>([])
  const [capitalMap, setCapitalMap] = useState<Map<string, number>>(new Map())
  const [loading,    setLoading]    = useState(true)

  const [mode,    setMode]    = useState<BarMode>("板块")
  const [date,    setDate]    = useState<string>("")
  const [sort,    setSort]    = useState<Sort>({ col: "longMv", dir: "desc" })

  useEffect(() => {
    let done = 0
    const finish = () => { if (++done >= 1) setLoading(false) }

    fetch("/ma/api/mom-analysis/category-exposure")
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          const expSeries: ExposureRow[] = j.series ?? []
          setSeries(expSeries)
          const map = new Map<string, number>()
          for (const d of expSeries) {
            const eq = Number((d as Record<string, unknown>).equity ?? 0)
            if (Number.isFinite(eq) && eq > 0) map.set(d.date, eq)
          }
          setCapitalMap(map)
        }
      })
      .catch(() => {})
      .finally(finish)
  }, [])

  // ── VaR timeseries ──────────────────────────────────────────────────────
  const [varMode,      setVarMode]      = useState<BarMode>("板块")
  const [varView,      setVarView]      = useState<"weight"|"var"|"margvol"|"cvar">("var")
  const [weightCalc,   setWeightCalc]   = useState<"gross"|"net">("gross")

  const [varDates,     setVarDates]     = useState<string[]>([])
  const [varCatData,   setVarCatData]   = useState<Record<string, number[]>>({})
  const [varSecData,   setVarSecData]   = useState<Record<string, number[]>>({})
  const [varSubData,   setVarSubData]   = useState<Record<string, number[]>>({})
  const [varLoading,   setVarLoading]   = useState(true)

  const [mvDates,      setMvDates]      = useState<string[]>([])
  const [mvCatData,    setMvCatData]    = useState<Record<string, number[]>>({})
  const [mvSecData,    setMvSecData]    = useState<Record<string, number[]>>({})
  const [mvSubData,    setMvSubData]    = useState<Record<string, number[]>>({})
  const [mvLoading,    setMvLoading]    = useState(true)

  const [cvarDates,    setCvarDates]    = useState<string[]>([])
  const [cvarCatData,  setCvarCatData]  = useState<Record<string, number[]>>({})
  const [cvarSecData,  setCvarSecData]  = useState<Record<string, number[]>>({})
  const [cvarSubData,  setCvarSubData]  = useState<Record<string, number[]>>({})
  const [cvarLoading,  setCvarLoading]  = useState(true)

  useEffect(() => {
    fetch("/ma/api/mom-analysis/var-sector-timeseries?corrDays=252")
      .then(r => r.json())
      .then(j => { if (j.ok) { setVarDates(j.dates ?? []); setVarCatData(j.catData ?? {}); setVarSecData(j.sectorData ?? {}); setVarSubData(j.subSectorData ?? {}) } })
      .catch(() => {}).finally(() => setVarLoading(false))
  }, [])

  useEffect(() => {
    fetch("/ma/api/mom-analysis/marginal-vol-timeseries")
      .then(r => r.json())
      .then(j => { if (j.ok) { setMvDates(j.dates ?? []); setMvCatData(j.catData ?? {}); setMvSecData(j.sectorData ?? {}); setMvSubData(j.subSectorData ?? {}) } })
      .catch(() => {}).finally(() => setMvLoading(false))
  }, [])

  useEffect(() => {
    fetch("/ma/api/mom-analysis/cvar-sector-timeseries")
      .then(r => r.json())
      .then(j => { if (j.ok) { setCvarDates(j.dates ?? []); setCvarCatData(j.catData ?? {}); setCvarSecData(j.sectorData ?? {}); setCvarSubData(j.subSectorData ?? {}) } })
      .catch(() => {}).finally(() => setCvarLoading(false))
  }, [])

  const makeStackedOption = (
    dates: string[],
    rawData: Record<string, number[]>,
    groups: readonly string[],
    colorMap: Record<string, string>,
  ) => {
    if (dates.length === 0) return null
    const active = groups.filter(g => rawData[g]?.some(v => v > 0))
    const extra  = Object.keys(rawData).filter(g => !(groups as readonly string[]).includes(g) && rawData[g]?.some(v => v > 0))
    const all    = [...active, ...extra]
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const d = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params.filter(p => p.value > 0).sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [d, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 55, right: 15, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: { type: "category" as const, data: dates, axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: {
        type: "value" as const, min: 0, max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: all.map(g => ({
        name: g, type: "line" as const, stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: rawData[g] ?? dates.map(() => 0),
        emphasis: { focus: "series" as const },
      })),
    }
  }

  const varGroups:  readonly string[] = varMode === "大类" ? (CAT_WEIGHT_GROUPS as readonly string[]) : varMode === "板块" ? (WEIGHT_SECTORS as readonly string[]) : EXPOSURE_SUB_SECTORS
  const varColors = varMode === "大类" ? CAT_COLORS : varMode === "板块" ? SECTOR_COLORS : SUB_SECTOR_COLORS

  // weight timeseries computed from series (category-exposure)
  const weightOption = useMemo(() => {
    const groups = varMode === "大类" ? CAT_WEIGHT_GROUPS : varMode === "板块" ? WEIGHT_SECTORS : EXPOSURE_SUB_SECTORS
    const colorMap = varMode === "大类" ? CAT_COLORS : varMode === "板块" ? SECTOR_COLORS : SUB_SECTOR_COLORS
    const keyPrefix = varMode === "大类" ? "" : varMode === "板块" ? "s" : "ss"
    if (series.length === 0) return null
    const weightData: Record<string, number[]> = {}
    for (const g of groups) weightData[g] = []
    const wDates: string[] = []
    for (const r of series) {
      wDates.push(r.date)
      const mv: Record<string, number> = {}
      let total = 0
      for (const g of groups) {
        let lv: number, sv: number
        if (varMode === "大类") {
          lv = (r as Record<string, number>)[`long${g}`] ?? 0
          sv = (r as Record<string, number>)[`short${g}`] ?? 0
        } else {
          lv = (r as Record<string, number>)[`long_${keyPrefix}_${g}`] ?? 0
          sv = (r as Record<string, number>)[`short_${keyPrefix}_${g}`] ?? 0
        }
        const v = weightCalc === "net" ? Math.abs(lv + sv) : lv - sv
        mv[g] = v; total += v
      }
      for (const g of groups) weightData[g].push(total > 0 ? Math.round(mv[g] / total * 10000) / 100 : 0)
    }
    return makeStackedOption(wDates, weightData, groups, colorMap)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, varMode, weightCalc])

  const varChartOption = useMemo(() => {
    const rd = varMode === "大类" ? varCatData : varMode === "板块" ? varSecData : varSubData
    return makeStackedOption(varDates, rd, varGroups, varColors)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varMode, varDates, varCatData, varSecData, varSubData])

  const mvChartOption = useMemo(() => {
    const rd = varMode === "大类" ? mvCatData : varMode === "板块" ? mvSecData : mvSubData
    return makeStackedOption(mvDates, rd, varGroups, varColors)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varMode, mvDates, mvCatData, mvSecData, mvSubData])

  const cvarChartOption = useMemo(() => {
    const rd = varMode === "大类" ? cvarCatData : varMode === "板块" ? cvarSecData : cvarSubData
    return makeStackedOption(cvarDates, rd, varGroups, varColors)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varMode, cvarDates, cvarCatData, cvarSecData, cvarSubData])

  const varTitle =
    varView === "weight"  ? `持仓权重走势（${weightCalc === "net" ? "净市值/净总市值" : "总市值/期货总市值"}）`
    : varView === "var"   ? "持仓VaR走势（各板块VaR占比）"
    : varView === "margvol" ? "持仓边际波动率走势（各板块边际波动率占比）"
    : "持仓CVaR走势（各板块CVaR/ES贡献占比，历史模拟95%）"

  const varIsLoading =
    varView === "weight"  ? loading
    : varView === "var"   ? varLoading
    : varView === "margvol" ? mvLoading
    : cvarLoading

  const activeVarOption =
    varView === "weight"  ? weightOption
    : varView === "var"   ? varChartOption
    : varView === "margvol" ? mvChartOption
    : cvarChartOption

  const pickDateIdx = (dates: string[]) => {
    if (dates.length === 0) return -1
    if (date) {
      const exact = dates.indexOf(date)
      if (exact >= 0) return exact
      let best = -1
      for (let i = 0; i < dates.length; i++) if (dates[i] <= date) best = i
      if (best >= 0) return best
    }
    return dates.length - 1
  }

  // VaR / weighted-vol pct per sector for the selected table date
  const varLatestMap = useMemo<Record<string, number>>(() => {
    const rd = mode === "大类" ? varCatData : mode === "板块" ? varSecData : varSubData
    const idx = pickDateIdx(varDates)
    if (idx < 0) return {}
    const result: Record<string, number> = {}
    for (const [sector, vals] of Object.entries(rd)) result[sector] = vals[idx] ?? 0
    return result
  }, [mode, date, varDates, varCatData, varSecData, varSubData])

  const mvLatestMap = useMemo<Record<string, number>>(() => {
    const rd = mode === "大类" ? mvCatData : mode === "板块" ? mvSecData : mvSubData
    const idx = pickDateIdx(mvDates)
    if (idx < 0) return {}
    const result: Record<string, number> = {}
    for (const [sector, vals] of Object.entries(rd)) result[sector] = vals[idx] ?? 0
    return result
  }, [mode, date, mvDates, mvCatData, mvSecData, mvSubData])

  const rows = useMemo<SectorBarRow[]>(() => {
    let row: ExposureRow | undefined
    if (date) row = series.find(r => r.date === date)
    if (!row) row = series[series.length - 1]
    if (!row) return []

    let capital = 0
    const rowIdx = series.indexOf(row)
    for (let i = rowIdx; i >= 0; i--) {
      const c = capitalMap.get(series[i].date)
      if (c && c > 0) { capital = c; break }
    }

    const groups: readonly string[] =
      mode === "大类" ? CAT_WEIGHT_GROUPS
      : mode === "板块" ? EXPOSURE_SECTORS
      : EXPOSURE_SUB_SECTORS

    const raw = groups.map(g => {
      let lv: number, sv: number
      if (mode === "大类") {
        lv = row![`long${g}`] ?? 0
        sv = row![`short${g}`] ?? 0
      } else if (mode === "板块") {
        lv = row![`long_s_${g}`] ?? 0
        sv = row![`short_s_${g}`] ?? 0
      } else {
        lv = row![`long_ss_${g}`] ?? 0
        sv = row![`short_ss_${g}`] ?? 0
      }
      const absShort = Math.abs(sv)
      const net = lv + sv
      return {
        sector: g,
        longMv: lv,
        longPct: capital > 0 ? lv / capital * 100 : 0,
        shortMv: absShort,
        shortPct: capital > 0 ? absShort / capital * 100 : 0,
        netMv: net,
        netPctNorm: 0,
      }
    })
    const totalAbsNet = raw.reduce((s, r) => s + Math.abs(r.netMv), 0)
    return raw.map(r => ({ ...r, netPctNorm: totalAbsNet > 0 ? Math.abs(r.netMv) / totalAbsNet * 100 : 0 }))
  }, [series, capitalMap, mode, date])

  const sorted = useMemo(() => {
    if (!sort) return rows
    return [...rows].sort((a, b) => {
      const va = a[sort.col], vb = b[sort.col]
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [rows, sort])

  const chartOption = useMemo(() => {
    if (sorted.length === 0) return {}
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
          const rows = params.map(p => `${p.marker}${p.seriesName}: +${p.value.toFixed(1)}%`)
          return [params[0]?.name, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, textStyle: { fontSize: 11 } },
      grid: { left: 55, right: 10, top: 36, bottom: 30 },
      xAxis: { type: "category" as const, data: sorted.map(r => r.sector), axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value" as const,
        axisLabel: { fontSize: 10, formatter: (v: number) => `+${v}%` },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: [
        { name: "多头", type: "bar" as const, data: sorted.map(r => Math.round(r.longPct * 10) / 10),  itemStyle: { color: "#dc2626" } },
        { name: "空头", type: "bar" as const, data: sorted.map(r => Math.round(r.shortPct * 10) / 10), itemStyle: { color: "#3b82f6" } },
      ],
    }
  }, [sorted])

  const totals = useMemo(() => {
    if (rows.length === 0) return null
    return {
      longMv:     rows.reduce((s, r) => s + r.longMv, 0),
      longPct:    rows.reduce((s, r) => s + r.longPct, 0),
      shortMv:    rows.reduce((s, r) => s + r.shortMv, 0),
      shortPct:   rows.reduce((s, r) => s + r.shortPct, 0),
      netMv:      rows.reduce((s, r) => s + r.netMv, 0),
      netPctNorm: rows.reduce((s, r) => s + r.netPctNorm, 0),
    }
  }, [rows])

  const COL_LABELS: Record<SortCol, string> = {
    sector: "板块", longMv: "多头市值", longPct: "多头占比",
    shortMv: "空头市值", shortPct: "空头占比", netMv: "轧差市值", netPctNorm: "轧差占比",
  }

  return (
    <div className="space-y-3">
      {/* ── header controls ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            className="text-xs border rounded px-1.5 py-0.5 bg-background hover:bg-muted disabled:opacity-30"
            disabled={!date || date <= (series[0]?.date ?? "")}
            onClick={() => {
              const cur = date || (series[series.length - 1]?.date ?? "")
              const idx = series.findIndex(r => r.date === cur)
              if (idx > 0) setDate(series[idx - 1].date)
            }}
          >◀</button>
          <input
            type="date"
            className="text-xs border rounded px-2 py-0.5 bg-background"
            value={date || (series[series.length - 1]?.date ?? "")}
            min={series[0]?.date ?? ""}
            max={series[series.length - 1]?.date ?? ""}
            onChange={e => setDate(e.target.value)}
          />
          <button
            className="text-xs border rounded px-1.5 py-0.5 bg-background hover:bg-muted disabled:opacity-30"
            disabled={!date || date >= (series[series.length - 1]?.date ?? "")}
            onClick={() => {
              const cur = date || (series[series.length - 1]?.date ?? "")
              const idx = series.findIndex(r => r.date === cur)
              if (idx >= 0 && idx < series.length - 1) setDate(series[idx + 1].date)
            }}
          >▶</button>
          {date && date !== series[series.length - 1]?.date && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setDate("")}>最新</button>
          )}
        </div>
        <div className="flex text-xs border rounded overflow-hidden">
          {(["大类", "板块", "细分"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-0.5 transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >{m === "细分" ? "细分板块" : m === "大类" ? "大类资产" : "板块"}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4">加载中…</p>
      ) : series.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">暂无持仓数据</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Table */}
          <div className="w-full">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <table className="w-full text-xs table-auto">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b bg-muted/40">
                      {(["sector","longMv","longPct","shortMv","shortPct","netMv","netPctNorm"] as const).map((col, ci) => {
                        const active = sort?.col === col
                        const dir = active ? sort!.dir : null
                        return (
                          <th
                            key={col}
                            className={`${ci === 0 ? "text-left" : "text-right"} px-1.5 py-2 font-medium cursor-pointer select-none hover:bg-muted/60 whitespace-nowrap`}
                            onClick={() => setSort(prev =>
                              prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
                            )}
                          >
                            <span className="inline-flex items-center gap-0.5">
                              {COL_LABELS[col]}
                              <span className="text-muted-foreground text-[10px]">{dir === "desc" ? "↓" : dir === "asc" ? "↑" : "↕"}</span>
                            </span>
                          </th>
                        )
                      })}
                      <th className="text-right px-1.5 py-2 font-medium whitespace-nowrap">加权波动率%</th>
                      <th className="text-right px-1.5 py-2 font-medium whitespace-nowrap">边际波动率%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.map(row => (
                      <tr key={row.sector} className="hover:bg-muted/30">
                        <td className="px-1.5 py-1.5 font-medium whitespace-nowrap">{row.sector}</td>
                        <td className="px-1.5 py-1.5 text-right">{Math.round(row.longMv).toLocaleString("zh-CN")}</td>
                        <td className="px-1.5 py-1.5 text-right">{row.longPct.toFixed(1)}%</td>
                        <td className="px-1.5 py-1.5 text-right">{Math.round(row.shortMv).toLocaleString("zh-CN")}</td>
                        <td className="px-1.5 py-1.5 text-right">{row.shortPct.toFixed(1)}%</td>
                        <td className={`px-1.5 py-1.5 text-right ${row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {Math.round(row.netMv).toLocaleString("zh-CN")}
                        </td>
                        <td className={`px-1.5 py-1.5 text-right ${row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {row.netPctNorm.toFixed(1)}%
                        </td>
                        <td className="px-1.5 py-1.5 text-right">
                          {mvLatestMap[row.sector] != null && mvDates.length > 0
                            ? `${mvLatestMap[row.sector].toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-1.5 py-1.5 text-right">
                          {varLatestMap[row.sector] != null && varDates.length > 0
                            ? `${varLatestMap[row.sector].toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {totals && (
                      <tr className="border-t-2 font-semibold bg-muted/40">
                        <td className="px-1.5 py-1.5">合计</td>
                        <td className="px-1.5 py-1.5 text-right">{Math.round(totals.longMv).toLocaleString("zh-CN")}</td>
                        <td className="px-1.5 py-1.5 text-right">{totals.longPct.toFixed(1)}%</td>
                        <td className="px-1.5 py-1.5 text-right">{Math.round(totals.shortMv).toLocaleString("zh-CN")}</td>
                        <td className="px-1.5 py-1.5 text-right">{totals.shortPct.toFixed(1)}%</td>
                        <td className={`px-1.5 py-1.5 text-right ${totals.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {Math.round(totals.netMv).toLocaleString("zh-CN")}
                        </td>
                        <td className={`px-1.5 py-1.5 text-right ${totals.netPctNorm < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {totals.netPctNorm.toFixed(1)}%
                        </td>
                        <td className="px-1.5 py-1.5 text-right" />
                        <td className="px-1.5 py-1.5 text-right" />
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {/* Bar chart */}
          <div className="w-full">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">期货市值占比（市值/净资本）</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts option={capturing ? { ...chartOption, animation: false } : chartOption} style={{ height }} notMerge />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* VaR timeseries stacked area — own container */}
      <div className="w-full">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* view toggle */}
              <div className="flex text-xs border rounded overflow-hidden">
                {([["weight","持仓权重"],["var","持仓VaR"],["margvol","市值加权波动率"],["cvar","持仓CVaR"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setVarView(val)}
                    className={`px-2.5 py-0.5 transition-colors ${varView === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >{label}</button>
                ))}
              </div>
              <CardTitle className="text-xs text-muted-foreground">{varTitle}</CardTitle>
              {/* mode toggle */}
              <div className="flex text-xs border rounded overflow-hidden ml-auto">
                {(["大类","板块","细分"] as const).map(m => (
                  <button key={m} onClick={() => setVarMode(m)}
                    className={`px-2.5 py-0.5 transition-colors ${varMode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >{m === "细分" ? "细分板块" : m === "大类" ? "大类资产" : "板块"}</button>
                ))}
              </div>
              {/* weight calc mode — only for weight view */}
              {varView === "weight" && (
                <div className="flex text-xs border rounded overflow-hidden">
                  {([["总市值","gross"],["净市值","net"]] as const).map(([label, val]) => (
                    <button key={val} onClick={() => setWeightCalc(val)}
                      className={`px-2.5 py-0.5 transition-colors ${weightCalc === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {varIsLoading ? (
              <p className="text-sm text-muted-foreground px-4 py-6">加载中…</p>
            ) : !activeVarOption ? (
              <p className="text-sm text-muted-foreground px-4 py-6">暂无数据</p>
            ) : (
              <ReactECharts option={capturing ? { ...activeVarOption, animation: false } : activeVarOption} style={{ height }} notMerge />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
