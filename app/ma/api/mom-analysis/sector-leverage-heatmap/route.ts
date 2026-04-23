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

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = searchParams.has("window")
    ? Math.max(5, Math.min(500, parseInt(searchParams.get("window")!, 10)))
    : null

  try {
    const [dailyRows, infoRows, guosenHeatRows] = await Promise.all([
      query<{ account: string; date: string; margin: string; equity: string }>(
        `SELECT
           "账户" AS account,
           "交易日期"::text AS date,
           ${numExpr("保证金占用")}::text AS margin,
           ${numExpr("客户权益")}::text AS equity
         FROM mom_daily_reports
         ORDER BY "交易日期", "账户"`,
      ),
      query<{ account: string; sector: string; equity_wan: string }>(
        `SELECT account_code AS account,
                COALESCE(sector, '其他') AS sector,
                COALESCE(equity_wan::text, '0') AS equity_wan
         FROM mom_advisor_info`,
      ).catch(() => [] as { account: string; sector: string; equity_wan: string }[]),
      query<{ date: string; margin: string; equity: string }>(
        `SELECT trade_date::text AS date,
                margin_occupied::text AS margin,
                client_equity::text AS equity
         FROM guosen_account_summary
         WHERE client_id = '665300200077'
         ORDER BY trade_date`,
      ).catch(() => [] as { date: string; margin: string; equity: string }[]),
    ])

    const sectorMap    = new Map(infoRows.map((r) => [r.account, r.sector]))
    const equityWanMap = new Map(infoRows.map((r) => [r.account, toNum(r.equity_wan)]))

    // Collect all dates
    const allDatesSet = new Set<string>()
    for (const r of dailyRows) allDatesSet.add(r.date)
    for (const r of guosenHeatRows) allDatesSet.add(r.date)
    const allDates   = [...allDatesSet].sort()
    const windowDates = WINDOW ? allDates.slice(-WINDOW) : allDates
    const dateSet    = new Set(windowDates)

    // Collect sectors
    const sectorsSet = new Set<string>()
    for (const r of infoRows) sectorsSet.add(r.sector ?? "其他")
    sectorsSet.add("商品") // ensure guoxin sector is present
    if (sectorsSet.size === 0) {
      // fallback: infer from daily rows
      for (const r of dailyRows) {
        const s = sectorMap.get(r.account) ?? "其他"
        sectorsSet.add(s)
      }
    }
    const sectors = [...sectorsSet].sort()

    // Build heatmap matrix: sector × date → Σ(equity_wan × margin/equity)
    // key: `${sector}|${date}`
    const cellMap: Map<string, number> = new Map()

    for (const r of dailyRows) {
      if (!dateSet.has(r.date)) continue
      const sector     = sectorMap.get(r.account) ?? "其他"
      const equity_wan = equityWanMap.get(r.account) ?? 0
      const margin     = toNum(r.margin)
      const equity     = toNum(r.equity)

      // utilization = margin / equity; deployed = equity_wan × utilization
      // If equity_wan is unknown (0), fall back to actual margin (万 scale assumed)
      let deployed: number
      if (equity_wan > 0 && equity > 0) {
        deployed = equity_wan * (margin / equity)
      } else if (equity > 0) {
        // No equity_wan — use actual margin / 10000 to convert ¥ → 万
        deployed = margin / 10000
      } else {
        continue
      }

      const k = `${sector}|${r.date}`
      cellMap.set(k, (cellMap.get(k) ?? 0) + deployed)
    }

    // Add guoxin rows (equity_wan ≈ 1000万, sector = 商品)
    const GUOXIN_EQUITY_WAN = 1000
    for (const r of guosenHeatRows) {
      if (!dateSet.has(r.date)) continue
      const margin = toNum(r.margin)
      const equity = toNum(r.equity)
      if (equity <= 0) continue
      const deployed = GUOXIN_EQUITY_WAN * (margin / equity)
      const k = `商品|${r.date}`
      cellMap.set(k, (cellMap.get(k) ?? 0) + deployed)
    }

    // Format as ECharts heatmap series data: [dateIdx, sectorIdx, value]
    const data: [number, number, number][] = []
    for (let di = 0; di < windowDates.length; di++) {
      for (let si = 0; si < sectors.length; si++) {
        const v = cellMap.get(`${sectors[si]}|${windowDates[di]}`) ?? 0
        data.push([di, si, parseFloat(v.toFixed(2))])
      }
    }

    return NextResponse.json({
      dates:   windowDates,
      sectors,
      data,
      window:  WINDOW,
    })
  } catch (err) {
    console.error("[sector-leverage-heatmap]", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const GET = withMomCache("sector-leverage-heatmap", _GET)
