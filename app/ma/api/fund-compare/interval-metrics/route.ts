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
  const products = Array.isArray((body as { products?: unknown }).products)
    ? ((body as { products: unknown[] }).products as { beian_hao?: unknown; product_name?: unknown }[])
        .map((item) => ({
          beian_hao: String(item.beian_hao ?? "").trim(),
          product_name: String(item.product_name ?? "").trim(),
        }))
        .filter((item) => item.beian_hao)
        .slice(0, 100)
    : []
  const ids = products.length > 0 ? products.map((p) => p.beian_hao) : beian_haos
  const nameById = new Map(products.map((p) => [p.beian_hao, p.product_name || p.beian_hao]))
  const benchmark = String((body as { benchmark?: unknown }).benchmark ?? "").trim()

  try {
    const funds = await loadFundIntervalMetrics(ids, nameById)
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
