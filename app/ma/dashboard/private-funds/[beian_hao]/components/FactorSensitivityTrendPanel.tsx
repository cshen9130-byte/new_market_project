"use client"

import { memo, useMemo, useRef, useState } from "react"
import { HelpCircle, Menu } from "lucide-react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED } from "./shared"
import {
  STYLE_FACTOR_DEFS,
  type FactorSensitivityColumn,
  type FactorSensitivityTrend,
} from "@/lib/style-attribution"

const INTERVAL_COLOR = "#2563eb"

function fmtCoeff(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return v.toFixed(4)
}

function computeRadarDomain(columns: FactorSensitivityColumn[]): [number, number] {
  const vals = columns.flatMap((col) => col.factors.map((f) => f.coefficient))
  if (!vals.length) return [-1, 1]
  const min = Math.min(...vals, -0.2)
  const max = Math.max(...vals, 0.2)
  const pad = Math.max((max - min) * 0.15, 0.1)
  const lo = Math.floor((min - pad) * 5) / 5
  const hi = Math.ceil((max + pad) * 5) / 5
  return [lo, hi]
}

async function downloadPanelImage(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas-pro")
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true })
  const url = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
}

export const FactorSensitivityTrendPanel = memo(function FactorSensitivityTrendPanel({
  productName,
  dateFrom,
  dateTo,
  trend,
  loading,
}: {
  productName: string
  dateFrom: string
  dateTo: string
  trend: FactorSensitivityTrend | null
  loading: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [periodMode, setPeriodMode] = useState<"annual" | "quarterly">("annual")

  const columns = useMemo(
    () => (periodMode === "annual" ? trend?.annualColumns : trend?.quarterlyColumns) ?? [],
    [periodMode, trend],
  )

  const intervalColumn = useMemo(
    () => columns.find((c) => c.isInterval) ?? null,
    [columns],
  )

  const compareColumn = useMemo(() => {
    const nonInterval = columns.filter((c) => !c.isInterval)
    return nonInterval[nonInterval.length - 1] ?? null
  }, [columns])

  const radarData = useMemo(() => {
    if (!compareColumn || !intervalColumn) return []
    return STYLE_FACTOR_DEFS.map((def) => {
      const primary = compareColumn.factors.find((f) => f.factorKey === def.key)
      const interval = intervalColumn.factors.find((f) => f.factorKey === def.key)
      return {
        factor: def.name,
        [compareColumn.label]: primary?.coefficient ?? null,
        [intervalColumn.label]: interval?.coefficient ?? null,
      }
    })
  }, [compareColumn, intervalColumn])

  const radarDomain = useMemo(
    () => computeRadarDomain(columns.filter((c) => compareColumn && intervalColumn && (c.key === compareColumn.key || c.key === intervalColumn.key))),
    [columns, compareColumn, intervalColumn],
  )

  const tableColumns = columns

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-5 min-h-[360px] flex items-center justify-center text-sm text-zinc-400">
        加载因子敏感度中…
      </div>
    )
  }

  if (!trend || !columns.length || !intervalColumn) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-5 min-h-[360px] flex items-center justify-center text-sm text-zinc-400">
        暂无因子敏感度数据
      </div>
    )
  }

  return (
    <div ref={panelRef} className="rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
          因子敏感度趋势
          <HelpCircle className="h-3.5 w-3.5 text-zinc-400" aria-label="因子敏感度趋势说明" />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex text-xs border border-zinc-200 rounded overflow-hidden">
            <button
              type="button"
              onClick={() => setPeriodMode("quarterly")}
              className={`px-3 py-1 transition-colors ${
                periodMode === "quarterly"
                  ? "bg-white text-red-600 border-red-400 font-medium"
                  : "bg-white text-zinc-500 hover:text-zinc-800"
              }`}
            >
              季度
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode("annual")}
              className={`px-3 py-1 transition-colors border-l border-zinc-200 ${
                periodMode === "annual"
                  ? "bg-white text-red-600 border-red-400 font-medium"
                  : "bg-white text-zinc-500 hover:text-zinc-800"
              }`}
            >
              年度
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                aria-label="图表菜单"
              >
                <Menu className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
              <DropdownMenuItem
                onClick={() => panelRef.current && downloadPanelImage(
                  panelRef.current,
                  `${productName}_因子敏感度趋势_${dateFrom}_${dateTo}.png`,
                )}
              >
                下载图片
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-5 items-stretch">
        <div className="xl:w-[48%] min-w-0">
          {compareColumn && radarData.length > 0 ? (
            <div style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="52%" outerRadius="62%">
                  <PolarGrid stroke="#e4e4e7" />
                  <PolarAngleAxis
                    dataKey="factor"
                    tick={{ fontSize: 9, fill: "#a1a1aa" }}
                  />
                  <PolarRadiusAxis
                    domain={radarDomain}
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    axisLine={false}
                    tickCount={6}
                  />
                  <Radar
                    name={compareColumn.label}
                    dataKey={compareColumn.label}
                    stroke={RED}
                    fill={RED}
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: RED }}
                    isAnimationActive={false}
                  />
                  <Radar
                    name={intervalColumn.label}
                    dataKey={intervalColumn.label}
                    stroke={INTERVAL_COLOR}
                    fill={INTERVAL_COLOR}
                    fillOpacity={0.08}
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: INTERVAL_COLOR }}
                    isAnimationActive={false}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    iconType="line"
                    iconSize={14}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[340px] flex items-center justify-center text-sm text-zinc-400">
              暂无对比周期数据
            </div>
          )}
        </div>

        <div className="xl:flex-1 min-w-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[420px]">
            <thead>
              <tr className="border-b border-zinc-100 text-zinc-500">
                <th className="py-2 pr-3 text-left font-medium w-10">序号</th>
                <th className="py-2 pr-3 text-left font-medium min-w-[120px]">因子名称</th>
                {tableColumns.map((col) => (
                  <th key={col.key} className="py-2 px-2 text-right font-medium whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STYLE_FACTOR_DEFS.map((def, idx) => (
                <tr
                  key={def.key}
                  className={idx % 2 === 0 ? "bg-zinc-50/50" : "bg-white"}
                >
                  <td className="py-2 pr-3 tabular-nums text-zinc-500">{idx + 1}</td>
                  <td className="py-2 pr-3 text-zinc-800">{def.name}</td>
                  {tableColumns.map((col) => {
                    const row = col.factors.find((f) => f.factorKey === def.key)
                    return (
                      <td key={col.key} className="py-2 px-2 text-right tabular-nums text-zinc-700">
                        {fmtCoeff(row?.coefficient)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t border-zinc-100 bg-zinc-50/80">
                <td className="py-2.5 pr-3 tabular-nums text-zinc-500">{STYLE_FACTOR_DEFS.length + 1}</td>
                <td className="py-2.5 pr-3 text-zinc-800 font-medium">R方值</td>
                {tableColumns.map((col) => (
                  <td key={col.key} className="py-2.5 px-2 text-right tabular-nums text-zinc-800 font-medium">
                    {fmtCoeff(col.rSquared)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
})
