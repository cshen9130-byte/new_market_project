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

const VALID_FREQS = ["daily", "weekly", "monthly"] as const
type Freq = typeof VALID_FREQS[number]

// Show 1 year of history for all frequencies
const DEFAULT_DAYS: Record<Freq, number> = { daily: 365, weekly: 365, monthly: 365 }

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const freqParam = searchParams.get("freq") ?? "daily"
    const freq: Freq = VALID_FREQS.includes(freqParam as Freq) ? (freqParam as Freq) : "daily"
    const lookbackDays = Math.max(30, Math.min(730, Number(searchParams.get("days") || DEFAULT_DAYS[freq])))

    const rows = await query<PredictionRow>(
      `SELECT trade_date, cluster, pc1, pc2
       FROM current_market_prediction
       WHERE trade_date >= CURRENT_DATE - ($1::int)
         AND freq = $2
       ORDER BY trade_date ASC`,
      [lookbackDays, freq],
    )

    if (!rows.length) {
      return NextResponse.json({ data: [], latest: null, start_date: null, end_date: null })
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
