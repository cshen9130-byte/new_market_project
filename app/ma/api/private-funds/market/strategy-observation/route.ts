import { NextResponse } from "next/server"
import type { ReturnGranularity } from "@/lib/ma/strategy-observation"
import { loadStrategyObservation } from "@/lib/server/strategy-observation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const GRANULARITIES = new Set<ReturnGranularity>(["week", "month", "quarter", "half", "year", "phase"])

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const year = Number(url.searchParams.get("year") || new Date().getFullYear())
  const granularity = (url.searchParams.get("granularity") || "week") as ReturnGranularity
  const noCache = url.searchParams.get("nocache") === "1"
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "无效年度" }, { status: 400 })
  }
  if (!GRANULARITIES.has(granularity)) {
    return NextResponse.json({ error: "无效统计频率" }, { status: 400 })
  }
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return NextResponse.json({ error: "无效统计区间" }, { status: 400 })
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: "开始日期须早于结束日期" }, { status: 400 })
  }

  try {
    const data = await loadStrategyObservation(year, granularity, noCache, {
      from: from ?? undefined,
      to: to ?? undefined,
    })
    return NextResponse.json(data)
  } catch (err) {
    console.error("[strategy-observation] error:", err)
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 })
  }
}
