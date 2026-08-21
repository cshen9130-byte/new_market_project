import { NextResponse } from "next/server"
import { queryDailySummary } from "@/lib/server/cfmmc-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") ?? undefined
    const to   = searchParams.get("to")   ?? undefined
    const rows = await queryDailySummary(from, to)

    // Group by account
    const byAccount = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!byAccount.has(r.account_no)) byAccount.set(r.account_no, [])
      byAccount.get(r.account_no)!.push(r)
    }

    const accounts = Array.from(byAccount.entries()).map(([accountNo, series]) => {
      let cumPnl = 0
      const data = series.map(r => {
        const pnl = r.daily_pnl ?? 0
        cumPnl += pnl
        return {
          date:           r.trade_date,
          clientEquity:   r.client_equity,
          dailyPnl:       pnl,
          cumPnl,
          marginOccupied: r.margin_occupied,
          riskRatio:      r.risk_ratio,
          realizedPl:     r.realized_pl,
          commission:     r.commission,
        }
      })
      return { accountNo, data }
    })

    // Latest snapshot per account
    const latest = accounts.map(a => ({
      accountNo:      a.accountNo,
      ...(a.data[a.data.length - 1] ?? {}),
    }))

    return NextResponse.json({ ok: true, accounts, latest })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("cfmmc_daily_summary") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accounts: [], latest: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
