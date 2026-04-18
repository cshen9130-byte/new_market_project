import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

function parseTradeDate(v: string): string {
  const n = Math.round(toNum(v))
  if (!n || isNaN(n)) return v
  const s = n.toString()
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return v
}

function getOptionType(contract: string): string {
  const c = contract.toUpperCase()
  if (/-P-|[0-9]P[0-9]/.test(c)) return "P"
  if (/-C-|[0-9]C[0-9]/.test(c)) return "C"
  return "?"
}

async function _GET() {
  try {
    // Get the latest trading date
    const latestRow = await query<{ date: string }>(
      `SELECT MAX("交易日期"::date)::text AS date FROM mom_options_position_details`,
    )
    const latestDate = latestRow[0]?.date
    if (!latestDate) return NextResponse.json({ ok: true, rows: [], date: null })

    const rows = await query<Record<string, string>>(
      `SELECT
         "账户"            AS account,
         "合约"            AS contract,
         "成交序号"        AS trade_seq,
         "买持�?          AS long_lots,
         "买入�?          AS buy_price,
         "卖持�?          AS short_lots,
         "卖出�?          AS sell_price,
         "昨结算价"        AS prev_settle,
         "今结算价"        AS today_settle,
         "投机/套保"       AS hedge_type,
         "实际成交日期"    AS trade_date_raw,
         "保证�?          AS margin,
         "交易所"          AS exchange,
         "持仓市�?        AS position_mv,
         "多头期权市�?    AS long_mv,
         "空头期权市�?    AS short_mv
       FROM mom_options_position_details
       WHERE "交易日期"::date = $1
       ORDER BY "账户", "合约", "成交序号"`,
      [latestDate],
    )

    const result = rows.map((r) => {
      const longLots    = toNum(r.long_lots)
      const shortLots   = toNum(r.short_lots)
      const buyPrice    = toNum(r.buy_price)
      const sellPrice   = toNum(r.sell_price)
      const todaySettle = toNum(r.today_settle)
      const positionMv  = toNum(r.position_mv)
      const longMv      = toNum(r.long_mv)
      const shortMv     = toNum(r.short_mv)
      const totalLots   = longLots + shortLots

      // Derive contract multiplier from position market value
      let multiplier = 0
      if (todaySettle > 0 && totalLots > 0) {
        multiplier = Math.round(positionMv / (todaySettle * totalLots))
      }

      // Cost: long paid (+), short received (-)
      const cost = Math.round((buyPrice * longLots - sellPrice * shortLots) * multiplier)
      // Market value: long positive, short negative
      const marketValue = Math.round(longMv - shortMv)
      // Floating P&L
      const floatingPnl = Math.round(marketValue - cost)

      return {
        account:      r.account,
        contract:     r.contract,
        tradeSeq:     r.trade_seq,
        longLots,
        buyPrice:     toNum(r.buy_price),
        shortLots,
        sellPrice:    toNum(r.sell_price),
        prevSettle:   toNum(r.prev_settle),
        todaySettle,
        hedgeType:    (r.hedge_type ?? "").trim(),
        tradeDate:    parseTradeDate(r.trade_date_raw ?? ""),
        margin:       Math.round(toNum(r.margin)),
        exchange:     r.exchange ?? "",
        multiplier,
        cost,
        marketValue,
        floatingPnl,
        optionType:   getOptionType(r.contract ?? ""),
      }
    })

    return NextResponse.json({ ok: true, date: latestDate, rows: result })
  } catch (e) {
    console.error("option-positions error", e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

export const GET = withMomCache("option-positions", _GET)