import { NextResponse } from "next/server"
import { query, fmtIso, fmtYmd, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await query<{
      symbol: string
      trade_date: Date
      basis_diff: string
      spot_close: string
      futures_settle: string
    }>(
      `SELECT symbol, trade_date, basis_diff, spot_close, futures_settle
       FROM derived_basis_daily
       WHERE basis_type = 'far'
       ORDER BY symbol, trade_date ASC`
    )
    if (!rows.length) return NextResponse.json({ error: "No data" }, { status: 404 })
    const data: Record<string, unknown[]> = {}
    for (const r of rows) {
      if (!data[r.symbol]) data[r.symbol] = []
      data[r.symbol].push({
        date: fmtIso(r.trade_date),
        basis_diff: n(r.basis_diff),
        spot_close: n(r.spot_close),
        futures_settle: n(r.futures_settle),
      })
    }
    const dates = rows.map((r) => fmtYmd(r.trade_date))
    const start_date = dates[0]
    const end_date = dates[dates.length - 1]
    return NextResponse.json({ start_date, end_date, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
