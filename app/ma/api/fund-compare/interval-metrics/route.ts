import { NextResponse } from "next/server"
import {
  loadBenchmarkIntervalMetrics,
  loadFundIntervalMetrics,
} from "@/lib/server/fund-compare-interval-metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const beian_haos = Array.isArray((body as { beian_haos?: unknown }).beian_haos)
    ? ((body as { beian_haos: unknown[] }).beian_haos as string[])
        .map((id) => String(id).trim())
        .filter(Boolean)
        .slice(0, 100)
    : []
  const benchmark = String((body as { benchmark?: unknown }).benchmark ?? "").trim()

  try {
    const funds = await loadFundIntervalMetrics(beian_haos)
    const cutoffDate = funds
      .map((f) => f.metricDate)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null

    let benchmarkRow = null
    if (benchmark && benchmark in { IF: 1, IC: 1, IM: 1 }) {
      benchmarkRow = await loadBenchmarkIntervalMetrics(benchmark as "IF" | "IC" | "IM")
    }

    return NextResponse.json({
      data: funds,
      benchmark: benchmarkRow,
      cutoffDate,
    })
  } catch (err) {
    console.error("[fund-compare/interval-metrics]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
