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

    // Override cum_deposit / cum_withdrawal with gross fund-flow data from mom_daily_report_fund_flows.
    // That table records each individual 转入/转出 transaction, so it correctly separates
    // days where both a deposit and a withdrawal occurred (net 当日存取合计 would otherwise
    // misclassify the net as purely a deposit or purely a withdrawal).
    // Falls back to the 当日存取合计-based numbers if the table is unavailable.
    let fundFlowMap = new Map<string, { cumDeposit: number; cumWithdrawal: number }>()
    try {
      const ffRows = await query<{ account: string; cum_deposit: string | null; cum_withdrawal: string | null }>(
        // Logic for gross vs structural transfers:
        //
        // 转出 entries fall into two categories, identified by the 说明 field:
        //   - 说明 = '【出入金】' exactly (no suffix): structural transfer — capital being
        //     reshuffled between sub-accounts or round-tripped. Treated as structural_out
        //     and netted against 转入 on the same day. If net > 0 → deposit; if net = 0
        //     → excluded entirely. Example: rx085 Sep18 20M out+in (round-trip),
        //     rx315 Nov10 5M out alongside 10M in (account restructuring).
        //   - 说明 has a specific label (e.g. '【出入金】投顾提盈'): real client cash
        //     outflow. Counted as gross withdrawal independently of the 转入 on that day.
        //     Example: rx085 Apr15 500K out ('投顾提盈' = carry performance withdrawal).
        //
        // For 转入: always gross, but the structural_out is subtracted first; if the
        // resulting net_amount <= 0 (e.g., pure round-trip day), that day adds nothing.
        `WITH daily_flow AS (
           SELECT
             "账户",
             "交易日期",
             -- net_amount = 转入 minus structural 转出 (说明 = '【出入金】' exactly)
             SUM(
               CASE WHEN "方向" = '转入'
               THEN (NULLIF(REPLACE(REPLACE(COALESCE("最大允许亏损金额", ''), ',', ''), ' ', ''), ''))::numeric
               ELSE 0 END
             ) -
             SUM(
               CASE WHEN "方向" = '转出' AND COALESCE("说明", '') = '【出入金】'
               THEN (NULLIF(REPLACE(REPLACE(COALESCE("最大允许亏损金额", ''), ',', ''), ' ', ''), ''))::numeric
               ELSE 0 END
             ) AS net_amount,
             -- real_withdrawal = 转出 with a specific label (genuine client cash outflow)
             SUM(
               CASE WHEN "方向" = '转出' AND COALESCE("说明", '') != '【出入金】'
               THEN (NULLIF(REPLACE(REPLACE(COALESCE("最大允许亏损金额", ''), ',', ''), ' ', ''), ''))::numeric
               ELSE 0 END
             ) AS real_withdrawal_amount
           FROM mom_daily_report_fund_flows
           WHERE "交易日期" <= $1
           GROUP BY "账户", "交易日期"
         )
         SELECT
           "账户" AS account,
           SUM(CASE WHEN net_amount > 0 THEN net_amount ELSE 0 END)::text AS cum_deposit,
           (-SUM(real_withdrawal_amount))::text AS cum_withdrawal
         FROM daily_flow
         GROUP BY "账户"`,
        [selectedDate]
      )
      fundFlowMap = new Map(ffRows.map((r) => [
        r.account,
        {
          cumDeposit:    parseNum(r.cum_deposit)    ?? 0,
          cumWithdrawal: parseNum(r.cum_withdrawal) ?? 0,
        }
      ]))
    } catch {
      // mom_daily_report_fund_flows not available — fall back to 当日存取合计
    }

    const accounts = pnlRows.map((r) => {
      const cumPnl        = parseNum(r.cum_pnl)        ?? 0
      const cumCommission = parseNum(r.cum_commission) ?? 0
      const optionsPnl    = parseNum(r.options_pnl)   ?? 0
      // Use gross fund-flow figures when available, otherwise fall back to net 当日存取合计
      const ff = fundFlowMap.get(r.account)
      return {
        account:       r.account,
        cumPnl,
        cumCommission,
        optionsPnl,
          cumNetPnl:     cumPnl - cumCommission + optionsPnl,
        latestEquity:  parseNum(r.latest_equity) ?? null,
        cumDeposit:    ff ? ff.cumDeposit    : (parseNum(r.cum_deposit)   ?? 0),
        cumWithdrawal: ff ? ff.cumWithdrawal : (parseNum(r.cum_withdrawal) ?? 0),
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

