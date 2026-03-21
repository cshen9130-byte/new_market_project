import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null
  // Remove commas, spaces, percent signs
  const clean = String(v).replace(/[,%\s]/g, "").trim()
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || null
    const to = searchParams.get("to") || null

    const conditions: string[] = []
    const params: unknown[] = []

    if (from) {
      params.push(from)
      conditions.push(`"交易日期" >= $${params.length}::date`)
    }
    if (to) {
      params.push(to)
      conditions.push(`"交易日期" <= $${params.length}::date`)
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""

    const sql = `
      SELECT
        "账户"                                                                               AS account,
        MIN("交易日期"::text)                                                                AS first_date,
        MAX("交易日期"::text)                                                                AS last_date,
        COUNT(*)::text                                                                       AS trading_days,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏",    ''), ',', ''), ' ', ''), ''))::numeric)::text  AS period_pnl,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("当日手续费",  ''), ',', ''), ' ', ''), ''))::numeric)::text  AS period_fee,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("平仓盈亏",    ''), ',', ''), ' ', ''), ''))::numeric)::text  AS close_pnl,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("持仓盈亏",    ''), ',', ''), ' ', ''), ''))::numeric)::text  AS position_pnl,
        (array_agg("客户权益"   ORDER BY "交易日期" DESC NULLS LAST))[1]                   AS latest_equity,
        (array_agg("当日结存"   ORDER BY "交易日期" DESC NULLS LAST))[1]                   AS latest_balance,
        (array_agg("风险度"     ORDER BY "交易日期" DESC NULLS LAST))[1]                   AS latest_risk_ratio,
        (array_agg("保证金占用" ORDER BY "交易日期" DESC NULLS LAST))[1]                   AS latest_margin,
        (array_agg("可用资金"   ORDER BY "交易日期" DESC NULLS LAST))[1]                   AS latest_available
      FROM mom_daily_reports
      ${where}
      GROUP BY "账户"
      ORDER BY
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏", ''), ',', ''), ' ', ''), ''))::numeric) DESC NULLS LAST
    `

    const rows = await query<{
      account: string
      first_date: string
      last_date: string
      trading_days: string
      period_pnl: string | null
      period_fee: string | null
      close_pnl: string | null
      position_pnl: string | null
      latest_equity: string | null
      latest_balance: string | null
      latest_risk_ratio: string | null
      latest_margin: string | null
      latest_available: string | null
    }>(sql, params.length > 0 ? params : undefined)

    const traders = rows.map((r) => {
      const pnl = parseNum(r.period_pnl)
      const fee = parseNum(r.period_fee)
      return {
        account: r.account,
        firstDate: r.first_date,
        lastDate: r.last_date,
        tradingDays: parseInt(r.trading_days, 10),
        periodPnl: pnl,
        periodFee: fee,
        netPnl: pnl !== null && fee !== null ? pnl - fee : pnl !== null ? pnl : null,
        closePnl: parseNum(r.close_pnl),
        positionPnl: parseNum(r.position_pnl),
        latestEquity: parseNum(r.latest_equity),
        latestBalance: parseNum(r.latest_balance),
        latestRiskRatio: r.latest_risk_ratio ?? null,
        latestMargin: parseNum(r.latest_margin),
        latestAvailable: parseNum(r.latest_available),
      }
    })

    return NextResponse.json({ ok: true, from, to, traders })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, from: null, to: null, traders: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
