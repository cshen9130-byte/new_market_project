"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import {
  DATA_OVERVIEW_SCOPES,
  type DataOverviewResponse,
  type DataOverviewScope,
} from "@/lib/ops-data-overview"

function formatCount(count: number): string {
  return count.toLocaleString("zh-CN")
}

function formatShare(share: number): string {
  const pct = share * 100
  if (!Number.isFinite(pct) || pct === 0) return "0%"
  if (pct >= 99.95) return "100%"
  return `${pct.toFixed(1)}%`
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function sectionCount(body: DataOverviewResponse, sectionKey: string, rowKey: string): number {
  const section = body.sections.find((item) => item.key === sectionKey)
  return section?.rows.find((row) => row.key === rowKey)?.count ?? 0
}

export function OperationsDataOverviewView() {
  const [scope, setScope] = useState<DataOverviewScope>("all")
  const [body, setBody] = useState<DataOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestSeq = useRef(0)

  const load = useCallback((next: DataOverviewScope, refresh: boolean) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ scope: next })
    if (refresh) params.set("refresh", "1")
    fetch(`/ma/api/ops/data-overview?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.sections)) {
          throw new Error(typeof json?.message === "string" ? json.message : "数据概览加载失败")
        }
        setBody(json as DataOverviewResponse)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "数据概览加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(scope, false)
  }, [scope, load])

  const visible = body?.scope === scope ? body : null
  const cards = visible
    ? [
        { label: "产品总数", value: visible.total },
        { label: "在跟踪池", value: sectionCount(visible, "tracking", "in") },
        { label: "邮箱抓取", value: sectionCount(visible, "update_method", "email") },
        { label: "手动更新", value: sectionCount(visible, "update_method", "manual") },
        { label: "fof99", value: sectionCount(visible, "update_method", "fof99") },
        { label: "最新一周", value: sectionCount(visible, "nav_freshness", "w0") },
        {
          label: "滞后超2周",
          value: ["w2", "w3", "m1_3", "m3_6", "over_m6", "none"].reduce(
            (sum, key) => sum + sectionCount(visible, "nav_freshness", key),
            0,
          ),
        },
        { label: "缺失要素", value: sectionCount(visible, "elements", "missing") },
        { label: "无净值", value: sectionCount(visible, "nav", "absent") },
        { label: "有异常", value: sectionCount(visible, "anomaly", "jump") },
        ...(sectionCount(visible, "anomaly", "unchecked") > 0
          ? [{ label: "异常未检测", value: sectionCount(visible, "anomaly", "unchecked") }]
          : []),
      ]
    : []

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="bg-background border rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">数据概览</h2>
            <p className="mt-1 text-xs text-zinc-500 leading-5 max-w-3xl">
              {visible?.description ?? "按全库、团队数据、平台数据或跟踪池查看产品状态，不展开到单只产品。"}
              {" "}红色数字打开对应列表，并带上这个状态。
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(scope, true)}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
        <div className="mt-3 flex items-center flex-wrap gap-1">
          <span className="text-zinc-400 text-xs w-12 shrink-0">范围</span>
          {DATA_OVERVIEW_SCOPES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setScope(item.key)}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                scope === item.key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
          {visible?.generated_at && (
            <span className="ml-auto text-[11px] text-zinc-400">
              统计时间 {formatGeneratedAt(visible.generated_at)}
              {loading ? " · 更新中" : ""}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {loading && !visible && (
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
          正在统计产品状态…
        </div>
      )}

      {visible && (
        <>
          <div className={`grid grid-cols-2 md:grid-cols-5 gap-2 ${loading ? "opacity-60" : ""}`}>
            {cards.map((card) => (
              <div key={card.label} className="rounded-xl border bg-background px-3 py-2.5 shadow-sm">
                <div className="text-[11px] text-zinc-400">{card.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
              </div>
            ))}
          </div>

          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3 ${loading ? "opacity-60" : ""}`}>
            {visible.sections.map((section) => (
              <section key={section.key} className="rounded-xl border bg-background shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b">
                  <h3 className="text-xs font-semibold text-foreground">{section.title}</h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">{section.hint}</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="px-4 py-1.5 text-left font-medium">状态</th>
                      <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
                      <th className="px-4 py-1.5 text-right font-medium w-16">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => {
                      const width = Math.max(0, Math.min(100, row.share * 100))
                      const count = (
                        <span className="relative z-[1] tabular-nums">{formatCount(row.count)}</span>
                      )
                      return (
                        <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="relative ml-auto inline-flex min-w-[4.5rem] justify-end">
                              <span
                                className="absolute inset-y-0 right-0 rounded-sm bg-red-100/80 dark:bg-red-950/40"
                                style={{ width: `${width}%` }}
                              />
                              {row.href ? (
                                <Link href={row.href} className="relative z-[1] tabular-nums text-red-600 hover:underline">
                                  {formatCount(row.count)}
                                </Link>
                              ) : count}
                            </div>
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(row.share)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
