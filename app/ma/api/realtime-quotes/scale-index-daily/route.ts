import { NextResponse } from "next/server"

import { getScaleIndexDaily } from "@/lib/server/scale-index-daily"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const series = await getScaleIndexDaily()
    const dates = series.flatMap((row) => row.points.map((p) => p.date)).sort()
    return NextResponse.json({
      ok: true,
      start_date: dates[0] || null,
      end_date: dates[dates.length - 1] || null,
      series,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "规模指数行情获取失败" },
      { status: 502 },
    )
  }
}
