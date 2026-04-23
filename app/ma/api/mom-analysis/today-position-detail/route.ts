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

function parseTradeDate(v: string | null): string {
  if (!v) return ""
  const n = Math.round(toNum(v))
  if (!n || isNaN(n)) return v
  const s = n.toString()
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return v
}

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get("date") // optional: YYYY-MM-DD
  const rankParam = parseInt(searchParams.get("rank") ?? "1", 10) // 1=latest, 2=second-latest
  try {
    let targetDate: string | undefined
    if (dateParam) {
      targetDate = dateParam
    } else {
      const latestRows = await query<{ date: string }>(
        `SELECT DISTINCT "交易日期"::date::text AS date FROM mom_position_details
         WHERE "交易日期" IS NOT NULL ORDER BY date DESC LIMIT 2`,
      )
      targetDate = latestRows[rankParam - 1]?.date ?? latestRows[0]?.date
    }
    if (!targetDate) return NextResponse.json({ ok: true, rows: [], date: null })

    const rows = await query<Record<string, string>>(
      `SELECT
         TRIM("账户")            AS account,
         UPPER(TRIM("合约"))     AS contract,
         COALESCE(${`NULLIF(TRIM("买持仓"), '')`}::numeric, 0)::text  AS long_lots,
         COALESCE(${`NULLIF(TRIM("买入价"), '')`}::numeric, 0)::text  AS buy_price,
         COALESCE(${`NULLIF(TRIM("卖持仓"), '')`}::numeric, 0)::text  AS short_lots,
         COALESCE(${`NULLIF(TRIM("卖出价"), '')`}::numeric, 0)::text  AS sell_price,
         COALESCE(${`NULLIF(TRIM("昨结算价"), '')`}::numeric, 0)::text AS prev_settle,
         COALESCE(${`NULLIF(TRIM("持仓盈亏"), '')`}::numeric, 0)::text AS pos_pnl,
         TRIM("投机/套保")        AS hedge_type,
         TRIM("实际成交日期")     AS trade_date_raw,
         COALESCE(${`NULLIF(TRIM("持仓市値"), '')`}::numeric, 0)::text AS position_mv,
         COALESCE(${`NULLIF(TRIM("保证金"), '')`}::numeric, 0)::text   AS margin,
         TRIM("交易所")           AS exchange
       FROM mom_position_details
       WHERE "交易日期"::date = $1
       ORDER BY TRIM("账户"), UPPER(TRIM("合约")), "成交序号"`,
      [targetDate],
    )

    const result = rows.map((r) => ({
      account:     r.account ?? "",
      contract:    r.contract ?? "",
      longLots:    Math.round(toNum(r.long_lots)),
      buyPrice:    toNum(r.buy_price),
      shortLots:   Math.round(toNum(r.short_lots)),
      sellPrice:   toNum(r.sell_price),
      prevSettle:  toNum(r.prev_settle),
      positionPnl: Math.round(toNum(r.pos_pnl)),
      hedgeType:   (r.hedge_type ?? "").trim(),
      tradeDateRaw: parseTradeDate(r.trade_date_raw ?? ""),
      positionMv:  Math.round(toNum(r.position_mv)),
      margin:      Math.round(toNum(r.margin)),
      exchange:    (r.exchange ?? "").trim(),
    }))

    // Merge guoxin (guosen) positions for the same date
    try {
      const guosenRows = await query<{
        instrument: string; bs: string; position_lots: string
        open_price: string; prev_settl: string; mtm_pl: string
        settl_today: string; margin: string
      }>(
        `SELECT UPPER(TRIM(instrument)) AS instrument,
                bs,
                COALESCE(position_lots, 0)::text AS position_lots,
                COALESCE(open_price,    0)::text AS open_price,
                COALESCE(prev_settl,    0)::text AS prev_settl,
                COALESCE(mtm_pl,        0)::text AS mtm_pl,
                COALESCE(settl_today,   0)::text AS settl_today,
                COALESCE(margin,        0)::text AS margin
         FROM guosen_position_detail
         WHERE settlement_date::date = $1
         ORDER BY instrument`,
        [targetDate],
      )
      for (const r of guosenRows) {
        const lots = Math.round(toNum(r.position_lots))
        const isLong = r.bs === '买'
        result.push({
          account:      "guoxin",
          contract:     r.instrument,
          longLots:     isLong ? lots : 0,
          buyPrice:     isLong ? toNum(r.open_price) : 0,
          shortLots:    isLong ? 0 : lots,
          sellPrice:    isLong ? 0 : toNum(r.open_price),
          prevSettle:   toNum(r.prev_settl),
          positionPnl:  Math.round(toNum(r.mtm_pl)),
          hedgeType:    "",
          tradeDateRaw: targetDate!,
          positionMv:   Math.round(lots * toNum(r.settl_today)),
          margin:       Math.round(toNum(r.margin)),
          exchange:     "",
        })
      }
    } catch {
      // guosen_position_detail unavailable — skip
    }

    return NextResponse.json({ ok: true, date: targetDate, total: result.length, rows: result })
  } catch (err) {
    console.error("[today-position-detail]", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const GET = withMomCache("today-position-detail", _GET)
