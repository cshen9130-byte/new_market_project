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

function isValidDateString(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const requestedDate = searchParams.get("date")

    const availableDateRows = await query<{ date: string }>(
      `SELECT DISTINCT "交易日期"::date::text AS date
       FROM mom_daily_reports
       WHERE "交易日期" IS NOT NULL
       ORDER BY date DESC`
    )
    const availableDates = availableDateRows.map((row) => row.date).filter(Boolean)
    const latestDate = availableDates[0] ?? null
    if (!latestDate) {
      return NextResponse.json({ ok: true, latestDate: null, selectedDate: null, availableDates: [], accounts: [], payments: [], notYetRun: true })
    }

    const selectedDate = isValidDateString(requestedDate) && availableDates.includes(requestedDate)
      ? requestedDate
      : latestDate

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
       WHERE "交易日期"::date <= $1
       GROUP BY "账户"
       ORDER BY "账户"`
      , [selectedDate]
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
        source: undefined as "guosen" | undefined,
        latestDataDate: undefined as string | undefined,
      }
    })

    // Normalize by account name to avoid duplicate rows when merging optional sources.
    const accountMap = new Map(accounts.map((a) => [a.account, a]))

    // ── Merge guosen_account_summary data (optional – graceful fallback) ──
    try {
      const gRows = await query<{
        cum_pnl: string; cum_commission: string; options_pnl: string
        latest_equity: string | null
        cum_deposit: string; cum_withdrawal: string
        latest_date: string | null
      }>(`
        SELECT
          SUM(COALESCE(realized_pl, 0) + COALESCE(mtm_pl, 0))::text            AS cum_pnl,
          SUM(COALESCE(commission, 0))::text                                   AS cum_commission,
          SUM(COALESCE(premium_received, 0) - COALESCE(premium_paid, 0))::text AS options_pnl,
          (array_agg(client_equity ORDER BY trade_date DESC NULLS LAST))[1]::text AS latest_equity,
          SUM(CASE WHEN COALESCE(deposit_withdrawal, 0) > 0 THEN deposit_withdrawal ELSE 0 END)::text AS cum_deposit,
          SUM(CASE WHEN COALESCE(deposit_withdrawal, 0) < 0 THEN deposit_withdrawal ELSE 0 END)::text AS cum_withdrawal,
          MAX(trade_date::text) AS latest_date
        FROM guosen_account_summary
        WHERE client_id = '665300200077'
          AND trade_date::date <= $1
      `, [selectedDate])
      for (const r of gRows) {
        const cumPnl        = parseNum(r.cum_pnl) ?? 0
        const cumCommission = parseNum(r.cum_commission) ?? 0
        const optionsPnl    = parseNum(r.options_pnl)   ?? 0
        accountMap.set("guoxin", {
          account:       "guoxin",
          cumPnl, cumCommission, optionsPnl,
          cumNetPnl:     cumPnl - cumCommission + optionsPnl,
          latestEquity:  parseNum(r.latest_equity) ?? null,
          cumDeposit:    parseNum(r.cum_deposit)   ?? 0,
          cumWithdrawal: parseNum(r.cum_withdrawal) ?? 0,
          source:        "guosen" as const,
          latestDataDate: r.latest_date ?? undefined,
        })
      }
    } catch {
      // guosen_account_summary not available — skip gracefully
    }

    const mergedAccounts = Array.from(accountMap.values()).sort((a, b) => a.account.localeCompare(b.account))

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
         WHERE carry_date::date <= $1
         ORDER BY carry_date, account`
        , [selectedDate]
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

    // ── Mother-layer carry already paid (performance_fee from fund transactions) ──
    let totalMotherPaid = 0
    try {
      const pfRows = await query<{ total: string | null }>(
        `SELECT COALESCE(SUM(performance_fee), 0)::text AS total FROM mom_fund_transactions WHERE confirmation_date::date <= $1`,
        [selectedDate]
      )
      totalMotherPaid = parseFloat(pfRows[0]?.total ?? "0") || 0
    } catch {
      // mom_fund_transactions not available — treat as 0
    }

    return NextResponse.json({ ok: true, latestDate, selectedDate, availableDates, ...rates, accounts: mergedAccounts, payments, totalMotherPaid })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, latestDate: null, selectedDate: null, availableDates: [], accounts: [], payments: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

