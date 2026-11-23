"use client"

import { useState, useEffect, useMemo, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SectorColumnHelpButton } from "@/components/ma/sector-position-column-help"

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
type SleeveMode = "all" | "quant" | "subjective"
type NetMode = "direct" | "corr"
type MktColMode = "vol" | "avgCorr"
type RowSortCol = "sector" | "longMv" | "longPct" | "shortMv" | "shortPct" | "netMv" | "netPctNorm"
type SortCol = RowSortCol | "mktMetric" | "holdVol" | "margVol"
type Sort = { col: SortCol; dir: "asc" | "desc" } | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExposureRow = Record<string, any> & { date: string }

interface SectorBarRow {
  sector: string
  longMv: number; longPct: number
  shortMv: number; shortPct: number
  netMv: number; netPctNorm: number
  corrMissing?: boolean
}

export default function SectorPositionCharts({ height = 300, capturing = false, enableSleeveFilter = true }: { height?: number; capturing?: boolean; enableSleeveFilter?: boolean }) {
  const [series,     setSeries]     = useState<ExposureRow[]>([])
  const [scaleByDate, setScaleByDate] = useState<Map<string, number>>(new Map())
  const [loading,    setLoading]    = useState(true)

  const [sleeve,  setSleeve]  = useState<SleeveMode>("all")
  const [mode,    setMode]    = useState<BarMode>("板块")
  const [netMode, setNetMode] = useState<NetMode>("direct")
  const [mktColMode, setMktColMode] = useState<MktColMode>("vol")
  const [date,    setDate]    = useState<string>("")
  const [sort,    setSort]    = useState<Sort>({ col: "longMv", dir: "desc" })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = new URLSearchParams()
    if (enableSleeveFilter && sleeve !== "all") qs.set("sleeve", sleeve)
    const q = qs.toString()
    fetch("/ma/api/mom-analysis/category-exposure" + (q ? "?" + q : ""))
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.ok) {
          setSeries(j.series ?? [])
        } else {
          setSeries([])
        }
      })
      .catch(() => {
        if (!cancelled) setSeries([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sleeve, enableSleeveFilter])

  useEffect(() => {
    let cancelled = false
    fetch("/ma/api/mom-analysis/product-nav")
      .then(r => r.json())
      .then(j => {
        if (cancelled || !j.ok) return
        const map = new Map<string, number>()
        for (const point of j.data ?? []) {
          const cap = Number(point.cumCapital)
          const day = String(point.date ?? "").slice(0, 10)
          if (day && Number.isFinite(cap) && cap > 0) map.set(day, cap)
        }
        setScaleByDate(map)
      })
      .catch(() => { if (!cancelled) setScaleByDate(new Map()) })
    return () => { cancelled = true }
  }, [])

  // ── VaR timeseries ──────────────────────────────────────────────────────
  const [varMode,      setVarMode]      = useState<BarMode>("板块")
  const [varView,      setVarView]      = useState<"weight"|"var"|"margvol"|"cvar">("var")
  const [weightCalc,   setWeightCalc]   = useState<"gross"|"net">("gross")

  const [varDates,     setVarDates]     = useState<string[]>([])
  const [varCatData,   setVarCatData]   = useState<Record<string, number[]>>({})
  const [varSecData,   setVarSecData]   = useState<Record<string, number[]>>({})
  const [varSubData,   setVarSubData]   = useState<Record<string, number[]>>({})
  const [corrCatData,  setCorrCatData]  = useState<Record<string, Array<number | null>>>({})
  const [corrSecData,  setCorrSecData]  = useState<Record<string, Array<number | null>>>({})
  const [corrSubData,  setCorrSubData]  = useState<Record<string, Array<number | null>>>({})
  const [avgCorrCatData, setAvgCorrCatData] = useState<Record<string, Array<number | null>>>({})
  const [avgCorrSecData, setAvgCorrSecData] = useState<Record<string, Array<number | null>>>({})
  const [avgCorrSubData, setAvgCorrSubData] = useState<Record<string, Array<number | null>>>({})
  const [varLoading,   setVarLoading]   = useState(true)

  const [mvDates,      setMvDates]      = useState<string[]>([])
  const [mvCatData,    setMvCatData]    = useState<Record<string, number[]>>({})
  const [mvSecData,    setMvSecData]    = useState<Record<string, number[]>>({})
  const [mvSubData,    setMvSubData]    = useState<Record<string, number[]>>({})
  const [holdCatData,  setHoldCatData]  = useState<Record<string, Array<number | null>>>({})
  const [holdSecData,  setHoldSecData]  = useState<Record<string, Array<number | null>>>({})
  const [holdSubData,  setHoldSubData]  = useState<Record<string, Array<number | null>>>({})
  const [mvLoading,    setMvLoading]    = useState(true)

  const [mktDates, setMktDates] = useState<string[]>([])
  const [mktCatData, setMktCatData] = useState<Record<string, Array<number | null>>>({})
  const [mktSecData, setMktSecData] = useState<Record<string, Array<number | null>>>({})
  const [mktSubData, setMktSubData] = useState<Record<string, Array<number | null>>>({})

  const [cvarDates,    setCvarDates]    = useState<string[]>([])
  const [cvarCatData,  setCvarCatData]  = useState<Record<string, number[]>>({})
  const [cvarSecData,  setCvarSecData]  = useState<Record<string, number[]>>({})
  const [cvarSubData,  setCvarSubData]  = useState<Record<string, number[]>>({})
  const [cvarLoading,  setCvarLoading]  = useState(true)

  useEffect(() => {
    let cancelled = false
    setVarLoading(true)
    const qs = new URLSearchParams({ corrDays: "252" })
    if (enableSleeveFilter && sleeve !== "all") qs.set("sleeve", sleeve)
    fetch("/ma/api/mom-analysis/var-sector-timeseries?" + qs.toString())
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.ok) {
          setVarDates(j.dates ?? [])
          setVarCatData(j.catData ?? {})
          setVarSecData(j.sectorData ?? {})
          setVarSubData(j.subSectorData ?? {})
          setCorrCatData(j.corrNetCat ?? {})
          setCorrSecData(j.corrNetSector ?? {})
          setCorrSubData(j.corrNetSub ?? {})
          setAvgCorrCatData(j.avgCorrCat ?? {})
          setAvgCorrSecData(j.avgCorrSector ?? {})
          setAvgCorrSubData(j.avgCorrSub ?? {})
        } else {
          setVarDates([]); setVarCatData({}); setVarSecData({}); setVarSubData({})
          setCorrCatData({}); setCorrSecData({}); setCorrSubData({})
          setAvgCorrCatData({}); setAvgCorrSecData({}); setAvgCorrSubData({})
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVarDates([]); setVarCatData({}); setVarSecData({}); setVarSubData({})
          setCorrCatData({}); setCorrSecData({}); setCorrSubData({})
          setAvgCorrCatData({}); setAvgCorrSecData({}); setAvgCorrSubData({})
        }
      })
      .finally(() => { if (!cancelled) setVarLoading(false) })
    return () => { cancelled = true }
  }, [sleeve, enableSleeveFilter])

  useEffect(() => {
    let cancelled = false
    setMvLoading(true)
    const qs = new URLSearchParams()
    if (enableSleeveFilter && sleeve !== "all") qs.set("sleeve", sleeve)
    const q = qs.toString()
    fetch("/ma/api/mom-analysis/marginal-vol-timeseries" + (q ? "?" + q : ""))
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j.ok) {
          setMvDates(j.dates ?? [])
          setMvCatData(j.catData ?? {})
          setMvSecData(j.sectorData ?? {})
          setMvSubData(j.subSectorData ?? {})
          setHoldCatData(j.catVol ?? {})
          setHoldSecData(j.sectorVol ?? {})
          setHoldSubData(j.subSectorVol ?? {})
        } else {
          setMvDates([]); setMvCatData({}); setMvSecData({}); setMvSubData({})
          setHoldCatData({}); setHoldSecData({}); setHoldSubData({})
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMvDates([]); setMvCatData({}); setMvSecData({}); setMvSubData({})
          setHoldCatData({}); setHoldSecData({}); setHoldSubData({})
        }
      })
      .finally(() => { if (!cancelled) setMvLoading(false) })
    return () => { cancelled = true }
  }, [sleeve, enableSleeveFilter])

  useEffect(() => {
    let cancelled = false
    fetch("/ma/api/futures/sector-market-vol")
      .then(r => r.json())
      .then(j => {
        if (cancelled || !j.ok) return
        setMktDates(j.dates ?? [])
        setMktCatData(j.category ?? {})
        setMktSecData(j.sector ?? {})
        setMktSubData(j.sub ?? {})
      })
      .catch(() => {})
    return () => { cancelled = true }
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

  const corrLatestMap = useMemo<Record<string, number | null>>(() => {
    const rd = mode === "大类" ? corrCatData : mode === "板块" ? corrSecData : corrSubData
    const idx = pickDateIdx(varDates)
    if (idx < 0) return {}
    const result: Record<string, number | null> = {}
    for (const [sector, vals] of Object.entries(rd)) {
      const candidate = vals[idx]
      result[sector] = candidate != null && Number.isFinite(candidate) ? candidate : null
    }
    return result
  }, [mode, date, varDates, corrCatData, corrSecData, corrSubData])

  const avgCorrLatestMap = useMemo<Record<string, number | null>>(() => {
    const rd = mode === "大类" ? avgCorrCatData : mode === "板块" ? avgCorrSecData : avgCorrSubData
    const idx = pickDateIdx(varDates)
    if (idx < 0) return {}
    const result: Record<string, number | null> = {}
    for (const [sector, vals] of Object.entries(rd)) {
      const candidate = vals[idx]
      result[sector] = candidate != null && Number.isFinite(candidate) ? candidate : null
    }
    return result
  }, [mode, date, varDates, avgCorrCatData, avgCorrSecData, avgCorrSubData])

  const mktLatestMap = useMemo<Record<string, number | null>>(() => {
    const rd = mode === "大类" ? mktCatData : mode === "板块" ? mktSecData : mktSubData
    const idx = pickDateIdx(mktDates)
    if (idx < 0) return {}
    const result: Record<string, number | null> = {}
    for (const [sector, vals] of Object.entries(rd)) {
      let value: number | null = null
      for (let i = Math.min(idx, vals.length - 1); i >= 0; i--) {
        const candidate = vals[i]
        if (candidate != null && Number.isFinite(candidate)) { value = candidate; break }
      }
      result[sector] = value
    }
    return result
  }, [mode, date, mktDates, mktCatData, mktSecData, mktSubData])

  const holdLatestMap = useMemo<Record<string, number | null>>(() => {
    const rd = mode === "大类" ? holdCatData : mode === "板块" ? holdSecData : holdSubData
    const idx = pickDateIdx(mvDates)
    if (idx < 0) return {}
    const result: Record<string, number | null> = {}
    for (const [sector, vals] of Object.entries(rd)) {
      let value: number | null = null
      for (let i = Math.min(idx, vals.length - 1); i >= 0; i--) {
        const candidate = vals[i]
        if (candidate != null && Number.isFinite(candidate)) { value = candidate; break }
      }
      result[sector] = value
    }
    return result
  }, [mode, date, mvDates, holdCatData, holdSecData, holdSubData])

  const { rows, tableScale } = useMemo(() => {
    let row: ExposureRow | undefined
    if (date) row = series.find(r => r.date === date)
    if (!row) row = series[series.length - 1]
    if (!row) return { rows: [] as SectorBarRow[], tableScale: 0 }

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
        shortMv: absShort,
        netMv: net,
      }
    })
    const scaleDates = [...scaleByDate.keys()].sort()
    let scale = scaleByDate.get(row.date) ?? 0
    if (!(scale > 0)) {
      for (let i = scaleDates.length - 1; i >= 0; i--) {
        if (scaleDates[i] <= row.date) { scale = scaleByDate.get(scaleDates[i]) ?? 0; break }
      }
    }
    const ofScale = (mv: number) => scale > 0 ? mv / scale * 100 : 0
    return {
      rows: raw.map(r => ({
        ...r,
        longPct: ofScale(r.longMv),
        shortPct: ofScale(r.shortMv),
        netPctNorm: ofScale(Math.abs(r.netMv)),
      })),
      tableScale: scale,
    }
  }, [series, scaleByDate, mode, date])

  const viewRows = useMemo(() => {
    if (netMode === "direct") return rows
    return rows.map(row => {
      const corr = corrLatestMap[row.sector]
      if (corr == null || !Number.isFinite(corr)) return { ...row, corrMissing: true }
      return {
        ...row,
        netMv: corr,
        netPctNorm: tableScale > 0 ? Math.abs(corr) / tableScale * 100 : 0,
        corrMissing: false,
      }
    })
  }, [rows, netMode, corrLatestMap, tableScale])

  const sorted = useMemo(() => {
    if (!sort) return viewRows
    const displayed = (row: SectorBarRow): string | number | null => {
      if (sort.col === "mktMetric") {
        const v = mktColMode === "avgCorr" ? avgCorrLatestMap[row.sector] : mktLatestMap[row.sector]
        return v != null && Number.isFinite(v) ? v : null
      }
      if (sort.col === "holdVol") {
        const v = holdLatestMap[row.sector]
        return v != null && Number.isFinite(v) ? v : null
      }
      if (sort.col === "margVol") {
        if (varDates.length === 0) return null
        const v = varLatestMap[row.sector]
        return v != null && Number.isFinite(v) ? v : null
      }
      const v = row[sort.col]
      return typeof v === "number" && !Number.isFinite(v) ? null : v
    }
    return [...viewRows].sort((a, b) => {
      const va = displayed(a), vb = displayed(b)
      const aMissing = va == null
      const bMissing = vb == null
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return 0
        return aMissing ? 1 : -1
      }
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.dir === "asc" ? cmp : -cmp
    })
  }, [viewRows, sort, mktColMode, avgCorrLatestMap, mktLatestMap, holdLatestMap, varLatestMap, varDates.length])

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
    if (viewRows.length === 0) return null
    const counted = viewRows.filter(r => !r.corrMissing)
    return {
      longMv:     viewRows.reduce((s, r) => s + r.longMv, 0),
      longPct:    viewRows.reduce((s, r) => s + r.longPct, 0),
      shortMv:    viewRows.reduce((s, r) => s + r.shortMv, 0),
      shortPct:   viewRows.reduce((s, r) => s + r.shortPct, 0),
      netMv:      counted.reduce((s, r) => s + Math.abs(r.netMv), 0),
      netPctNorm: counted.reduce((s, r) => s + r.netPctNorm, 0),
      netPending: netMode === "corr" && counted.length === 0,
    }
  }, [viewRows, netMode])

const COL_LABELS: Record<Exclude<RowSortCol, "netMv" | "netPctNorm">, string> = {
  sector: "板块", longMv: "多头市值", longPct: "多头占比",
  shortMv: "空头市值", shortPct: "空头占比",
}

const DIRECT_NET_FORMULA = "多空直接轧差市值 = 多头市值 − 空头市值。合计 = 各行 |多空直接轧差市值| 之和"
const DIRECT_PCT_FORMULA = "多空直接轧差占比 = |多空直接轧差市值| ÷ 总规模"
const CORR_NET_FORMULA = "多空相关轧差市值 = 符号(各品种净市值之和) × √(Σᵢ Σⱼ 净市值ᵢ × 净市值ⱼ × ρᵢⱼ)。同一品种的多空先轧掉。ρ 用最近 252 个交易日收益率。ρ 全为 1 时等于直接轧差。合计 = 各行绝对值之和，板块之间不再轧一次。"
const CORR_PCT_FORMULA = "多空相关轧差占比 = |多空相关轧差市值| ÷ 总规模"
const AVG_CORR_FORMULA = "板块内品种平均相关 = Σᵢ<ⱼ |市值ᵢ| × |市值ⱼ| × ρᵢⱼ ÷ Σᵢ<ⱼ |市值ᵢ| × |市值ⱼ|。同一品种的多空先合成净市值。ρ 用最近 252 个交易日。只有一个品种时没有配对，显示 —。"

const COL_FORMULAS: Record<Exclude<RowSortCol, "netMv" | "netPctNorm"> | "mktVol" | "holdVol" | "margVol", string> = {
  sector: "分组 = 当前选择的大类、板块或细分板块",
  longMv: "多头市值 = 该组买持仓市值",
  longPct: "多头占比 = 多头市值 ÷ 总规模",
  shortMv: "空头市值 = 该组卖持仓市值",
  shortPct: "空头占比 = 空头市值 ÷ 总规模",
  mktVol: "板块市场波动 = 最近20日收益率标准差 × √252。农产、能化、黑色、贵金属、新能源、有色和商品用南华指数，其余用主力合约等权。",
  holdVol: "板块持仓波动 = 该组持仓品种按市值加权的最近20日收益率标准差 × √252",
  margVol: "风险贡献占比 = 该组边际方差贡献 ÷ 组合边际方差合计",
}

function SortMark({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <span aria-hidden className="shrink-0 text-muted-foreground text-[10px] leading-none">
      {dir === "desc" ? "↓" : dir === "asc" ? "↑" : "↕"}
    </span>
  )
}

/** Two nowrap lines plus a sort mark beside them. The mark must not wrap the name onto a third row. */
function TwoLineSortLabel({ lines, dir }: { lines: readonly [string, string]; dir: "asc" | "desc" | null }) {
  return (
    <span className="inline-flex w-max max-w-none items-center justify-end gap-0.5">
      <span className="flex flex-col items-end leading-tight">
        <span className="whitespace-nowrap">{lines[0]}</span>
        <span className="whitespace-nowrap">{lines[1]}</span>
      </span>
      <SortMark dir={dir} />
    </span>
  )
}

const HEAD_CELL = "px-[3px] py-1 font-medium whitespace-nowrap cursor-pointer select-none hover:bg-muted/60"

function ColumnHeader({ formula, className, onClick, children }: {
  formula: string
  className: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <th className={className} tabIndex={0} onClick={onClick}>{children}</th>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 px-2.5 py-1.5 text-left leading-snug">
        {formula}
      </TooltipContent>
    </Tooltip>
  )
}

  return (
    <div className="space-y-3">
      {/* ── header controls ── */}
      <div className="flex flex-col gap-1.5">
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
        {enableSleeveFilter && (
          <div className="flex text-xs border rounded overflow-hidden">
            {([["all","全部"],["quant","量化"],["subjective","主观"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSleeve(val)}
                className={`px-2.5 py-0.5 transition-colors ${
                  sleeve === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >{label}</button>
            ))}
          </div>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {!capturing && <SectorColumnHelpButton />}
          {tableScale > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              总规模 {Math.round(tableScale).toLocaleString("zh-CN")}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex text-xs border border-red-200 rounded overflow-hidden">
          {([["direct", "直接轧差"], ["corr", "相关轧差"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setNetMode(val)}
              className={`px-2.5 py-0.5 transition-colors ${
                netMode === val ? "bg-red-100 text-red-700" : "bg-background text-muted-foreground hover:bg-red-50"
              }`}
            >{label}</button>
          ))}
        </div>
        <div className="flex text-xs border border-red-200 rounded overflow-hidden">
          {([["vol", "市场波动"], ["avgCorr", "平均相关"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setMktColMode(val)}
              className={`px-2.5 py-0.5 transition-colors ${
                mktColMode === val ? "bg-red-100 text-red-700" : "bg-background text-muted-foreground hover:bg-red-50"
              }`}
            >{label}</button>
          ))}
        </div>
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
            <Card className="overflow-x-auto">
              <CardContent className="p-0">
                <table className="w-full min-w-max text-xs table-auto">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b bg-muted/40">
                      {(["sector","longMv","longPct","shortMv","shortPct","netMv","netPctNorm"] as const).map((col, ci) => {
                        const active = sort?.col === col
                        const dir = active ? sort!.dir : null
                        const isNet = col === "netMv" || col === "netPctNorm"
                        const formula = col === "netMv"
                          ? (netMode === "corr" ? CORR_NET_FORMULA : DIRECT_NET_FORMULA)
                          : col === "netPctNorm"
                            ? (netMode === "corr" ? CORR_PCT_FORMULA : DIRECT_PCT_FORMULA)
                            : COL_FORMULAS[col]
                        return (
                          <ColumnHeader
                            key={col}
                            formula={formula}
                            className={`${ci === 0 ? "text-left" : "text-right"} ${HEAD_CELL}`}
                            onClick={() => setSort(prev =>
                              prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
                            )}
                          >
                            {isNet ? (
                              <TwoLineSortLabel
                                lines={[
                                  netMode === "corr" ? "多空相关" : "多空直接",
                                  col === "netMv" ? "轧差市值" : "轧差占比",
                                ]}
                                dir={dir}
                              />
                            ) : (
                              <span className="inline-flex items-center justify-end gap-0.5">
                                {COL_LABELS[col]}
                                <SortMark dir={dir} />
                              </span>
                            )}
                          </ColumnHeader>
                        )
                      })}
                      {([
                        {
                          col: "mktMetric" as const,
                          formula: mktColMode === "avgCorr" ? AVG_CORR_FORMULA : COL_FORMULAS.mktVol,
                          lines: (mktColMode === "avgCorr" ? ["板块内品种", "平均相关"] : ["板块市场", "波动"]) as [string, string],
                        },
                        {
                          col: "holdVol" as const,
                          formula: COL_FORMULAS.holdVol,
                          lines: ["板块持仓", "波动"] as [string, string],
                        },
                        {
                          col: "margVol" as const,
                          formula: COL_FORMULAS.margVol,
                          lines: ["风险贡献", "占比"] as [string, string],
                        },
                      ]).map(({ col, formula, lines }) => {
                        const active = sort?.col === col
                        const dir = active ? sort!.dir : null
                        return (
                          <ColumnHeader
                            key={col}
                            formula={formula}
                            className={`text-right ${HEAD_CELL}`}
                            onClick={() => setSort(prev =>
                              prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
                            )}
                          >
                            <TwoLineSortLabel lines={lines} dir={dir} />
                          </ColumnHeader>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.map(row => (
                      <tr key={row.sector} className="hover:bg-muted/30">
                        <td className="px-[3px] py-1.5 font-medium whitespace-nowrap">{row.sector}</td>
                        <td className="px-[3px] py-1.5 text-right">{Math.round(row.longMv).toLocaleString("zh-CN")}</td>
                        <td className="px-[3px] py-1.5 text-right">{row.longPct.toFixed(1)}%</td>
                        <td className="px-[3px] py-1.5 text-right">{Math.round(row.shortMv).toLocaleString("zh-CN")}</td>
                        <td className="px-[3px] py-1.5 text-right">{row.shortPct.toFixed(1)}%</td>
                        <td className={`px-[3px] py-1.5 text-right ${row.corrMissing ? "text-muted-foreground" : row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {row.corrMissing ? "—" : Math.round(row.netMv).toLocaleString("zh-CN")}
                        </td>
                        <td className={`px-[3px] py-1.5 text-right ${row.corrMissing ? "text-muted-foreground" : row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                          {row.corrMissing ? "—" : `${row.netPctNorm.toFixed(1)}%`}
                        </td>
                        <td className="px-[3px] py-1.5 text-right" title={mktColMode === "avgCorr" ? "板块内品种平均相关" : "20日年化波动率"}>
                          {mktColMode === "avgCorr"
                            ? (avgCorrLatestMap[row.sector] != null ? avgCorrLatestMap[row.sector]!.toFixed(2) : "—")
                            : (mktLatestMap[row.sector] != null ? `${mktLatestMap[row.sector]!.toFixed(1)}%` : "—")}
                        </td>
                        <td className="px-[3px] py-1.5 text-right" title="持仓市值加权20日年化波动率">
                          {holdLatestMap[row.sector] != null
                            ? `${holdLatestMap[row.sector]!.toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-[3px] py-1.5 text-right">
                          {varLatestMap[row.sector] != null && varDates.length > 0
                            ? `${varLatestMap[row.sector].toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {totals && (
                      <tr className="border-t-2 font-semibold bg-muted/40">
                        <td className="px-[3px] py-1.5">合计</td>
                        <td className="px-[3px] py-1.5 text-right">{Math.round(totals.longMv).toLocaleString("zh-CN")}</td>
                        <td className="px-[3px] py-1.5 text-right">{totals.longPct.toFixed(1)}%</td>
                        <td className="px-[3px] py-1.5 text-right">{Math.round(totals.shortMv).toLocaleString("zh-CN")}</td>
                        <td className="px-[3px] py-1.5 text-right">{totals.shortPct.toFixed(1)}%</td>
                        <td className={`px-[3px] py-1.5 text-right ${totals.netPending ? "text-muted-foreground" : "text-foreground"}`}>
                          {totals.netPending ? "—" : Math.round(totals.netMv).toLocaleString("zh-CN")}
                        </td>
                        <td className={`px-[3px] py-1.5 text-right ${totals.netPending ? "text-muted-foreground" : "text-foreground"}`}>
                          {totals.netPending ? "—" : `${totals.netPctNorm.toFixed(1)}%`}
                        </td>
                        <td className="px-[3px] py-1.5 text-right" />
                        <td className="px-[3px] py-1.5 text-right" />
                        <td className="px-[3px] py-1.5 text-right" />
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
                <CardTitle className="text-sm">期货市值占比（市值/总规模）</CardTitle>
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
