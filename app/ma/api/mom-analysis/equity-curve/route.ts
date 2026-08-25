import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null
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

    const rows = await query<{
      account: string
      trade_date: string
      daily_pnl: string | null
      margin: string | null
      equity: string | null
    }>(
      `SELECT
         "账户"         AS account,
         "交易日期"::text AS trade_date,
         NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏", ''), ',', ''), ' ', ''), '') AS daily_pnl,
         NULLIF(REPLACE(REPLACE(COALESCE("保证金占用"::text, ''), ',', ''), ' ', ''), '') AS margin,
         COALESCE(
           NULLIF(REPLACE(REPLACE(COALESCE("客户权益"::text, ''), ',', ''), ' ', ''), ''),
           NULLIF(REPLACE(REPLACE(COALESCE("当日结存"::text, ''), ',', ''), ' ', ''), '')
         ) AS equity
       FROM mom_daily_reports
       ${where}
       ORDER BY "交易日期" ASC, "账户" ASC`,
      params.length > 0 ? params : undefined,
    )

    // group rows by account
    const accountMap = new Map<string, Array<{ date: string; pnl: number; margin: number; equity: number }>>()
    for (const row of rows) {
      const pnl = parseNum(row.daily_pnl) ?? 0
      const margin = parseNum(row.margin) ?? 0
      const equity = parseNum(row.equity) ?? 0
      if (!accountMap.has(row.account)) accountMap.set(row.account, [])
      accountMap.get(row.account)!.push({ date: row.trade_date, pnl, margin, equity })
    }

    // compute cumulative PnL per account
    const series = Array.from(accountMap.entries()).map(([account, days]) => {
      let cum = 0
      const data = days.map(({ date, pnl, margin, equity }) => {
        cum += pnl
        return { date, cumPnl: cum, margin, equity }
      })
      return { account, data }
    })

    // sort by final cumulative PnL descending
    series.sort((a, b) => {
      const aLast = a.data[a.data.length - 1]?.cumPnl ?? 0
      const bLast = b.data[b.data.length - 1]?.cumPnl ?? 0
      return bLast - aLast
    })

    return NextResponse.json({ ok: true, from, to, series })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, from: null, to: null, series: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
