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

type BoundsRow = {
  min_date: Date | string | null
  max_date: Date | string | null
}

const VALID_FREQS = ["daily", "weekly", "monthly"] as const
type Freq = typeof VALID_FREQS[number]

// Show 1 year of history for all frequencies
const DEFAULT_DAYS: Record<Freq, number> = { daily: 365, weekly: 365, monthly: 365 }

function isIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const freqParam = searchParams.get("freq") ?? "daily"
    const freq: Freq = VALID_FREQS.includes(freqParam as Freq) ? (freqParam as Freq) : "daily"

    const bounds = await query<BoundsRow>(
      `SELECT MIN(trade_date) AS min_date, MAX(trade_date) AS max_date
       FROM current_market_prediction
       WHERE freq = $1`,
      [freq],
    )

    const minDate = bounds[0]?.min_date ? fmtIso(bounds[0].min_date) : null
    const maxDate = bounds[0]?.max_date ? fmtIso(bounds[0].max_date) : null

    if (!minDate || !maxDate) {
      return NextResponse.json({
        data: [],
        latest: null,
        start_date: null,
        end_date: null,
        min_date: null,
        max_date: null,
      })
    }

    const startParam = searchParams.get("start")
    const endParam = searchParams.get("end")
    const hasExplicitRange = isIsoDate(startParam) && isIsoDate(endParam)
    const lookbackDays = Math.max(30, Math.min(36500, Number(searchParams.get("days") || DEFAULT_DAYS[freq])))

    let rows: PredictionRow[] = []

    if (hasExplicitRange) {
      rows = await query<PredictionRow>(
        `SELECT trade_date, cluster, pc1, pc2
         FROM current_market_prediction
         WHERE trade_date BETWEEN $1::date AND $2::date
           AND freq = $3
         ORDER BY trade_date ASC`,
        [startParam, endParam, freq],
      )
    } else {
      rows = await query<PredictionRow>(
        `SELECT trade_date, cluster, pc1, pc2
         FROM current_market_prediction
         WHERE trade_date >= CURRENT_DATE - ($1::int)
           AND freq = $2
         ORDER BY trade_date ASC`,
        [lookbackDays, freq],
      )
    }

    if (!rows.length) {
      return NextResponse.json({
        data: [],
        latest: null,
        start_date: null,
        end_date: null,
        min_date: minDate,
        max_date: maxDate,
      })
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
      min_date:   minDate,
      max_date:   maxDate,
      latest:     data[data.length - 1],
      data,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 })
  }
}
