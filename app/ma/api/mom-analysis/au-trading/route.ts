import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Normalise CTP-format AU contract to Choice API format
// e.g.  au2509  →  AU2509.SHF   |   AU2509.SHF  →  AU2509.SHF (pass-through)
function normalizeAuContract(raw: string): string {
  const upper = raw.toUpperCase().trim()
  return upper.includes(".") ? upper : upper + ".SHF"
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from    = searchParams.get("from")    || "2025-01-01"
    const to      = searchParams.get("to")      || new Date().toISOString().slice(0, 10)
    const account = searchParams.get("account") || "rx000"

    // Fetch prices/trades from PRICE_FROM so positions opened before "from" are captured
    const PRICE_FROM = "2025-01-01"

    // ── Run queries in parallel ────────────────────────────────────────────────
    const [benchmarkRows, tradeRows, priceRows] = await Promise.all([

      // 1. NH gold index daily candles (NHAU.NH from single-commodity indices)
      query<{ date: string; open: number; high: number; low: number; close: number; volume: number }>(
        `SELECT trade_date::text                      AS date,
                CAST(open  AS float8)                 AS open,
                CAST(high  AS float8)                 AS high,
                CAST(low   AS float8)                 AS low,
                CAST(close AS float8)                 AS close,
                CAST(COALESCE(volume, 0) AS float8)   AS volume
         FROM raw_nanhua_commodity_indices_daily
         WHERE code = 'NHAU.NH'
           AND trade_date BETWEEN $1 AND $2
         ORDER BY trade_date`,
        [from, to],
      ).catch(() => [] as { date: string; open: number; high: number; low: number; close: number; volume: number }[]),

      // 2. All AU futures transactions for the account
      query<{ trade_date: string; contract: string; direction: string; action: string; price: number | null; lots: number | null }>(
        `SELECT "交易日期"::text                                            AS trade_date,
                UPPER(TRIM("合约"))                                        AS contract,
                TRIM("买/卖")                                              AS direction,
                TRIM("开/平")                                              AS action,
                CAST(NULLIF(TRIM(COALESCE("成交价",'')),'') AS float8)    AS price,
                ABS(CAST(NULLIF(TRIM(COALESCE("手数",'')),'') AS float8))  AS lots
         FROM mom_futures_trade_details
         WHERE "账户" ILIKE $1
           AND UPPER(TRIM("合约")) LIKE 'AU%'
           AND "交易日期" BETWEEN $2 AND $3
         ORDER BY "交易日期", "合约"`,
        [`%${account}%`, PRICE_FROM, to],
      ),

      // 3. Daily OHLCV for all AU.SHF contracts
      query<{ date: string; contract: string; close: number; preclose: number }>(
        `SELECT trade_date::text                                    AS date,
                contract,
                CAST(close                   AS float8)            AS close,
                CAST(COALESCE(preclose,close) AS float8)           AS preclose
         FROM raw_futures_contracts_daily
         WHERE contract LIKE 'AU%.SHF'
           AND trade_date BETWEEN $1 AND $2
         ORDER BY trade_date, contract`,
        [PRICE_FROM, to],
      ),
    ])

    // ── Build price lookup:  "CONTRACT|DATE" → {close, preclose} ──────────────
    const priceMap = new Map<string, { close: number; preclose: number }>()
    for (const p of priceRows) {
      priceMap.set(`${p.contract}|${p.date}`, { close: p.close, preclose: p.preclose })
    }

    // ── Build position deltas from trades ────────────────────────────────────
    // deltas:  normalised_contract → (date → net_lot_change)
    type DeltaMap = Map<string, number>
    const deltas = new Map<string, DeltaMap>()

    // Trade markers within the display range
    const tradeMarkers: {
      date: string; contract: string; direction: string; action: string
      price: number | null; lots: number | null
    }[] = []

    for (const t of tradeRows) {
      if (!t.lots || !t.trade_date) continue
      const contract = normalizeAuContract(t.contract)
      const sign = t.direction === "买" ? 1 : -1
      if (!deltas.has(contract)) deltas.set(contract, new Map())
      const m = deltas.get(contract)!
      m.set(t.trade_date, (m.get(t.trade_date) || 0) + sign * t.lots)

      if (t.trade_date >= from && t.trade_date <= to) {
        tradeMarkers.push({
          date: t.trade_date,
          contract,
          direction: t.direction,
          action: t.action || "",
          price: t.price,
          lots: t.lots,
        })
      }
    }

    // ── Walk through all trading dates to compute MTM P&L ─────────────────────
    // AU on SHFE: 1 lot = 1000g, price in yuan/g → 1 point = 1000 yuan per lot
    const AU_MULTIPLIER = 1000
    const allTradingDates = [...new Set(priceRows.map(p => p.date))].sort()
    const positions = new Map<string, number>() // contract → net lots
    const dailyPnl: { date: string; pnl: number; cumPnl: number }[] = []
    let cumPnl = 0

    for (const date of allTradingDates) {
      // Apply position changes from trades on this date
      for (const [contract, dm] of deltas) {
        const delta = dm.get(date)
        if (delta !== undefined) {
          positions.set(contract, (positions.get(contract) || 0) + delta)
        }
      }

      // EOD MTM P&L = Σ net_lots × (close − preclose) × multiplier
      let dayPnl = 0
      for (const [contract, lots] of positions) {
        if (lots === 0) continue
        const p = priceMap.get(`${contract}|${date}`)
        if (!p) continue
        dayPnl += lots * (p.close - p.preclose) * AU_MULTIPLIER
      }
      cumPnl += dayPnl

      if (date >= from) {
        dailyPnl.push({ date, pnl: Math.round(dayPnl), cumPnl: Math.round(cumPnl) })
      }
    }

    // ── Snapshot total net lots per day (from=window start) ───────────────────
    // Re-walk to emit net lots per date within the display window
    const positions2 = new Map<string, number>() // contract → net lots
    const positionHistory: { date: string; totalLots: number }[] = []
    for (const date of allTradingDates) {
      for (const [contract, dm] of deltas) {
        const delta = dm.get(date)
        if (delta !== undefined) {
          positions2.set(contract, (positions2.get(contract) || 0) + delta)
        }
      }
      if (date >= from) {
        let total = 0
        for (const lots of positions2.values()) total += lots
        positionHistory.push({ date, totalLots: total })
      }
    }

    return NextResponse.json({
      ok: true,
      benchmark: benchmarkRows,
      dailyPnl,
      trades: tradeMarkers,
      positionHistory,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
