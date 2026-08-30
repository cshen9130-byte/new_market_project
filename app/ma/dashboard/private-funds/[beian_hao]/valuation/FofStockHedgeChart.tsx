"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, FolderOpen, Save, Trash2 } from "lucide-react"
import ReactECharts from "echarts-for-react"
import {
  classifyFofEquityHolding,
  computeFofHedgeBucketFactors,
  computeFofStockHedgeSeries,
  computeFofStockHedgeSnapshot,
  DEFAULT_LS_NET_EXPOSURE_PCT,
  defaultHedgeRiskWeightPct,
  fofEquityBucketLabel,
  hedgeHoldingKey,
  MAX_PRODUCT_RISK_WEIGHT_PCT,
  resolveHedgeRiskWeightPct,
  type FofEquityBucket,
  type FofHedgeHolding,
} from "@/lib/fof-deeper-analysis"
import { isValuationCashHoldingName } from "@/lib/valuation-holding-display-name"
import type { FundHoldingRow } from "./FofFundsPanel"
import type { OtherHoldingRow } from "./OtherHoldingsPanel"
import type { FofShareTrendData } from "./FofShareTrendPanel"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"
import type { ChartCalcHelp } from "./ChartCalcHelpButton"

type Props = {
  fundHoldings: FundHoldingRow[]
  otherHoldings?: OtherHoldingRow[]
  netAssetValue?: number | null
  strategyTrend?: FofShareTrendData | null
  weightStorageKey?: string
}

const WEIGHT_STORAGE_PREFIX = "fof-hedge-product-weights:"
const PRESET_STORAGE_PREFIX = "fof-hedge-weight-presets:"
const PRESET_MIGRATED_PREFIX = "fof-hedge-weight-presets-migrated:"

type WeightPresetScope = "team" | "mine"

type WeightPreset = {
  id: string
  scope: WeightPresetScope
  name: string
  lsNetAssumptionPct: number
  overrides: Record<string, number>
  createdByName?: string
  updatedAt?: string
}

const BUCKET_ORDER: FofEquityBucket[] = [
  "limit_up",
  "long_only",
  "hedge",
  "direct_stock",
  "etf",
  "other",
]

function fmtPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`
}

function fmtWan(n: number): string {
  return `${(n / 10_000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万`
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function hedgeSideLabel(side: "short_futures" | "long_futures" | "none"): string {
  if (side === "short_futures") return "建议开空股指期货"
  if (side === "long_futures") return "建议开多股指期货"
  return "无需额外对冲"
}

function isCashOrNonFundRow(row: FundHoldingRow): boolean {
  if (["bank_deposit", "settlement_reserve", "margin_deposit", "payable", "clearing"].includes(row.rowKind)) {
    return true
  }
  return isValuationCashHoldingName(row.fundName)
}

function parseWeightMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value)
    if (key && Number.isFinite(n) && n >= 0) out[key] = Math.min(n, MAX_PRODUCT_RISK_WEIGHT_PCT)
  }
  return out
}

function parseStoredWorkingDraft(raw: string | null): {
  overrides: Record<string, number>
  lsNetAssumptionPct?: number
} {
  if (!raw) return { overrides: {} }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return { overrides: {} }
    const obj = parsed as Record<string, unknown>
    if (obj.overrides && typeof obj.overrides === "object") {
      const ls = Number(obj.lsNetAssumptionPct)
      return {
        overrides: parseWeightMap(obj.overrides),
        lsNetAssumptionPct: Number.isFinite(ls) && ls >= 0 ? ls : undefined,
      }
    }
    return { overrides: parseWeightMap(parsed) }
  } catch {
    return { overrides: {} }
  }
}

function loadLocalWeightPresets(storageKey?: string): Array<{
  name: string
  lsNetAssumptionPct: number
  overrides: Record<string, number>
}> {
  if (!storageKey) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRESET_STORAGE_PREFIX + storageKey) || "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null
        const row = item as Record<string, unknown>
        const name = String(row.name ?? "").trim()
        if (!name) return null
        const ls = Number(row.lsNetAssumptionPct)
        return {
          name,
          lsNetAssumptionPct: Number.isFinite(ls) && ls >= 0 ? ls : DEFAULT_LS_NET_EXPOSURE_PCT,
          overrides: parseWeightMap(row.overrides),
        }
      })
      .filter((item): item is { name: string; lsNetAssumptionPct: number; overrides: Record<string, number> } => item != null)
  } catch {
    return []
  }
}

function readCurrentUser(): { id: string; name: string } | null {
  try {
    const raw = window.localStorage.getItem("currentUser")
    const user = raw ? JSON.parse(raw) as { id?: string; name?: string; email?: string } : null
    const id = String(user?.id ?? "").trim()
    if (!id) return null
    return { id, name: String(user?.name || user?.email || "").trim() }
  } catch {
    return null
  }
}

function authHeaders(): HeadersInit {
  const user = readCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

function parseServerPresets(raw: unknown): WeightPreset[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): WeightPreset | null => {
      if (!item || typeof item !== "object") return null
      const row = item as Record<string, unknown>
      const name = String(row.name ?? "").trim()
      const id = String(row.id ?? "").trim()
      if (!name || !id) return null
      const ls = Number(row.lsNetAssumptionPct)
      return {
        id,
        scope: row.scope === "team" ? "team" : "mine",
        name,
        lsNetAssumptionPct: Number.isFinite(ls) && ls >= 0 ? ls : DEFAULT_LS_NET_EXPOSURE_PCT,
        overrides: parseWeightMap(row.overrides),
        createdByName: typeof row.createdByName === "string" ? row.createdByName : "",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
      }
    })
    .filter((item): item is WeightPreset => item != null)
}

function useProductRiskWeights(storageKey?: string) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [lsNetDraft, setLsNetDraft] = useState(String(DEFAULT_LS_NET_EXPOSURE_PCT))
  const [hydrated, setHydrated] = useState(!storageKey)

  useEffect(() => {
    if (!storageKey) {
      setHydrated(true)
      return
    }
    const draft = parseStoredWorkingDraft(window.localStorage.getItem(WEIGHT_STORAGE_PREFIX + storageKey))
    setOverrides(draft.overrides)
    if (draft.lsNetAssumptionPct != null) setLsNetDraft(String(draft.lsNetAssumptionPct))
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || !hydrated) return
    const lsNet = Number(lsNetDraft)
    window.localStorage.setItem(WEIGHT_STORAGE_PREFIX + storageKey, JSON.stringify({
      lsNetAssumptionPct: Number.isFinite(lsNet) && lsNet >= 0 ? lsNet : DEFAULT_LS_NET_EXPOSURE_PCT,
      overrides,
    }))
  }, [overrides, lsNetDraft, storageKey, hydrated])

  return { overrides, setOverrides, lsNetDraft, setLsNetDraft }
}

export function FofStockHedgeChart({
  fundHoldings,
  otherHoldings = [],
  netAssetValue,
  strategyTrend,
  weightStorageKey,
}: Props) {
  const { overrides, setOverrides, lsNetDraft, setLsNetDraft } = useProductRiskWeights(weightStorageKey)
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({})
  const [weightsOpen, setWeightsOpen] = useState(true)
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [presetScope, setPresetScope] = useState<WeightPresetScope>("team")
  const [teamPresets, setTeamPresets] = useState<WeightPreset[]>([])
  const [minePresets, setMinePresets] = useState<WeightPreset[]>([])
  const [presetName, setPresetName] = useState("")
  const [selectedPresetId, setSelectedPresetId] = useState("")
  const [presetStatus, setPresetStatus] = useState("")
  const [presetBusy, setPresetBusy] = useState(false)
  const presets = presetScope === "team" ? teamPresets : minePresets

  useEffect(() => {
    if (!presetStatus) return
    const timer = window.setTimeout(() => setPresetStatus(""), 2400)
    return () => window.clearTimeout(timer)
  }, [presetStatus])

  useEffect(() => {
    if (!weightStorageKey) return
    const beian = weightStorageKey
    let cancelled = false

    async function loadRemote() {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(beian)}/valuation/hedge-weight-presets`,
        { headers: authHeaders(), cache: "no-store" },
      )
      const json = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok || !json?.ok) {
        setPresetStatus(json?.error || "无法读取已保存方案，请先登录")
        return
      }
      const team = parseServerPresets(json.team)
      let mine = parseServerPresets(json.mine)
      setTeamPresets(team)

      const migratedKey = PRESET_MIGRATED_PREFIX + beian
      const local = loadLocalWeightPresets(beian)
      if (mine.length === 0 && local.length > 0 && !window.localStorage.getItem(migratedKey)) {
        for (const item of local) {
          const saveRes = await fetch(
            `/ma/api/private-funds/${encodeURIComponent(beian)}/valuation/hedge-weight-presets`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({
                scope: "mine",
                name: item.name,
                lsNetAssumptionPct: item.lsNetAssumptionPct,
                overrides: item.overrides,
              }),
            },
          )
          const saved = await saveRes.json().catch(() => ({}))
          if (cancelled) return
          if (saveRes.ok && saved?.ok) {
            mine = parseServerPresets(saved.mine)
            setTeamPresets(parseServerPresets(saved.team))
          }
        }
        window.localStorage.setItem(migratedKey, "1")
        window.localStorage.removeItem(PRESET_STORAGE_PREFIX + beian)
      }
      setMinePresets(mine)
    }

    void loadRemote().catch(() => {
      if (!cancelled) setPresetStatus("无法读取已保存方案")
    })
    return () => {
      cancelled = true
    }
  }, [weightStorageKey])

  const lsNet = Number(lsNetDraft)
  const lsNetPct = Number.isFinite(lsNet) && lsNet >= 0 ? lsNet : DEFAULT_LS_NET_EXPOSURE_PCT

  const snapshot = useMemo(
    () => computeFofStockHedgeSnapshot(
      fundHoldings,
      netAssetValue ?? 0,
      lsNetPct,
      otherHoldings,
      overrides,
    ),
    [fundHoldings, netAssetValue, lsNetPct, otherHoldings, overrides],
  )

  const bucketFactors = useMemo(
    () => computeFofHedgeBucketFactors(fundHoldings, overrides, lsNetPct),
    [fundHoldings, overrides, lsNetPct],
  )

  const seriesPoints = useMemo(
    () => computeFofStockHedgeSeries(
      strategyTrend?.dates ?? [],
      strategyTrend?.series ?? [],
      lsNetPct,
      bucketFactors,
    ),
    [strategyTrend, lsNetPct, bucketFactors],
  )

  const weightRows = useMemo(() => {
    const rows = fundHoldings
      .filter((row) => !isCashOrNonFundRow(row) && Number.isFinite(row.marketValue) && row.marketValue !== 0)
      .map((row) => {
        const bucket = classifyFofEquityHolding(row)
        const key = hedgeHoldingKey(row)
        const defaultPct = defaultHedgeRiskWeightPct(bucket, lsNetPct)
        const weightPct = resolveHedgeRiskWeightPct(row, overrides, lsNetPct)
        return {
          key,
          row,
          bucket,
          defaultPct,
          weightPct,
          riskMv: row.marketValue * weightPct / 100,
          isOverride: overrides[key] != null,
        }
      })
      .sort((a, b) => {
        const ai = BUCKET_ORDER.indexOf(a.bucket)
        const bi = BUCKET_ORDER.indexOf(b.bucket)
        if (ai !== bi) return ai - bi
        return Math.abs(b.row.marketValue) - Math.abs(a.row.marketValue)
      })
    return showAllProducts ? rows : rows.filter((r) => r.bucket !== "other" || r.weightPct > 0)
  }, [fundHoldings, lsNetPct, overrides, showAllProducts])

  const hiddenOtherCount = useMemo(() => {
    if (showAllProducts) return 0
    return fundHoldings.filter((row) => {
      if (isCashOrNonFundRow(row) || !Number.isFinite(row.marketValue) || row.marketValue === 0) return false
      const bucket = classifyFofEquityHolding(row)
      const weightPct = resolveHedgeRiskWeightPct(row, overrides, lsNetPct)
      return bucket === "other" && weightPct <= 0
    }).length
  }, [fundHoldings, overrides, lsNetPct, showAllProducts])

  const waterfallOption = useMemo(() => {
    const steps = [
      { name: "股票多头", value: snapshot.longOnlyPct },
      { name: "打板", value: snapshot.limitUpPct },
      { name: "对冲基金净敞口", value: snapshot.lsNetPct },
      { name: "直持股票/ETF", value: snapshot.directStockPct + snapshot.etfPct },
    ]
    if (Math.abs(snapshot.otherRiskPct) > 0.005) {
      steps.push({ name: "其他加权", value: snapshot.otherRiskPct })
    }
    steps.push({ name: "已有股指对冲", value: snapshot.existingHedgePct })
    const names = [...steps.map((s) => s.name), "单边敞口"]
    const help: Array<number | string> = []
    const up: Array<number | string> = []
    const down: Array<number | string> = []
    let acc = 0
    for (const step of steps) {
      if (step.value >= 0) {
        help.push(+acc.toFixed(2))
        up.push(+step.value.toFixed(2))
        down.push("-")
        acc += step.value
      } else {
        acc += step.value
        help.push(+acc.toFixed(2))
        up.push("-")
        down.push(+Math.abs(step.value).toFixed(2))
      }
    }
    help.push("-")
    const total = +acc.toFixed(2)
    const totalItem = {
      value: Math.abs(total),
      itemStyle: { color: "#1e3a5f" },
    }
    if (total >= 0) {
      up.push(totalItem)
      down.push("-")
    } else {
      up.push("-")
      down.push(totalItem)
    }

    return {
      grid: { left: 48, right: 20, top: 36, bottom: 36 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ seriesName: string; value: number | string | { value: number }; axisValue: string }>) => {
          const shown = params.filter((p) => p.seriesName !== "辅助" && p.value !== "-" && p.value != null)
          const raw = shown[0]?.value
          const n = typeof raw === "number"
            ? raw
            : typeof raw === "object" && raw && "value" in raw
              ? Number(raw.value)
              : Number(raw)
          const label = shown[0]?.axisValue ?? ""
          if (!Number.isFinite(n)) return label
          const signed = shown[0]?.seriesName === "减少" ? -n : n
          return `${label}<br/>${signed >= 0 ? "+" : ""}${signed.toFixed(2)}% NAV`
        },
      },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 10, color: "#71717a", interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "% NAV",
        axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: "辅助",
          type: "bar",
          stack: "wf",
          data: help,
          itemStyle: { color: "transparent" },
          silent: true,
          barMaxWidth: 36,
        },
        {
          name: "增加",
          type: "bar",
          stack: "wf",
          data: up,
          itemStyle: { color: "#ef4444" },
          barMaxWidth: 36,
        },
        {
          name: "减少",
          type: "bar",
          stack: "wf",
          data: down,
          itemStyle: { color: "#10b981" },
          barMaxWidth: 36,
        },
      ],
    }
  }, [snapshot])

  const trendOption = useMemo(() => ({
    grid: { left: 48, right: 20, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; axisValue: string; marker: string }>) => {
        if (!Array.isArray(params) || params.length === 0) return ""
        const i = seriesPoints.findIndex((p) => p.date === params[0].axisValue)
        const point = i >= 0 ? seriesPoints[i] : null
        const lines = [`<b>${params[0].axisValue}</b>`]
        for (const p of params) {
          if (p.value == null || !Number.isFinite(p.value)) continue
          lines.push(`${p.marker}${p.seriesName}：${fmtPct(p.value)}`)
        }
        if (point) lines.push(`单边敞口合计：${fmtPct(point.netPct)}`)
        return lines.join("<br/>")
      },
    },
    xAxis: {
      type: "category",
      data: seriesPoints.map((p) => p.date),
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "% NAV",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: [
      {
        name: "股票多头",
        type: "line",
        stack: "exp",
        data: seriesPoints.map((p) => p.longOnlyPct),
        showSymbol: false,
        areaStyle: { color: "rgba(217,48,37,0.18)" },
        lineStyle: { width: 1.4, color: "#D93025" },
        itemStyle: { color: "#D93025" },
      },
      {
        name: "打板",
        type: "line",
        stack: "exp",
        data: seriesPoints.map((p) => p.limitUpPct),
        showSymbol: false,
        areaStyle: { color: "rgba(249,115,22,0.16)" },
        lineStyle: { width: 1.4, color: "#f97316" },
        itemStyle: { color: "#f97316" },
      },
      {
        name: "对冲基金净敞口",
        type: "line",
        stack: "exp",
        data: seriesPoints.map((p) => p.lsNetPct),
        showSymbol: false,
        areaStyle: { color: "rgba(147,51,234,0.16)" },
        lineStyle: { width: 1.4, color: "#9333ea" },
        itemStyle: { color: "#9333ea" },
      },
      {
        name: "单边敞口",
        type: "line",
        data: seriesPoints.map((p) => p.netPct),
        showSymbol: false,
        lineStyle: { width: 1.8, color: "#e54d42" },
        itemStyle: { color: "#e54d42" },
      },
    ],
  }), [seriesPoints])

  const extra = (
    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
      对冲默认净敞口
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        value={lsNetDraft}
        onChange={(e) => setLsNetDraft(e.target.value)}
        className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
      />
      %
    </span>
  )

  const snapshotHelp: ChartCalcHelp = useMemo(() => {
    const navLabel = netAssetValue && netAssetValue > 0 ? fmtWan(netAssetValue) : "资产净值"
    const directPct = snapshot.directStockPct + snapshot.etfPct
    const otherTerm = Math.abs(snapshot.otherRiskPct) > 0.005
      ? ` + ${fmtPct(snapshot.otherRiskPct)}`
      : ""
    return {
      heading: "股票单边敞口 · 计算说明",
      blocks: [
        {
          title: "单边敞口",
          paragraphs: [
            "各分项按产品风险权重折算后的市值占资产净值的代数和。净多头时母基金可用股指期货开空自行对冲，净空头则开多。绝对值小于 0.05% NAV 视为无需额外对冲。",
          ],
          formula: `单边敞口 = 股票多头 + 打板 + 对冲基金净敞口 + 直持股票/ETF${Math.abs(snapshot.otherRiskPct) > 0.005 ? " + 其他加权" : ""} + 已有股指对冲
${fmtPct(snapshot.netExposurePct)} = ${fmtPct(snapshot.longOnlyPct)} + ${fmtPct(snapshot.limitUpPct)} + ${fmtPct(snapshot.lsNetPct)} + ${fmtPct(directPct)}${otherTerm} + ${fmtPct(snapshot.existingHedgePct)}
市值 ${fmtWan(snapshot.netExposureMv)} = ${navLabel} × ${fmtPct(snapshot.netExposurePct)}`,
        },
        {
          title: "产品风险权重",
          paragraphs: [
            "每只底层产品可单独填写风险权重（%）。计入敞口 = 市值 × 风险权重。未改过的产品用默认：打板 / 股票多头 / 直持 / ETF = 100%，股票对冲 = 右侧对冲默认净敞口，其余策略 = 0%。保存到「团队」后任意账号任意电脑可见；保存到「我的」后同一账号任意电脑可见。",
          ],
        },
        {
          title: "建议对冲名义",
          paragraphs: [
            `等于单边敞口市值的绝对值 ${fmtWan(snapshot.hedgeNotionalMv)}。${hedgeSideLabel(snapshot.hedgeSide)}。`,
          ],
        },
        {
          title: "股票多头",
          paragraphs: [
            "一级策略为「股票多头」或「股票策略」、且策略中不含「打板」的子基金，默认按 100% 计入，可按产品改权重。",
          ],
          formula: `${fmtPct(snapshot.longOnlyPct)} = ${fmtWan(snapshot.longOnlyMv)} / ${navLabel}`,
        },
        {
          title: "打板",
          paragraphs: [
            "策略名称或二/三级策略含「打板」的子基金单独成项，包括「股票对冲/打板」。默认按满仓 100% 计入，可按产品改权重。不再并入股票多头或股票对冲。",
          ],
          formula: `${fmtPct(snapshot.limitUpPct)} = ${fmtWan(snapshot.limitUpMv)} / ${navLabel}`,
        },
        {
          title: "对冲基金净敞口",
          paragraphs: [
            "一级策略为「股票对冲」且策略不含「打板」的子基金先取资本市值，再乘该产品风险权重。未单独填写时用右侧对冲默认净敞口。",
          ],
          formula: `${fmtPct(snapshot.lsNetPct)} = ${fmtWan(snapshot.lsGrossMv)} × ${snapshot.lsEffectivePct.toFixed(1)}% / ${navLabel}`,
        },
        {
          title: "直持股票 / ETF",
          paragraphs: [
            "估值表中识别为个股（6 位代码或 rowKind=stock）或名称含 ETF 的持仓，默认 100%，可改权重。瀑布图把两项加总为一根柱。",
          ],
          formula: `${fmtPct(directPct)} = (${fmtWan(snapshot.directStockMv)} + ${fmtWan(snapshot.etfMv)}) / ${navLabel}`,
        },
        {
          title: "已有股指对冲",
          bullets: [
            "其他持仓名称含「股指期货」或 IF/IH/IC/IM 合约代码的市值。",
            "空头为负，会减少单边敞口；多头为正，会增加。",
            `本期 ${fmtPct(snapshot.existingHedgePct)}（${fmtWan(snapshot.existingHedgeMv)}）。`,
          ],
        },
        {
          title: "瀑布图",
          paragraphs: [
            "横轴各柱为上述分项占净值百分比，红柱增加、绿柱减少，最后一根深蓝柱为单边敞口合计。",
          ],
        },
      ],
    }
  }, [snapshot, netAssetValue])

  const trendHelp: ChartCalcHelp = {
    heading: "股票单边敞口走势 · 计算说明",
    blocks: [
      {
        title: "时序口径",
        paragraphs: [
          "对策略配置走势的每一个估值日，用当期策略市值权重重算股票方向敞口。权重按当前产品风险权重在各桶内市值加权。不含直持股票、ETF 与已有股指期货（这些项没有完整时序）。",
        ],
        formula: `单边敞口_t = 股票多头_t × ${bucketFactors.longOnlyPct.toFixed(0)}% + 打板_t × ${bucketFactors.limitUpPct.toFixed(0)}% + 股票对冲_t × ${bucketFactors.hedgePct.toFixed(0)}%`,
      },
      {
        title: "各条线",
        bullets: [
          "股票多头：一级策略为「股票多头」或「股票策略」且不含打板的市值权重，乘当前多头有效权重。",
          "打板：策略名含「打板」的市值权重，乘当前打板有效权重。",
          `对冲基金净敞口：一级策略为「股票对冲」的市值权重 × ${bucketFactors.hedgePct.toFixed(0)}%（由产品权重加权）。`,
          "单边敞口：前三项之和，不堆叠到面积上，单独画一条线。",
        ],
      },
    ],
  }

  function commitWeight(holding: FofHedgeHolding, raw: string) {
    const key = hedgeHoldingKey(holding)
    const n = Number(raw)
    const bucket = classifyFofEquityHolding(holding)
    const fallback = defaultHedgeRiskWeightPct(bucket, lsNetPct)
    setWeightDrafts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    if (!Number.isFinite(n) || n < 0) return
    const clipped = Math.min(n, MAX_PRODUCT_RISK_WEIGHT_PCT)
    setOverrides((prev) => {
      const next = { ...prev }
      if (Math.abs(clipped - fallback) < 1e-9) delete next[key]
      else next[key] = clipped
      return next
    })
  }

  function resetWeights() {
    setOverrides({})
    setWeightDrafts({})
    setLsNetDraft(String(DEFAULT_LS_NET_EXPOSURE_PCT))
    setSelectedPresetId("")
    setPresetStatus("已恢复默认权重")
  }

  function applyPreset(preset: WeightPreset) {
    setOverrides({ ...preset.overrides })
    setLsNetDraft(String(preset.lsNetAssumptionPct))
    setWeightDrafts({})
    setPresetName(preset.name)
    setSelectedPresetId(preset.id)
    setPresetScope(preset.scope)
  }

  async function handleSavePreset() {
    const name = presetName.trim() || `方案 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    if (!weightStorageKey) {
      setPresetStatus("当前页面无法保存方案")
      return
    }
    if (!readCurrentUser()) {
      setPresetStatus("请先登录后再保存")
      return
    }
    setPresetBusy(true)
    try {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(weightStorageKey)}/valuation/hedge-weight-presets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            scope: presetScope,
            name,
            lsNetAssumptionPct: lsNetPct,
            overrides,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setPresetStatus(json?.error || "保存失败")
        return
      }
      setTeamPresets(parseServerPresets(json.team))
      setMinePresets(parseServerPresets(json.mine))
      setPresetName(name)
      if (json.preset?.id) setSelectedPresetId(String(json.preset.id))
      setPresetStatus(`已保存到${presetScope === "team" ? "团队" : "我的"}「${name}」`)
    } catch {
      setPresetStatus("保存失败")
    } finally {
      setPresetBusy(false)
    }
  }

  function handleLoadPreset() {
    const preset = presets.find((p) => p.id === selectedPresetId)
      || presets.find((p) => p.name === presetName.trim())
    if (!preset) {
      setPresetStatus(presets.length ? "请先选择要载入的方案" : `还没有${presetScope === "team" ? "团队" : "我的"}方案`)
      return
    }
    applyPreset(preset)
    setPresetStatus(`已载入${preset.scope === "team" ? "团队" : "我的"}「${preset.name}」`)
  }

  async function handleDeletePreset() {
    const preset = presets.find((p) => p.id === selectedPresetId)
      || presets.find((p) => p.name === presetName.trim())
    if (!weightStorageKey || !preset) {
      setPresetStatus("请先选择要删除的方案")
      return
    }
    if (!readCurrentUser()) {
      setPresetStatus("请先登录后再删除")
      return
    }
    setPresetBusy(true)
    try {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(weightStorageKey)}/valuation/hedge-weight-presets?id=${encodeURIComponent(preset.id)}`,
        { method: "DELETE", headers: authHeaders() },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setPresetStatus(json?.error || "删除失败")
        return
      }
      setTeamPresets(parseServerPresets(json.team))
      setMinePresets(parseServerPresets(json.mine))
      if (selectedPresetId === preset.id) setSelectedPresetId("")
      if (presetName.trim() === preset.name) setPresetName("")
      setPresetStatus(`已删除「${preset.name}」`)
    } catch {
      setPresetStatus("删除失败")
    } finally {
      setPresetBusy(false)
    }
  }

  return (
    <>
      <FofAnalysisChartCard
        title="股票单边敞口"
        hint="股票多头与打板默认按满仓计，股票对冲按各产品风险权重（默认为右侧对冲默认净敞口）计，再加直持股票/ETF、减去已有股指期货。得到的净敞口即母基金可用股指期货反向开仓自行对冲的名义。"
        extra={extra}
        calcHelp={snapshotHelp}
      >
        {!snapshot.hasEquityBook ? (
          <EmptyChart text="当前持仓未识别到股票多头、打板、股票对冲或直持股票，单边敞口按 0 计" />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 px-2 pt-1 pb-3">
              <Metric
                label="单边敞口"
                value={fmtPct(snapshot.netExposurePct)}
                hint={fmtWan(snapshot.netExposureMv)}
              />
              <Metric
                label="建议对冲名义"
                value={fmtWan(snapshot.hedgeNotionalMv)}
                hint={hedgeSideLabel(snapshot.hedgeSide)}
              />
              <Metric
                label="打板"
                value={fmtPct(snapshot.limitUpPct)}
                hint={limitUpHint(snapshot.limitUpGrossMv, snapshot.limitUpMv)}
              />
              <Metric
                label="股票多头"
                value={fmtPct(snapshot.longOnlyPct)}
                hint={longOnlyHint(snapshot.longOnlyGrossMv, snapshot.longOnlyMv)}
              />
              <Metric
                label="对冲基金净敞口"
                value={fmtPct(snapshot.lsNetPct)}
                hint={`资本 ${fmtWan(snapshot.lsGrossMv)} × ${snapshot.lsEffectivePct.toFixed(1)}%`}
              />
            </div>
            <ReactECharts option={waterfallOption} style={{ height: 260 }} notMerge />
            <p className="px-3 pt-1 text-[11px] leading-5 text-zinc-400">
              {snapshot.hedgeSide === "none"
                ? "净敞口接近 0，母基金层面不必再开股指期货。"
                : snapshot.hedgeSide === "short_futures"
                  ? `若要把股票方向降到中性，可在 IF/IC/IM/IH 上开空，对冲名义约 ${fmtWan(snapshot.hedgeNotionalMv)}。`
                  : `净敞口为空头，若要回到中性可在股指期货上开多，名义约 ${fmtWan(snapshot.hedgeNotionalMv)}。`}
              {snapshot.existingHedgePct !== 0
                ? ` 估值表已识别股指对冲 ${fmtPct(snapshot.existingHedgePct)}。`
                : ""}
            </p>
          </>
        )}

        <div className="mx-2 mt-3 rounded-md border border-zinc-100">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setWeightsOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${weightsOpen ? "" : "-rotate-90"}`} />
              产品风险权重
              <span className="font-normal text-zinc-400">计入敞口 = 市值 × 权重</span>
            </button>
            <div className="flex items-center gap-2">
              {hiddenOtherCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllProducts(true)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-600"
                >
                  显示其余 {hiddenOtherCount} 只
                </button>
              )}
              {showAllProducts && (
                <button
                  type="button"
                  onClick={() => setShowAllProducts(false)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-600"
                >
                  只看权益相关
                </button>
              )}
              <button
                type="button"
                onClick={resetWeights}
                disabled={Object.keys(overrides).length === 0 && lsNetPct === DEFAULT_LS_NET_EXPOSURE_PCT}
                className="text-[11px] text-zinc-400 hover:text-zinc-700 disabled:opacity-30"
              >
                恢复默认
              </button>
            </div>
          </div>
          {weightsOpen && (
            <div className="overflow-x-auto border-t border-zinc-100">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-50/80 border-b border-zinc-100">
                <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-[11px]">
                  {([
                    ["team", "团队"],
                    ["mine", "我的"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setPresetScope(key)
                        setSelectedPresetId("")
                      }}
                      className={[
                        "px-2.5 h-7 transition-colors",
                        presetScope === key
                          ? "bg-red-50 text-red-600 font-medium"
                          : "bg-white text-zinc-600 hover:bg-zinc-50",
                        key === "mine" ? "border-l border-zinc-200" : "",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="方案名称"
                  className="h-7 w-36 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none focus:border-zinc-400"
                />
                <button
                  type="button"
                  onClick={() => void handleSavePreset()}
                  disabled={presetBusy}
                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  <Save className="h-3 w-3" />
                  保存到{presetScope === "team" ? "团队" : "我的"}
                </button>
                <select
                  value={selectedPresetId}
                  onChange={(e) => {
                    const id = e.target.value
                    setSelectedPresetId(id)
                    const hit = presets.find((p) => p.id === id)
                    if (hit) setPresetName(hit.name)
                  }}
                  className="h-7 min-w-[9rem] rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none"
                >
                  <option value="">{presetScope === "team" ? "团队方案" : "我的方案"}</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.scope === "team" && preset.createdByName
                        ? `${preset.name}（${preset.createdByName}）`
                        : preset.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleLoadPreset}
                  disabled={presets.length === 0 || presetBusy}
                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-30"
                >
                  <FolderOpen className="h-3 w-3" />
                  载入
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeletePreset()}
                  disabled={presets.length === 0 || presetBusy}
                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-200 bg-white px-2 text-[11px] text-zinc-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
                {presetStatus && (
                  <span className="text-[11px] text-amber-700">{presetStatus}</span>
                )}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500">
                    <th className="px-3 py-1.5 text-left font-semibold">产品</th>
                    <th className="px-3 py-1.5 text-left font-semibold whitespace-nowrap">分类</th>
                    <th className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">市值</th>
                    <th className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">风险权重</th>
                    <th className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">计入敞口</th>
                  </tr>
                </thead>
                <tbody>
                  {weightRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                        暂无可设权的底层产品
                      </td>
                    </tr>
                  ) : (
                    weightRows.map((item) => (
                      <tr key={item.key} className="border-t border-zinc-50">
                        <td className="px-3 py-1.5 min-w-0">
                          <div className="truncate text-zinc-800" title={item.row.fundName}>{item.row.fundName}</div>
                          <div className="truncate text-[10px] text-zinc-400">
                            {item.row.fundStrategy || item.row.valuationCode || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-zinc-500">
                          {fofEquityBucketLabel(item.bucket)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 whitespace-nowrap">
                          {fmtMoney(item.row.marketValue)}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <span className="inline-flex items-center justify-end gap-0.5">
                            <input
                              type="number"
                              min={0}
                              max={MAX_PRODUCT_RISK_WEIGHT_PCT}
                              step={5}
                              value={weightDrafts[item.key] ?? String(item.weightPct)}
                              onChange={(e) => setWeightDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                              onBlur={(e) => commitWeight(item.row, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                              }}
                              className={`w-14 h-6 rounded border px-1 text-right tabular-nums ${
                                item.isOverride
                                  ? "border-amber-300 bg-amber-50 text-amber-900"
                                  : "border-zinc-200 text-zinc-800"
                              }`}
                            />
                            %
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 whitespace-nowrap">
                          {fmtMoney(item.riskMv)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="股票单边敞口走势"
        hint="按各期策略市值权重重算：股票多头、打板、股票对冲分别乘当前产品风险权重的市值加权。不含直持股票与已有股指期货。"
        calcHelp={trendHelp}
      >
        {seriesPoints.filter((p) => Math.abs(p.netPct) > 0.05).length < 2 ? (
          <EmptyChart text="策略配置时序不足，无法绘制单边敞口走势" />
        ) : (
          <ReactECharts option={trendOption} style={{ height: 280 }} notMerge />
        )}
      </FofAnalysisChartCard>
    </>
  )
}

function limitUpHint(gross: number, risk: number): string {
  if (Math.abs(gross) < 1) return "未识别到打板产品"
  if (Math.abs(gross - risk) < 1) return fmtWan(risk)
  return `资本 ${fmtWan(gross)}，按产品权重计入`
}

function longOnlyHint(gross: number, risk: number): string {
  if (Math.abs(gross - risk) < 1) return fmtWan(risk)
  return `资本 ${fmtWan(gross)}，按产品权重计入`
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400 leading-4">{hint}</div>
    </div>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
      {text}
    </div>
  )
}
