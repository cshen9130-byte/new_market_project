import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { toNum } from "@/lib/server/account-risk-classify"
import { andScope, scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get("date")
  const rankParam = parseInt(searchParams.get("rank") ?? "1", 10)
  try {
    let targetDate: string | undefined = dateParam ?? undefined
    if (!targetDate) {
      const latestParams: unknown[] = []
      const latestRows = await publicQuery(`
        SELECT DISTINCT trade_date::text AS date
        FROM public.cfmmc_positions
        WHERE trade_date IS NOT NULL AND ${scopeWhere(latestParams)}
        ORDER BY date DESC LIMIT 2
      `, latestParams)
      targetDate = (latestRows.rows[rankParam - 1] as { date: string } | undefined)?.date
        ?? (latestRows.rows[0] as { date: string } | undefined)?.date
    }
    if (!targetDate) return NextResponse.json({ ok: true, rows: [], date: null })

    const posParams: unknown[] = [targetDate]
    const rows = await publicQuery(`
      SELECT account_no AS account, UPPER(TRIM(instrument)) AS contract,
             COALESCE(buy_lots, 0) AS long_lots, COALESCE(buy_price, 0) AS buy_price,
             COALESCE(sell_lots, 0) AS short_lots, COALESCE(sell_price, 0) AS sell_price,
             COALESCE(prev_settle, 0) AS prev_settle, COALESCE(floating_pl, 0) AS pos_pnl,
             COALESCE(sh, '') AS hedge_type, COALESCE(actual_date, '') AS trade_date_raw,
             COALESCE(notional_mv, 0) AS position_mv, COALESCE(allocated_margin, 0) AS margin
      FROM public.cfmmc_positions
      WHERE trade_date = $1::date
        ${andScope(posParams)}
      ORDER BY account_no, instrument
    `, posParams)

    const result = (rows.rows as Record<string, unknown>[]).map((r) => ({
      account: String(r.account ?? ""),
      contract: String(r.contract ?? ""),
      longLots: Math.round(toNum(r.long_lots)),
      buyPrice: toNum(r.buy_price),
      shortLots: Math.round(toNum(r.short_lots)),
      sellPrice: toNum(r.sell_price),
      prevSettle: toNum(r.prev_settle),
      positionPnl: Math.round(toNum(r.pos_pnl)),
      hedgeType: String(r.hedge_type ?? "").trim(),
      tradeDateRaw: String(r.trade_date_raw ?? ""),
      positionMv: Math.round(toNum(r.position_mv)),
      margin: Math.round(toNum(r.margin)),
      exchange: "",
    }))
    return NextResponse.json({ ok: true, date: targetDate, total: result.length, rows: result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
})
