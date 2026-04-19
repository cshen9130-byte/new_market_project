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
    ? Math.max(10, Math.min(500, parseInt(searchParams.get("window")!, 10)))
    : null

  try {
    const [rows, advisorRows] = await Promise.all([
      query<{ account: string; date: string; daily_pnl: string; equity: string; margin: string }>(
        `SELECT
           "账户" AS account,
           "交易日期"::text AS date,
           (
             ${numExpr("当日盈亏")}
             - ${numExpr("当日手续费")}
             + ${numExpr("权利金收入")}
             - ${numExpr("权利金支出")}
           )::text AS daily_pnl,
           ${numExpr("客户权益")}::text AS equity,
           ${numExpr("保证金占用")}::text AS margin
         FROM mom_daily_reports
         ORDER BY "交易日期", "账户"`,
      ),
      query<{ account: string; sector: string; equity_wan: string }>(
        `SELECT account_code AS account,
                COALESCE(sector, '其他') AS sector,
                COALESCE(equity_wan::text, '0') AS equity_wan
         FROM mom_advisor_info`,
      ).catch(() => [] as { account: string; sector: string; equity_wan: string }[]),
    ])

    const advisorMap = new Map(
      advisorRows.map((r) => [r.account, { sector: r.sector, equityWan: toNum(r.equity_wan) }]),
    )

    const allDatesSet = new Set<string>()
    const accountData: Record<
      string,
      { dates: string[]; pnlRates: number[]; marginRates: number[] }
    > = {}

    for (const row of rows) {
      const pnl = toNum(row.daily_pnl)
      const equity = toNum(row.equity)
      const margin = toNum(row.margin)
      allDatesSet.add(row.date)
      if (!accountData[row.account])
        accountData[row.account] = { dates: [], pnlRates: [], marginRates: [] }
      accountData[row.account].dates.push(row.date)
      accountData[row.account].pnlRates.push(equity > 0 ? pnl / equity : 0)
      accountData[row.account].marginRates.push(equity > 0 ? margin / equity : 0)
    }

    const allDates = [...allDatesSet].sort()
    const T = WINDOW ?? allDates.length
    const windowSet = WINDOW ? new Set(allDates.slice(-WINDOW)) : null

    const accounts = []
    for (const [account, data] of Object.entries(accountData)) {
      const indices = windowSet
        ? data.dates.map((d, i) => (windowSet.has(d) ? i : -1)).filter((i) => i >= 0)
        : data.dates.map((_, i) => i)

      if (indices.length < 5) continue

      const pnlRates = indices.map((i) => data.pnlRates[i])
      const marginRates = indices.map((i) => data.marginRates[i])

      // Only include accounts with meaningful trading activity
      if (pnlRates.filter((r) => r !== 0).length < 3) continue

      const nonZeroMargin = marginRates.filter((m) => m > 0)
      if (nonZeroMargin.length < 3) continue

      const avgDailyReturn = pnlRates.reduce((s, v) => s + v, 0) / pnlRates.length
      const annualReturn = Math.round(avgDailyReturn * 252 * 10000) / 100

      const avgMarginUtil =
        Math.round((nonZeroMargin.reduce((s, v) => s + v, 0) / nonZeroMargin.length) * 10000) / 100

      const returnPerMargin =
        avgMarginUtil > 0 ? Math.round((annualReturn / avgMarginUtil) * 100) / 100 : 0

      const advisor = advisorMap.get(account)

      accounts.push({
        account,
        avgMarginUtil,
        annualReturn,
        returnPerMargin,
        nominalEquityWan: advisor?.equityWan ?? 0,
        sector: advisor?.sector ?? "其他",
      })
    }

    return NextResponse.json({ ok: true, accounts, window: T })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[capital-efficiency]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("capital-efficiency", _GET)
