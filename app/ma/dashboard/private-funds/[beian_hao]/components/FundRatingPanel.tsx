"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Download, Eye, HelpCircle } from "lucide-react"
import { RED } from "./shared"
import type { FundRatingResult, RatingPeriodRow } from "@/lib/fund-rating"
import { RatingAnalysisPanel } from "./RatingAnalysisPanel"
import { RatingContributionPanel } from "./RatingContributionPanel"

function PlatformTag() {
  return (
    <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">
      平台
    </span>
  )
}

function ScoreCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-zinc-400">—</span>
  return <span className="tabular-nums font-medium text-zinc-800">{value.toFixed(2)}</span>
}

function RankCell({ rank, sampleN }: { rank: number | null; sampleN: number }) {
  if (rank === null || sampleN <= 0) return <span className="text-zinc-400">—</span>
  return (
    <span className="tabular-nums font-medium" style={{ color: RED }}>
      {rank}/{sampleN}
    </span>
  )
}

function OutperformCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-zinc-400">—</span>
  return <span className="tabular-nums text-zinc-700">{value.toFixed(2)}%</span>
}

function CheckboxToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
    >
      <span
        aria-hidden="true"
        className={[
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
          checked ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
        ].join(" ")}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      {label}
    </button>
  )
}

function RatingDetailModal({
  row,
  onClose,
}: {
  row: RatingPeriodRow
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-[420px] max-w-[95vw]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <span className="font-semibold text-zinc-900 text-sm">{row.periodLabel} 评分明细</span>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <span className="text-zinc-500">总评分</span>
            <ScoreCell value={row.totalScore} />
            <span className="text-zinc-500">收益能力评分</span>
            <ScoreCell value={row.returnScore} />
            <span className="text-zinc-500">防守能力评分</span>
            <ScoreCell value={row.defenseScore} />
            <span className="text-zinc-500">风险调整收益评分</span>
            <ScoreCell value={row.riskAdjustedScore} />
            <span className="text-zinc-500">样本数量</span>
            <span className="tabular-nums text-zinc-800">{row.sampleN || "—"}</span>
          </div>
        </div>
        <div className="flex justify-end px-5 py-3 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export const FundRatingPanel = memo(function FundRatingPanel({
  beian_hao,
  productName,
  cutoffDate,
  navSource,
  sampleGroup,
  benchmarkKey,
}: {
  beian_hao: string
  productName: string
  cutoffDate: string
  navSource: string
  sampleGroup: string | null
  benchmarkKey?: string
}) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<FundRatingResult | null>(null)
  const [showRank, setShowRank] = useState(true)
  const [showOutperform, setShowOutperform] = useState(true)
  const [detailRow, setDetailRow] = useState<RatingPeriodRow | null>(null)
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("3m")

  useEffect(() => {
    if (data?.rows[0]?.periodKey) setSelectedPeriodKey(data.rows[0].periodKey)
  }, [data?.rows])

  useEffect(() => {
    if (!beian_hao || !cutoffDate) return
    let cancelled = false
    setLoading(true)
    const qs = new URLSearchParams({
      cutoff: cutoffDate,
      navSource: navSource === "团队净值" ? "team" : "platform",
      pool: "platform",
    })
    if (benchmarkKey) qs.set("benchmark", benchmarkKey)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/fund-rating?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return
        if (json && Array.isArray(json.rows)) setData(json as FundRatingResult)
        else setData(null)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [beian_hao, cutoffDate, navSource, benchmarkKey])

  const exportCsv = useCallback(() => {
    if (!data?.rows.length) return
    const headers = [
      "评分周期",
      "总评分",
      ...(showRank ? ["总评分排名"] : []),
      ...(showOutperform ? ["总评分超越同类"] : []),
      "收益能力评分",
      ...(showRank ? ["收益能力评分排名"] : []),
      ...(showOutperform ? ["收益能力超越同类"] : []),
      "防守能力评分",
      ...(showRank ? ["防守能力评分排名"] : []),
      ...(showOutperform ? ["防守能力超越同类"] : []),
    ]
    const rows = data.rows.map((row) => [
      row.periodLabel,
      row.totalScore?.toFixed(2) ?? "",
      ...(showRank ? [`${row.totalRank ?? ""}/${row.sampleN || ""}`] : []),
      ...(showOutperform ? [row.totalOutperformPct?.toFixed(2) ?? ""] : []),
      row.returnScore?.toFixed(2) ?? "",
      ...(showRank ? [`${row.returnRank ?? ""}/${row.sampleN || ""}`] : []),
      ...(showOutperform ? [row.returnOutperformPct?.toFixed(2) ?? ""] : []),
      row.defenseScore?.toFixed(2) ?? "",
      ...(showRank ? [`${row.defenseRank ?? ""}/${row.sampleN || ""}`] : []),
      ...(showOutperform ? [row.defenseOutperformPct?.toFixed(2) ?? ""] : []),
    ])
    const escape = (v: string) => (v.includes(",") || v.includes("\"") ? `"${v.replace(/"/g, "\"\"")}"` : v)
    const bom = "\uFEFF"
    const blob = new Blob(
      [bom + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_评分概览_${cutoffDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, productName, cutoffDate, showRank, showOutperform])

  const ratingModel = data?.ratingModel ?? "综合评分模型"
  const displaySampleGroup = data?.sampleGroup ?? sampleGroup
  const displayNavSource = data?.navSource ?? navSource

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1 py-2 border-b border-zinc-100">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-600">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-zinc-500">评分模型：</span>
            <span className="text-zinc-800 font-medium">{ratingModel}</span>
            <PlatformTag />
          </div>
          {displaySampleGroup && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">样本组：</span>
              <span className="text-zinc-800 font-medium">{displaySampleGroup}</span>
              <PlatformTag />
            </div>
          )}
          <div className="inline-flex items-center gap-1.5">
            <span className="text-zinc-500">净值来源：</span>
            <span className="text-zinc-800 font-medium">{displayNavSource}</span>
            <HelpCircle className="h-3.5 w-3.5 text-zinc-400" aria-label="净值来源说明" />
          </div>
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded text-xs text-white font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: "#dc2626" }}
        >
          修改评分规则
        </button>
      </div>

      <div className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              评分概览
              <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
            </div>
            {cutoffDate && (
              <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
                截止日期：{cutoffDate}
                <HelpCircle className="h-3 w-3 text-zinc-400" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <CheckboxToggle checked={showRank} onChange={() => setShowRank((v) => !v)} label="评分排名" />
            <CheckboxToggle checked={showOutperform} onChange={() => setShowOutperform((v) => !v)} label="超越同类" />
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data?.rows.length}
              className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-400">加载评分数据…</div>
        ) : !data?.rows.length ? (
          <div className="py-16 text-center text-sm text-zinc-400">暂无评分数据</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-100">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">评分周期</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">总评分</th>
                  {showRank && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">总评分排名</th>
                  )}
                  {showOutperform && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">总评分超越同类</th>
                  )}
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">收益能力评分</th>
                  {showRank && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">收益能力评分排名</th>
                  )}
                  {showOutperform && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">收益能力超越同类</th>
                  )}
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">防守能力评分</th>
                  {showRank && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">防守能力评分排名</th>
                  )}
                  {showOutperform && (
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">防守能力超越同类</th>
                  )}
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap w-16">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => (
                  <tr
                    key={row.periodKey}
                    className={[
                      "border-b border-zinc-50 last:border-0",
                      idx % 2 === 1 ? "bg-zinc-50/40" : "",
                    ].join(" ")}
                  >
                    <td className="px-4 py-2.5 text-xs text-zinc-800 font-medium whitespace-nowrap">{row.periodLabel}</td>
                    <td className="px-3 py-2.5 text-center text-xs"><ScoreCell value={row.totalScore} /></td>
                    {showRank && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <RankCell rank={row.totalRank} sampleN={row.sampleN} />
                      </td>
                    )}
                    {showOutperform && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <OutperformCell value={row.totalOutperformPct} />
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center text-xs"><ScoreCell value={row.returnScore} /></td>
                    {showRank && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <RankCell rank={row.returnRank} sampleN={row.sampleN} />
                      </td>
                    )}
                    {showOutperform && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <OutperformCell value={row.returnOutperformPct} />
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center text-xs"><ScoreCell value={row.defenseScore} /></td>
                    {showRank && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <RankCell rank={row.defenseRank} sampleN={row.sampleN} />
                      </td>
                    )}
                    {showOutperform && (
                      <td className="px-3 py-2.5 text-center text-xs">
                        <OutperformCell value={row.defenseOutperformPct} />
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => setDetailRow(row)}
                        className="inline-flex items-center justify-center p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
                        aria-label={`查看${row.periodLabel}评分明细`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && data?.analyses.length ? (
        <>
          <RatingAnalysisPanel
            data={data}
            cutoffDate={cutoffDate}
            selectedPeriodKey={selectedPeriodKey}
            onPeriodChange={setSelectedPeriodKey}
          />
          <RatingContributionPanel data={data} selectedPeriodKey={selectedPeriodKey} />
        </>
      ) : null}

      {detailRow && <RatingDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </>
  )
})
