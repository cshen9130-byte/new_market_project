import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_MOTHER_RATE = 0.35
const DEFAULT_CHILD_RATE  = 0.20

async function readRates(): Promise<{ motherRate: number; childRate: number }> {
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value::text FROM mom_carry_rates WHERE key IN ('mother_rate', 'child_rate')`
    )
    const map = Object.fromEntries(rows.map((r) => [r.key, parseFloat(r.value)]))
    return {
      motherRate: map["mother_rate"] ?? DEFAULT_MOTHER_RATE,
      childRate:  map["child_rate"]  ?? DEFAULT_CHILD_RATE,
    }
  } catch {
    return { motherRate: DEFAULT_MOTHER_RATE, childRate: DEFAULT_CHILD_RATE }
  }
}

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null
  const clean = String(v).replace(/[,%\s]/g, "").trim()
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

export async function GET() {
  try {
    // Latest trading date
    const latestDateRows = await query<{ latest_date: string }>(
      `SELECT MAX("交易日期"::date)::text AS latest_date FROM mom_daily_reports`
    )
    const latestDate = latestDateRows[0]?.latest_date ?? null
    if (!latestDate) {
      return NextResponse.json({ ok: true, latestDate: null, accounts: [], payments: [], notYetRun: true })
    }

    // Rates from DB
    const rates = await readRates()

    // Cumulative PnL, commission, latest equity, deposits, and withdrawals per account
    const pnlRows = await query<{ account: string; cum_pnl: string | null; cum_commission: string | null; latest_equity: string | null; cum_deposit: string | null; cum_withdrawal: string | null; options_pnl: string | null }>(
      `SELECT
         "账户" AS account,
         SUM(
           (NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏", ''), ',', ''), ' ', ''), ''))::numeric
         )::text AS cum_pnl,
         SUM(
           (NULLIF(REPLACE(REPLACE(COALESCE("当日手续费", ''), ',', ''), ' ', ''), ''))::numeric
         )::text AS cum_commission,
         (array_agg(
           (NULLIF(REPLACE(REPLACE(COALESCE("客户权益", ''), ',', ''), ' ', ''), ''))::numeric
           ORDER BY "交易日期" DESC NULLS LAST
         ))[1]::text AS latest_equity,
         SUM(
           CASE WHEN
             (NULLIF(REPLACE(REPLACE(COALESCE("当日存取合计", ''), ',', ''), ' ', ''), ''))::numeric > 0
           THEN
             (NULLIF(REPLACE(REPLACE(COALESCE("当日存取合计", ''), ',', ''), ' ', ''), ''))::numeric
           ELSE 0 END
         )::text AS cum_deposit,
         SUM(
           CASE WHEN
             (NULLIF(REPLACE(REPLACE(COALESCE("当日存取合计", ''), ',', ''), ' ', ''), ''))::numeric < 0
           THEN
             (NULLIF(REPLACE(REPLACE(COALESCE("当日存取合计", ''), ',', ''), ' ', ''), ''))::numeric
           ELSE 0 END
         )::text AS cum_withdrawal,
         (
           COALESCE(SUM((NULLIF(REPLACE(REPLACE(COALESCE("权利金收入", ''), ',', ''), ' ', ''), ''))::numeric), 0)
           - COALESCE(SUM((NULLIF(REPLACE(REPLACE(COALESCE("权利金支出", ''), ',', ''), ' ', ''), ''))::numeric), 0)
         )::text AS options_pnl
       FROM mom_daily_reports
       GROUP BY "账户"
       ORDER BY "账户"`
    )

    const accounts = pnlRows.map((r) => {
      const cumPnl        = parseNum(r.cum_pnl)        ?? 0
      const cumCommission = parseNum(r.cum_commission) ?? 0
      const optionsPnl    = parseNum(r.options_pnl)   ?? 0
      return {
        account:       r.account,
        cumPnl,
        cumCommission,
        optionsPnl,
          cumNetPnl:     cumPnl - cumCommission + optionsPnl,
        latestEquity:  parseNum(r.latest_equity) ?? null,
        cumDeposit:    parseNum(r.cum_deposit)   ?? 0,
        cumWithdrawal: parseNum(r.cum_withdrawal) ?? 0,
      }
    })

    // Already-paid carry payment records
    let payments: Array<{
      id: number
      account: string
      startDate: string | null
      carryDate: string
      operatingDays: number | null
      balance: number | null
      totalProfit: number | null
      profitPortion: number
      paidChildCarry: number
      note: string | null
    }> = []

    try {
      const rows = await query<Record<string, string | null>>(
        `SELECT id, account, start_date::text, carry_date::text,
                operating_days, balance::text, total_profit::text,
                profit_portion::text, paid_child_carry::text, note
         FROM mom_carry_payments
         ORDER BY carry_date, account`
      )
      payments = rows.map((r) => ({
        id:             parseInt(r.id as string, 10),
        account:        r.account as string,
        startDate:      r.start_date ?? null,
        carryDate:      r.carry_date as string,
        operatingDays:  r.operating_days ? parseInt(r.operating_days, 10) : null,
        balance:        r.balance        ? parseFloat(r.balance)         : null,
        totalProfit:    r.total_profit   ? parseFloat(r.total_profit)    : null,
        profitPortion:  parseFloat(r.profit_portion as string),
        paidChildCarry: parseFloat(r.paid_child_carry as string),
        note:           r.note ?? null,
      }))
    } catch {
      // mom_carry_payments table not yet created — treat as empty
    }

    return NextResponse.json({ ok: true, latestDate, ...rates, accounts, payments })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, latestDate: null, accounts: [], payments: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

