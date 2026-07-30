import { NextResponse } from "next/server"
import { query, fmtYmd, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Prefer the latest date that actually has prices. Empty shells from failed
    // Tushare pulls would otherwise win MAX(trade_date) and blank the cards.
    const rows = await query(`
      SELECT symbol, trade_date,
             ts_code, close, settle, settle_return,
             near_ts_code, near_close, near_settle, near_settle_return,
             far_ts_code, far_close, far_settle, far_settle_return, far_cont_ts_code
      FROM derived_futures_snapshot
      WHERE trade_date = (
        SELECT MAX(trade_date) FROM derived_futures_snapshot
        WHERE settle IS NOT NULL
           OR near_settle IS NOT NULL
           OR far_settle IS NOT NULL
           OR close IS NOT NULL
           OR near_close IS NOT NULL
      )
    `)
    if (!rows.length) return NextResponse.json({ error: "No data" }, { status: 404 })

    const trade_date = fmtYmd(rows[0].trade_date as Date)
    const data: Record<string, unknown> = {}
    for (const r of rows) {
      data[r.symbol as string] = {
        trade_date,
        ts_code:             r.ts_code,
        close:               n(r.close),
        settle:              n(r.settle),
        settle_return:       n(r.settle_return),
        near_ts_code:        r.near_ts_code,
        near_close:          n(r.near_close),
        near_settle:         n(r.near_settle),
        near_settle_return:  n(r.near_settle_return),
        far_ts_code:         r.far_ts_code,
        far_close:           n(r.far_close),
        far_settle:          n(r.far_settle),
        far_settle_return:   n(r.far_settle_return),
        far_cont_ts_code:    r.far_cont_ts_code,
        source:              "postgresql",
      }
    }
    return NextResponse.json({ exchange: "CFFEX", trade_date, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
