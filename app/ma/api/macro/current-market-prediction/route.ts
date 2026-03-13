import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PredictionRow = {
  trade_date: Date | string
  cluster: number | string | null
  pc1: string | null
  pc2: string | null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const lookbackDays = Math.max(30, Math.min(365, Number(searchParams.get("days") || 365)))

    const rows = await query<PredictionRow>(
      `SELECT trade_date, cluster, pc1, pc2
       FROM current_market_prediction
       WHERE trade_date >= CURRENT_DATE - ($1::int)
       ORDER BY trade_date ASC`,
      [lookbackDays],
    )

    if (!rows.length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    const data = rows.map((r) => ({
      date:    fmtIso(r.trade_date),
      cluster: n(r.cluster),
      pc1:     n(r.pc1),
      pc2:     n(r.pc2),
    }))

    return NextResponse.json({
      start_date: data[0].date,
      end_date:   data[data.length - 1].date,
      latest:     data[data.length - 1],
      data,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 })
  }
}
