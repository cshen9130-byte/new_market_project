import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseNum(v: unknown): number {
  if (v == null) return 0
  const clean = String(v).replace(/[,%\s]/g, "").trim()
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

export interface NavPoint {
  date: string
  nav: number
  cumCapital: number
  dailyReturn: number
  netFlow: number
  pnl: number
}

interface TurnoverPoint {
  date: string
  turnoverPct: number
}

interface HoldingPoint {
  date: string
  avgHoldingDays: number
  closeCount: number
}

async function _GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const productCode = searchParams.get("product_code") || null
    const normalizedProductCode = productCode?.trim().toUpperCase() || null

    // ── 1. Capital flows from mom_fund_transactions ──────────────────────
    // Use 认购确认, 申购确认 (inflows) and 赎回确认 (outflows).
    // Exclude 认购结果 to avoid double-counting with 认购确认.
    // Net amount = confirmed_amount - handling_fee - performance_fee
    const txParams: unknown[] = []
    const txExtraWhere = productCode
      ? (txParams.push(productCode), `AND product_code = $${txParams.length}`)
      : ""

    const capitalFlowRows = await query<{ date: string; net_flow: string }>(
      `SELECT
         confirmation_date::text AS date,
         SUM(
           CASE
             WHEN transaction_type IN ('认购确认', '申购确认') THEN
               COALESCE(confirmed_amount, 0)
               - COALESCE(handling_fee, 0)
               - COALESCE(performance_fee, 0)
             WHEN transaction_type = '赎回确认' THEN
               -(COALESCE(confirmed_amount, 0)
               - COALESCE(handling_fee, 0)
               - COALESCE(performance_fee, 0))
             ELSE 0
           END
         )::text AS net_flow
       FROM mom_fund_transactions
       WHERE transaction_type IN ('认购确认', '申购确认', '赎回确认')
         AND confirmation_date IS NOT NULL
         ${txExtraWhere}
       GROUP BY confirmation_date
       ORDER BY confirmation_date`,
      txParams.length > 0 ? txParams : undefined,
    )

    // ── 2. Aggregate daily PnL from mom_daily_reports ───────────────────
    // pnl = 当日盈亏 - 当日手续费 + 权利金收入 - 权利金支出
    const numExpr = (col: string) =>
      `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}", ''), ',', ''), ' ', ''), '')::numeric, 0)`

    const pnlRows = await query<{ date: string; daily_pnl: string; daily_equity: string }>(
      `SELECT
         "交易日期"::text AS date,
         SUM(
           ${numExpr("当日盈亏")}
           - ${numExpr("当日手续费")}
           + ${numExpr("权利金收入")}
           - ${numExpr("权利金支出")}
         )::text AS daily_pnl,
         SUM(${numExpr("客户权益")})::text AS daily_equity
       FROM mom_daily_reports
       GROUP BY "交易日期"
       ORDER BY "交易日期"`,
    )

    let turnoverRows: Array<{ date: string; turnover_amount: string }> = []
    try {
      const turnoverParams: unknown[] = []
      const turnoverFilter = normalizedProductCode
        ? `WHERE UPPER(TRIM("品种"::text)) = $1`
        : ""
      if (normalizedProductCode) {
        turnoverParams.push(normalizedProductCode)
      }

      turnoverRows = await query<{ date: string; turnover_amount: string }>(
        `SELECT
           "交易日期"::text AS date,
           SUM(${numExpr("成交额")})::text AS turnover_amount
         FROM mom_summary_details
         ${turnoverFilter}
         GROUP BY "交易日期"
         ORDER BY "交易日期"`,
        turnoverParams.length > 0 ? turnoverParams : undefined,
      )
    } catch {
      turnoverRows = []
    }

    let holdingRows: Array<{ date: string; avg_holding_days: string; close_count: string }> = []
    try {
      const holdingParams: unknown[] = []
      const holdingFilter = normalizedProductCode
        ? `AND UPPER(TRIM("合约"::text)) ~ ('^' || $1 || '[0-9]')`
        : ""
      if (normalizedProductCode) {
        holdingParams.push(normalizedProductCode)
      }

      holdingRows = await query<{ date: string; avg_holding_days: string; close_count: string }>(
        `SELECT
           "交易日期"::text AS date,
           AVG(GREATEST(("交易日期"::date - "开仓日期"::date), 0))::text AS avg_holding_days,
           COUNT(*)::text AS close_count
         FROM mom_close_details
         WHERE "交易日期" IS NOT NULL
           AND "开仓日期" IS NOT NULL
           ${holdingFilter}
         GROUP BY "交易日期"
         ORDER BY "交易日期"`,
        holdingParams.length > 0 ? holdingParams : undefined,
      )
    } catch {
      holdingRows = []
    }

    // ── 3. Merge & compute NAV curve ─────────────────────────────────────
    const flowMap = new Map<string, number>()
    for (const row of capitalFlowRows) {
      flowMap.set(row.date, parseNum(row.net_flow))
    }
    const pnlMap = new Map<string, number>()
    const equityMap = new Map<string, number>()
    for (const row of pnlRows) {
      pnlMap.set(row.date, parseNum(row.daily_pnl))
      equityMap.set(row.date, parseNum(row.daily_equity))
    }

    // Add guosen (国信) daily PnL — gracefully skipped if table unavailable
    try {
      const guosenPnlRows = await query<{ trade_date: string; daily_pnl: string }>(
        `SELECT trade_date::text AS trade_date,
                SUM(COALESCE(realized_pl, 0) + COALESCE(mtm_pl, 0))::text AS daily_pnl
         FROM guosen_account_summary
         GROUP BY trade_date
         ORDER BY trade_date`,
      )
      for (const row of guosenPnlRows) {
        pnlMap.set(row.trade_date, (pnlMap.get(row.trade_date) ?? 0) + parseNum(row.daily_pnl))
      }
    } catch {
      // guosen_account_summary not available — skip
    }

    const turnoverMap = new Map<string, number>()
    for (const row of turnoverRows) {
      turnoverMap.set(row.date, parseNum(row.turnover_amount))
    }

    const allDates = Array.from(new Set([...flowMap.keys(), ...pnlMap.keys()])).sort()

    let cumulativeCapital = 0
    let nav = 1.0
    const data: NavPoint[] = []
    const turnoverSeries: TurnoverPoint[] = []

    for (const date of allDates) {
      const netFlow = flowMap.get(date) ?? 0
      const pnl = pnlMap.get(date) ?? 0
      const equity = equityMap.get(date) ?? 0
      const turnoverAmount = turnoverMap.get(date) ?? 0

      // Daily return = pnl / previous capital (as specified by user)
      // Capital flows on the same day don't contribute to that day's return base.
      const dailyReturn = cumulativeCapital > 0 ? pnl / cumulativeCapital : 0

      nav = nav * (1 + dailyReturn)
      cumulativeCapital = cumulativeCapital + netFlow + pnl

      data.push({
        date,
        nav: Math.round(nav * 1e6) / 1e6,
        cumCapital: Math.round(cumulativeCapital),
        dailyReturn: Math.round(dailyReturn * 1e6) / 1e6,
        netFlow: Math.round(netFlow),
        pnl: Math.round(pnl),
      })

      if (equity > 0 && turnoverAmount > 0) {
        turnoverSeries.push({
          date,
          turnoverPct: Math.round((turnoverAmount / equity) * 1e6) / 1e6,
        })
      }
    }

    const holdingSeries: HoldingPoint[] = holdingRows
      .map((row) => ({
        date: row.date,
        avgHoldingDays: parseNum(row.avg_holding_days),
        closeCount: Math.round(parseNum(row.close_count)),
      }))
      .filter((row) => row.avgHoldingDays > 0 && row.closeCount > 0)

    return NextResponse.json({ ok: true, data, turnoverSeries, holdingSeries })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes("does not exist") ||
      msg.includes("mom_fund_transactions") ||
      msg.includes("mom_daily_reports")
    ) {
      return NextResponse.json({ ok: true, data: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("product-nav", _GET)
