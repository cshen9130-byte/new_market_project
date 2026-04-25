import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── helpers ───────────────────────────────────────────────────────────────────

function czceExpand(code: string): string {
  const m = code.match(/^([A-Z]{1,4})(\d)(\d{2})$/)
  if (!m) return code
  const yr = parseInt(m[2], 10)
  const thisYear = new Date().getFullYear()
  const decade = Math.floor(thisYear / 10)
  let fullYear = decade * 10 + yr
  if (fullYear < thisYear - 1) fullYear += 10
  return `${m[1]}${String(fullYear % 100).padStart(2, "0")}${m[3]}`
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

// Same thresholds as liquidity-scan/route.ts
function computeSeverityLevel(netLots: number, volume: number | null, hqoi: number | null): 0 | 1 | 2 {
  let maxLevel: 0 | 1 | 2 = 0

  if (volume !== null && volume > 0) {
    const pr = (netLots / volume) * 100
    if (pr >= 15) maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
    else if (pr >= 5) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  } else if (volume === 0) {
    maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
  }

  if (hqoi !== null && hqoi > 0) {
    const oc = (netLots / hqoi) * 100
    if (oc >= 8) maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
    else if (oc >= 3) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2
  }

  if (volume !== null && volume > 0 && volume < 200) maxLevel = Math.max(maxLevel, 2) as 0 | 1 | 2
  else if (volume !== null && volume > 0 && volume < 1000) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2

  // No market data → flag as warning (can't assess liquidity)
  if (volume === null && hqoi === null) maxLevel = Math.max(maxLevel, 1) as 0 | 1 | 2

  return maxLevel
}

// ── handler ───────────────────────────────────────────────────────────────────

async function _GET(req: Request) {
  const url = new URL(req.url)
  const lookback = Math.min(90, Math.max(7, parseInt(url.searchParams.get("lookback") ?? "30", 10)))

  try {
    const numCol = (col: string) =>
      `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

    // 1. Fetch all position aggregates across the lookback window
    const posRows = await query<{
      d: string
      contract: string
      long_lots: string
      short_lots: string
    }>(
      `SELECT
         "交易日期"::date::text AS d,
         UPPER(SPLIT_PART(TRIM("合约"), '.', 1)) AS contract,
         SUM(${numCol("买持仓")})::text AS long_lots,
         SUM(${numCol("卖持仓")})::text AS short_lots
       FROM mom_position_details
       WHERE "交易日期" >= NOW() - ($1 || ' days')::interval
         AND "合约" IS NOT NULL AND TRIM("合约") <> ''
       GROUP BY 1, 2
       HAVING SUM(${numCol("买持仓")}) > 0 OR SUM(${numCol("卖持仓")}) > 0`,
      [lookback + 5],
    )

    if (posRows.length === 0) {
      return NextResponse.json({ ok: true, data: [] })
    }

    // 2. Fetch market data for the same window
    const mktRows = await query<{
      trade_date: string
      contract: string
      volume: string | null
      hqoi: string | null
    }>(
      `SELECT
         trade_date::date::text AS trade_date,
         UPPER(SPLIT_PART(TRIM(contract), '.', 1)) AS contract,
         MAX(volume)::text AS volume,
         MAX(hqoi)::text  AS hqoi
       FROM raw_futures_contracts_daily
       WHERE trade_date >= NOW() - ($1 || ' days')::interval
       GROUP BY 1, 2`,
      [lookback + 5],
    )

    // Build market data map: date → contract → {volume, hqoi}
    const mktMap = new Map<string, Map<string, { volume: number | null; hqoi: number | null }>>()
    for (const r of mktRows) {
      if (!mktMap.has(r.trade_date)) mktMap.set(r.trade_date, new Map())
      mktMap.get(r.trade_date)!.set(r.contract, {
        volume: r.volume !== null ? toNum(r.volume) : null,
        hqoi:   r.hqoi   !== null ? toNum(r.hqoi)   : null,
      })
    }

    const allMktDates = [...mktMap.keys()].sort()

    // Group positions by date, applying CZCE expansion and skipping options
    const posByDate = new Map<string, Map<string, number>>() // date → contract → netLots
    for (const r of posRows) {
      const contract = czceExpand(r.contract)
      if (/^[A-Z]+\d+-?[CP]-?\d+$/i.test(contract)) continue // skip options
      const netLots = Math.abs(toNum(r.long_lots) - toNum(r.short_lots)) ||
        Math.max(toNum(r.long_lots), toNum(r.short_lots))
      if (!posByDate.has(r.d)) posByDate.set(r.d, new Map())
      const existing = posByDate.get(r.d)!.get(contract) ?? 0
      posByDate.get(r.d)!.set(contract, existing + netLots)
    }

    // For each position date, find the nearest market date (<=posDate) and compute counts
    const result: { date: string; liqCritical: number; liqWarning: number }[] = []

    for (const [posDate, contracts] of [...posByDate.entries()].sort()) {
      // Find latest mkt date that is <= posDate
      const mktDate = allMktDates.filter((d) => d <= posDate).at(-1)
      const dayMkt = mktDate ? mktMap.get(mktDate)! : new Map()

      let critical = 0, warning = 0

      for (const [contract, netLots] of contracts) {
        const mkt = dayMkt.get(contract)
        if (!mkt || mkt.volume === null) continue // no market data — don't flag, just skip
        const level = computeSeverityLevel(netLots, mkt.volume, mkt.hqoi)
        if (level === 2) critical++
        else if (level === 1) warning++
      }

      result.push({ date: posDate, liqCritical: critical, liqWarning: warning })
    }

    // Return only last `lookback` trading days
    const trimmed = result.slice(-lookback)

    return NextResponse.json({ ok: true, data: trimmed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_position_details") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, data: [] })
    }
    console.error("[liquidity-history]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("liquidity-history", _GET)
