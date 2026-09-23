"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { FundHoldingRow } from "./FofFundsPanel"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"

const UNCONFIGURED = "未配置"

const STRATEGY_COLORS: Record<string, string> = {
  组合策略: "#1A73E8",
  股票多头: "#D93025",
  期货策略: "#FBBC04",
  股票对冲: "#9333ea",
  套利策略: "#22c55e",
  多资产策略: "#14b8a6",
  债券策略: "#8B5CF6",
  期权策略: "#EC4899",
  其他: "#78716C",
  [UNCONFIGURED]: "#9ca3af",
}

const PALETTE = ["#D93025", "#FBBC04", "#9333ea", "#22c55e", "#14b8a6", "#EC4899", "#1A73E8", "#8B5CF6", "#78716C"]

export type StrategyPieSelection = {
  l1: string | null
  l2: string | null
}

type Slice = {
  name: string
  value: number
  marketPct: number
}

type ParsedHolding = {
  l1: string
  l2: string
  marketValue: number
  marketPct: number
}

type Props = {
  rows: FundHoldingRow[]
  selection: StrategyPieSelection
  onSelectionChange: (next: StrategyPieSelection) => void
}

function colorFor(name: string, index: number): string {
  return STRATEGY_COLORS[name] ?? PALETTE[index % PALETTE.length]
}

function parseHolding(row: FundHoldingRow): ParsedHolding {
  const fromPath = (row.fundStrategy ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  const l1 = row.strategyL1?.trim() || fromPath[0] || UNCONFIGURED
  const l2 = row.strategyL2?.trim() || fromPath[1] || UNCONFIGURED
  return {
    l1,
    l2,
    marketValue: row.marketValue,
    marketPct: row.marketPct,
  }
}

function aggregate(
  rows: ParsedHolding[],
  keysFor: (row: ParsedHolding) => string[],
): Slice[] {
  const map = new Map<string, { value: number; marketPct: number }>()
  for (const row of rows) {
    const keys = keysFor(row)
    if (keys.length === 0) continue
    const share = 1 / keys.length
    for (const name of keys) {
      const cur = map.get(name) ?? { value: 0, marketPct: 0 }
      cur.value += row.marketValue * share
      cur.marketPct += row.marketPct * share
      map.set(name, cur)
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value)
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildPieOption(slices: Slice[], selectedName: string | null) {
  return {
    color: slices.map((s, i) => colorFor(s.name, i)),
    tooltip: {
      trigger: "item" as const,
      formatter: (p: { name: string; value: number; percent: number; data: Slice }) =>
        `${p.name}<br/>市值 ${fmtMoney(p.value)}<br/>饼图占比 ${p.percent.toFixed(2)}%<br/>市值占比 ${p.data.marketPct.toFixed(4)}%`,
    },
    legend: {
      type: slices.length > 6 ? "scroll" as const : "plain" as const,
      orient: "horizontal" as const,
      bottom: 2,
      left: "center",
      width: "94%",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 8,
      textStyle: { fontSize: 10, color: "#666" },
      pageIconSize: 8,
      pageButtonItemGap: 4,
      pageTextStyle: { fontSize: 10 },
      data: slices.map((s) => s.name),
    },
    series: [{
      type: "pie" as const,
      radius: ["30%", "48%"],
      center: ["50%", "44%"],
      avoidLabelOverlap: true,
      minShowLabelAngle: 0,
      selectedMode: false,
      cursor: "pointer",
      label: {
        show: true,
        position: "outside" as const,
        formatter: (p: { name: string; percent: number }) =>
          `${p.name} ${p.percent.toFixed(1)}%`,
        fontSize: 11,
        color: "#52525b",
      },
      labelLine: {
        show: true,
        length: 14,
        length2: 10,
        smooth: 0.15,
      },
      labelLayout: {
        hideOverlap: false,
        moveOverlap: "shiftY" as const,
      },
      data: slices.map((s, i) => ({
        ...s,
        itemStyle: {
          color: colorFor(s.name, i),
          borderColor: selectedName === s.name ? "#111827" : "#fff",
          borderWidth: selectedName === s.name ? 2 : 1,
          shadowBlur: selectedName === s.name ? 8 : 0,
          shadowColor: "rgba(0,0,0,0.25)",
        },
      })),
    }],
  }
}

function StrategyPie({
  title,
  hint,
  slices,
  selectedName,
  emptyText,
  onSliceClick,
}: {
  title: string
  hint: string
  slices: Slice[]
  selectedName: string | null
  emptyText: string
  onSliceClick: (name: string) => void
}) {
  const option = useMemo(() => buildPieOption(slices, selectedName), [slices, selectedName])
  return (
    <div className="min-w-0">
      <div className="px-1 mb-1">
        <div className="flex items-center gap-1">
          <div className="text-sm font-semibold text-zinc-800">{title}</div>
          <ChartCalcHelpButton
            heading={`${title} · 计算说明`}
            blocks={[
              {
                title: "切片大小",
                paragraphs: [
                  "按当前下钻范围内的基金持仓加总市值。饼图占比是该层各切片市值占本层合计的比例；提示里的「市值占比」是占母基金资产净值。",
                ],
                formula: "饼图占比 = 切片市值 / 本层合计市值\n市值占比 = 切片市值 / 资产净值",
              },
            ]}
          />
        </div>
        <div className="text-[11px] text-zinc-400 truncate" title={hint}>{hint}</div>
      </div>
      {slices.length > 0 ? (
        <ReactECharts
          option={option}
          style={{ height: 360 }}
          notMerge
          onEvents={{
            click: (params: { name?: string }) => {
              if (params.name) onSliceClick(params.name)
            },
          }}
        />
      ) : (
        <div className="h-[360px] flex items-center justify-center text-xs text-zinc-400 px-6 text-center">
          {emptyText}
        </div>
      )}
    </div>
  )
}

export function FofStrategyPiesPanel({ rows, selection, onSelectionChange }: Props) {
  const parsed = useMemo(() => rows.map(parseHolding), [rows])

  const l1Slices = useMemo(
    () => aggregate(parsed, (row) => [row.l1]),
    [parsed],
  )

  const l2Rows = useMemo(
    () => (selection.l1 ? parsed.filter((row) => row.l1 === selection.l1) : parsed),
    [parsed, selection.l1],
  )
  const l2Slices = useMemo(
    () => aggregate(l2Rows, (row) => [row.l2]),
    [l2Rows],
  )

  const crumb = [selection.l1, selection.l2].filter(Boolean) as string[]

  function inferL1(l2Name: string): string | null {
    const parents = parsed.filter((row) => row.l2 === l2Name)
    const values = [...new Set(parents.map((row) => row.l1))]
    return values[0] ?? null
  }

  function handleL1(name: string) {
    if (selection.l1 === name) {
      onSelectionChange({ l1: null, l2: null })
      return
    }
    onSelectionChange({ l1: name, l2: null })
  }

  function handleL2(name: string) {
    const l1 = selection.l1 ?? inferL1(name)
    if (selection.l2 === name && selection.l1 === l1) {
      onSelectionChange({ l1, l2: null })
      return
    }
    onSelectionChange({ l1, l2: name })
  }

  function resetTo(level: 0 | 1) {
    if (level === 0) onSelectionChange({ l1: null, l2: null })
    else onSelectionChange({ l1: selection.l1, l2: null })
  }

  if (parsed.length === 0) return null

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="text-red-500 font-semibold text-sm leading-tight">团队策略</div>
            <ChartCalcHelpButton
              heading="团队策略饼图 · 计算说明"
              blocks={[
                {
                  title: "分类",
                  paragraphs: [
                    "底层基金的一级/二级来自团队策略库；缺失时回退估值表策略路径，再记为「未配置」。",
                  ],
                },
                {
                  title: "下钻",
                  paragraphs: [
                    "点一级切片筛选二级。重置回到全部。",
                  ],
                },
              ]}
            />
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            按一级 / 二级分类，点击饼图下钻
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1.5 text-xs text-zinc-500">
            <button type="button" className="hover:text-red-500" onClick={() => resetTo(0)}>
              全部
            </button>
            {crumb.map((name, i) => (
              <span key={`${i}-${name}`} className="inline-flex items-center gap-1">
                <span className="text-zinc-300">/</span>
                <button
                  type="button"
                  className={i === crumb.length - 1 ? "text-red-500 font-medium" : "hover:text-red-500"}
                  onClick={() => {
                    if (i < crumb.length - 1) resetTo(1)
                  }}
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => resetTo(0)}
          disabled={!selection.l1 && !selection.l2}
          className="px-3 py-1 text-xs rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          重置
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 px-3 pb-3">
        <StrategyPie
          title="一级策略"
          hint="点击切片筛选二级"
          slices={l1Slices}
          selectedName={selection.l1}
          emptyText="暂无策略数据"
          onSliceClick={handleL1}
        />
        <StrategyPie
          title="二级策略"
          hint={selection.l1 ? `${selection.l1} · 点击切片筛选` : "全部二级 · 点击切片筛选"}
          slices={l2Slices}
          selectedName={selection.l2}
          emptyText="暂无二级策略"
          onSliceClick={handleL2}
        />
      </div>
    </div>
  )
}
