import { NextResponse } from "next/server"
import { query, fmtYmd, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query<{
      symbol: string
      trade_date: Date
      futures_ts_code: string
      futures_settle: string
      spot_close: string
      days_to_maturity: number
      annualized_basis_pct: string
    }>(
      `SELECT symbol, trade_date, futures_ts_code, futures_settle,
              spot_close, days_to_maturity, annualized_basis_pct
       FROM derived_basis_daily
       WHERE basis_type = 'near'
         AND trade_date = (SELECT MAX(trade_date) FROM derived_basis_daily WHERE basis_type = 'near')`
    )
    if (!rows.length) return NextResponse.json({ error: "No data" }, { status: 404 })
    const trade_date = fmtYmd(rows[0].trade_date)
    const data: Record<string, unknown> = {}
    for (const r of rows) {
      data[r.symbol] = {
        trade_date,
        near_ts_code: r.futures_ts_code,
        near_settle: n(r.futures_settle),
        spot_close: n(r.spot_close),
        days_to_maturity: r.days_to_maturity,
        annualized_basis_pct: n(r.annualized_basis_pct),
      }
    }
    return NextResponse.json({ trade_date, data, calc: "settle" })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
