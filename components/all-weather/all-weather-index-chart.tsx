"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Loader2 } from "lucide-react"
import { authService } from "@/lib/auth"
import { Card } from "@/components/ui/card"

type IndexPoint = { date: string; value: number }
type ChartPoint = IndexPoint & { dailyChg: number; dailyPct: number }

type RangeId = "1y" | "3y" | "ytd" | "all"

const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: "ytd", label: "今年" },
  { id: "1y", label: "近1年" },
  { id: "3y", label: "近3年" },
  { id: "all", label: "全部" },
]

function authHeaders(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function filterRange(points: IndexPoint[], range: RangeId): IndexPoint[] {
  if (!points.length || range === "all") return points
  const end = points[points.length - 1]!.date
  let start = points[0]!.date
  if (range === "ytd") start = `${end.slice(0, 4)}-01-01`
  else if (range === "1y") start = addYears(end, -1)
  else if (range === "3y") start = addYears(end, -3)
  return points.filter((p) => p.date >= start)
}

function withDailyMoves(points: IndexPoint[]): ChartPoint[] {
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1]!.value : p.value
    const dailyChg = p.value - prev
    const dailyPct = prev > 0 ? dailyChg / prev : 0
    return { ...p, dailyChg, dailyPct }
  })
}

function axisDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mid = (min + max) / 2 || 1
  const span = Math.max(max - min, Math.abs(mid) * 0.004, 1)
  const pad = span * 0.12
  return [min - pad, max + pad]
}

function formatLevel(v: number, digits = 2): string {
  return v.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatPct(v: number): string {
  const sign = v > 0 ? "+" : ""
  return `${sign}${(v * 100).toFixed(2)}%`
}

function pnlClass(n: number): string {
  if (n > 0) return "text-red-600"
  if (n < 0) return "text-emerald-600"
  return "text-slate-600"
}

function IndexTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]!.payload
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-slate-700">{row.date}</div>
      <div>指数点位 : {formatLevel(row.value)}</div>
      <div className={pnlClass(row.dailyChg)}>
        当日涨跌 : {row.dailyChg > 0 ? "+" : ""}
        {formatLevel(row.dailyChg)}（{formatPct(row.dailyPct)}）
      </div>
    </div>
  )
}

export function AllWeatherIndexChart() {
  const [points, setPoints] = useState<IndexPoint[]>([])
  const [label, setLabel] = useState("全天候指数")
  const [range, setRange] = useState<RangeId>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/all-weather/index", {
          headers: authHeaders(),
          cache: "no-store",
        })
        const payload = await res.json()
        if (!res.ok || !payload?.ok) throw new Error(payload?.error || "重建指数加载失败")
        const data = Array.isArray(payload.data)
          ? (payload.data as IndexPoint[]).filter(
              (row) => typeof row?.date === "string" && Number.isFinite(Number(row.value)) && Number(row.value) > 0,
            )
          : []
        if (!cancelled) {
          setPoints(data)
          if (typeof payload.label === "string" && payload.label.trim()) setLabel(payload.label.trim())
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const chartData = useMemo(() => withDailyMoves(filterRange(points, range)), [points, range])
  const latest = chartData[chartData.length - 1]
  const first = chartData[0]
  const rangeReturn = first && latest && first.value > 0 ? latest.value / first.value - 1 : null

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">{label}（重建）</div>
          <div className="text-xs text-slate-500">CI011001.WI · 国泰海通全天候指数重建序列</div>
        </div>
        {latest && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="text-2xl font-semibold tabular-nums text-slate-900">{formatLevel(latest.value)}</div>
            {rangeReturn != null && (
              <div className={`text-sm font-medium tabular-nums ${pnlClass(rangeReturn)}`}>
                区间 {formatPct(rangeReturn)}
              </div>
            )}
            <div className="text-xs text-slate-400">{latest.date}</div>
          </div>
        )}
        <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRange(item.id)}
              className={`rounded px-2.5 py-1 text-xs ${
                range === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载重建指数…
        </div>
      ) : error ? (
        <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] items-center justify-center">
          <div className="max-w-md rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        </div>
      ) : chartData.length < 2 ? (
        <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] items-center justify-center text-sm text-slate-500">
          暂无重建指数数据。请确认 CI011001 重建序列已导入（raw_ci011001_rebuild_daily 或 rebuild_index_levels.csv）。
        </div>
      ) : (
        <div className="h-[calc(100vh-14rem)] min-h-[28rem]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
              <YAxis
                tick={{ fontSize: 11 }}
                width={64}
                domain={axisDomain(chartData.map((d) => d.value))}
                tickFormatter={(v: number) => formatLevel(Number(v), 0)}
                allowDataOverflow
              />
              <Tooltip content={<IndexTooltip />} />
              <Area
                type="linear"
                dataKey="value"
                stroke="#b91c1c"
                fill="#fecaca"
                baseValue="dataMin"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
