import { NextResponse } from "next/server"
import {
  isPrivateFundBenchmarkKey,
  loadPrivateFundBenchmarkSeries,
} from "@/lib/server/private-fund-benchmarks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const key = sp.get("key") ?? ""
  const from = sp.get("from") || "2020-01-01"
  const to = sp.get("to") || new Date().toISOString().slice(0, 10)

  if (!isPrivateFundBenchmarkKey(key)) {
    return NextResponse.json({ ok: false, error: "无效的基准代码" }, { status: 400 })
  }

  try {
    const series = await loadPrivateFundBenchmarkSeries(key, from, to)
    return NextResponse.json({
      ok: true,
      key,
      label: series.label,
      data: series.data,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
