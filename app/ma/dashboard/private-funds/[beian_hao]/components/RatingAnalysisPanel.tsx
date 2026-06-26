"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, HelpCircle } from "lucide-react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from "recharts"
import type { FundRatingResult, RatingPeriodAnalysis, RatingMetricDetail, ScoreLevel } from "@/lib/fund-rating"
import { RED } from "./shared"

function benchPhrase(vs: RatingMetricDetail["vsBenchmark"], benchmarkLabel: string | null): string {
  if (!vs || !benchmarkLabel) return ""
  return vs === "better" ? `，好于${benchmarkLabel}` : `，差于${benchmarkLabel}`
}

function metricLine(
  metric: RatingMetricDetail,
  sampleN: number,
  benchmarkLabel: string | null,
): string {
  const rankPart = metric.rank !== null && sampleN > 0 ? `，同类排名${metric.rank}/${sampleN}` : ""
  const levelPart = metric.level ? `，表现${metric.level}` : ""
  const scorePart = metric.score !== null ? `（${metric.score.toFixed(2)}分）` : ""
  return `${metric.label}${metric.displayValue}${rankPart}${levelPart}${scorePart}${benchPhrase(metric.vsBenchmark, benchmarkLabel)}`
}

function levelWord(level: ScoreLevel | null): string {
  return level ?? "—"
}

function buildNarrative(
  analysis: RatingPeriodAnalysis,
  rowSampleN: number,
  benchmarkLabel: string | null,
) {
  const overview = (() => {
    const levels = [analysis.returnLevel, analysis.defenseLevel, analysis.riskAdjustedLevel].filter(Boolean)
    const allSame = levels.length === 3 && levels.every((l) => l === levels[0])
    const levelDesc = allSame
      ? `均为${levels[0]}水平`
      : `收益能力${levelWord(analysis.returnLevel)}、防守能力${levelWord(analysis.defenseLevel)}、风险调整收益${levelWord(analysis.riskAdjustedLevel)}`
    return [
      `${analysis.periodLabel}${allSame ? "" : "的"}${levelDesc}`,
      analysis.totalScore !== null ? `，总评分${analysis.totalScore.toFixed(2)}` : "",
      analysis.totalOutperformPct !== null ? `（超越同类${analysis.totalOutperformPct.toFixed(2)}%）` : "",
      "。",
    ].join("")
  })()

  const returnText = analysis.returnMetrics.length
    ? `收益能力：${analysis.returnMetrics.map((m) => metricLine(m, rowSampleN, benchmarkLabel)).join("；")}。`
    : ""

  const defenseText = analysis.defenseMetrics.length
    ? `防守能力：${analysis.defenseMetrics.map((m) => metricLine(m, rowSampleN, benchmarkLabel)).join("；")}。`
    : ""

  const riskText = analysis.riskAdjustedMetrics.length
    ? `风险调整收益：${analysis.riskAdjustedMetrics.map((m) => metricLine(m, rowSampleN, benchmarkLabel)).join("；")}。`
    : ""

  return { overview, returnText, defenseText, riskText }
}

const CustomAngleTick = ({
  payload,
  x,
  y,
  cx,
  cy,
  radarData,
}: {
  payload?: { value?: string }
  x?: number
  y?: number
  cx?: number
  cy?: number
  radarData: Array<{ axis: string; score: number | null }>
}) => {
  if (x === undefined || y === undefined || !payload?.value) return null
  const item = radarData.find((d) => d.axis === payload.value)
  const score = item?.score
  const dx = cx !== undefined ? (x - cx) * 0.08 : 0
  const dy = cy !== undefined ? (y - cy) * 0.08 : 0
  return (
    <g transform={`translate(${x + dx},${y + dy})`}>
      <text textAnchor="middle" fill="#71717a" fontSize={11}>
        {payload.value}
      </text>
      {score !== null && (
        <text textAnchor="middle" fill="#27272a" fontSize={12} fontWeight={600} dy={14}>
          {score.toFixed(2)}
        </text>
      )}
    </g>
  )
}

export const RatingAnalysisPanel = memo(function RatingAnalysisPanel({
  data,
  cutoffDate,
  selectedPeriodKey,
  onPeriodChange,
}: {
  data: FundRatingResult
  cutoffDate: string
  selectedPeriodKey: string
  onPeriodChange: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const selectedRow = useMemo(
    () => data.rows.find((r) => r.periodKey === selectedPeriodKey) ?? data.rows[0] ?? null,
    [data.rows, selectedPeriodKey],
  )

  const analysis = useMemo(
    () => data.analyses.find((a) => a.periodKey === selectedPeriodKey) ?? data.analyses[0] ?? null,
    [data.analyses, selectedPeriodKey],
  )

  const radarData = useMemo(() => {
    if (!analysis) return []
    return [
      { axis: "收益能力", score: analysis.returnScore, fullMark: 100 },
      { axis: "防守能力", score: analysis.defenseScore, fullMark: 100 },
      { axis: "风险调整收益", score: analysis.riskAdjustedScore, fullMark: 100 },
    ]
  }, [analysis])

  const narrative = useMemo(() => {
    if (!analysis || !selectedRow) return null
    return buildNarrative(analysis, selectedRow.sampleN, data.benchmarkLabel)
  }, [analysis, selectedRow, data.benchmarkLabel])

  if (!data.analyses.length || !analysis || !selectedRow) return null

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: RED }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            评分解析
            <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
          </div>
          {cutoffDate && (
            <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
              截止日期：{cutoffDate}
              <HelpCircle className="h-3 w-3 text-zinc-400" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-600">
          <span className="text-zinc-500 whitespace-nowrap">评分周期：</span>
          <select
            value={selectedPeriodKey}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[100px]"
          >
            {data.rows.map((row) => (
              <option key={row.periodKey} value={row.periodKey}>{row.periodLabel}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
          <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
          {analysis.periodLabel}综合评价
        </div>
        <div className="text-xs text-zinc-600 pl-3">
          总评分：
          <span className="font-semibold text-zinc-800 tabular-nums">
            {analysis.totalScore?.toFixed(2) ?? "—"}
          </span>
          {analysis.totalOutperformPct !== null && (
            <span className="text-zinc-500">
              {" "}(超越同类{analysis.totalOutperformPct.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-stretch">
        <div className="lg:w-[42%] min-w-0 flex items-center justify-center">
          <div className="w-full" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="52%" outerRadius="68%">
                <PolarGrid stroke="#e4e4e7" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={(props) => <CustomAngleTick {...props} radarData={radarData} />}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  axisLine={false}
                  tickCount={5}
                />
                <Radar
                  name="评分"
                  dataKey="score"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.25}
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: "#3b82f6" }}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:flex-1 min-w-0">
          <div
            className={[
              "rounded-lg border border-zinc-100 px-4 py-3 text-xs text-zinc-700 leading-relaxed space-y-3",
              expanded ? "max-h-none" : "max-h-[280px] overflow-hidden relative",
            ].join(" ")}
            style={{ backgroundColor: "#faf8f5" }}
          >
            {narrative && (
              <>
                <p>
                  <span className="font-semibold text-zinc-800">综合评价：</span>
                  {narrative.overview}
                </p>
                {narrative.returnText && (
                  <p>
                    <span className="font-semibold text-zinc-800">收益能力：</span>
                    {narrative.returnText.replace(/^收益能力：/, "")}
                  </p>
                )}
                {narrative.defenseText && (
                  <p>
                    <span className="font-semibold text-zinc-800">防守能力：</span>
                    {narrative.defenseText.replace(/^防守能力：/, "")}
                  </p>
                )}
                {narrative.riskText && (
                  <p>
                    <span className="font-semibold text-zinc-800">风险调整收益：</span>
                    {narrative.riskText.replace(/^风险调整收益：/, "")}
                  </p>
                )}
              </>
            )}
            {!expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#faf8f5] to-transparent pointer-events-none" />
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 w-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors"
            aria-label={expanded ? "收起" : "展开"}
          >
            <ChevronDown className={["h-4 w-4 transition-transform", expanded ? "rotate-180" : ""].join(" ")} />
          </button>
        </div>
      </div>
    </div>
  )
})
