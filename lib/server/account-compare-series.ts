/**
 * MOM settlement series for 产品页「账户对比」.
 * Read-only. Does not write public.mom_*.
 */
import { publicQuery } from "@/lib/db"

export type AccountComparePoint = {
  date: string
  nav: number
  dailyReturn: number
  pnl: number
  equity: number
}

export type MomCompareAdvisor = {
  advisor_name: string | null
  company: string | null
  sector: string | null
}

function parseNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

function numExpr(col: string): string {
  return `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`
}

type DailyRow = {
  date: string
  daily_pnl: string
  fee: string
  prem_in: string
  prem_out: string
  prev_balance: string
  equity: string
}

/** Daily-compounded MOM account NAV. Same formula as the product-page account compare route. */
export async function loadMomAccountCompareSeries(
  account: string,
  from: string,
  to: string,
): Promise<{ advisor: MomCompareAdvisor | null; series: AccountComparePoint[] }> {
  const accountKey = account.trim().toUpperCase()
  const dateFilter: string[] = []
  const sqlParams: unknown[] = [accountKey]
  if (from) {
    sqlParams.push(from)
    dateFilter.push(`AND "交易日期"::date >= $${sqlParams.length}::date`)
  }
  if (to) {
    sqlParams.push(to)
    dateFilter.push(`AND "交易日期"::date <= $${sqlParams.length}::date`)
  }

  const rows = await publicQuery(
    `SELECT
       "交易日期"::text AS date,
       ${numExpr("当日盈亏")}::text AS daily_pnl,
       ${numExpr("当日手续费")}::text AS fee,
       ${numExpr("权利金收入")}::text AS prem_in,
       ${numExpr("权利金支出")}::text AS prem_out,
       ${numExpr("上日结存")}::text AS prev_balance,
       ${numExpr("客户权益")}::text AS equity
     FROM public.mom_daily_reports
     WHERE UPPER(TRIM("账户"::text)) = $1
       ${dateFilter.join("\n       ")}
     ORDER BY "交易日期"`,
    sqlParams,
  )

  const byDate = new Map<string, { pnl: number; prevBal: number; equity: number }>()
  for (const raw of rows.rows as DailyRow[]) {
    const date = String(raw.date).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const pnl = parseNum(raw.daily_pnl) - parseNum(raw.fee) + parseNum(raw.prem_in) - parseNum(raw.prem_out)
    const existing = byDate.get(date)
    if (existing) {
      existing.pnl += pnl
      existing.prevBal = Math.max(existing.prevBal, parseNum(raw.prev_balance))
      existing.equity = Math.max(existing.equity, parseNum(raw.equity))
    } else {
      byDate.set(date, {
        pnl,
        prevBal: parseNum(raw.prev_balance),
        equity: parseNum(raw.equity),
      })
    }
  }

  let nav = 1
  const series: AccountComparePoint[] = []
  for (const date of [...byDate.keys()].sort()) {
    const { pnl, prevBal, equity } = byDate.get(date)!
    const denom = prevBal > 0 ? prevBal : (equity - pnl > 0 ? equity - pnl : 0)
    const dailyReturn = denom > 0 ? pnl / denom : 0
    nav *= 1 + dailyReturn
    series.push({
      date,
      nav: Math.round(nav * 1e8) / 1e8,
      dailyReturn: Math.round(dailyReturn * 1e8) / 1e8,
      pnl: Math.round(pnl),
      equity: Math.round(equity),
    })
  }

  let advisor: MomCompareAdvisor | null = null
  try {
    const advisorRes = await publicQuery(
      `SELECT
         NULLIF(TRIM(advisor_name), '') AS advisor_name,
         NULLIF(TRIM(company), '') AS company,
         NULLIF(TRIM(sector), '') AS sector
       FROM public.mom_advisor_info
       WHERE UPPER(TRIM(account_code)) = $1
       LIMIT 1`,
      [accountKey],
    )
    advisor = (advisorRes.rows[0] as MomCompareAdvisor | undefined) ?? null
  } catch {
    advisor = null
  }

  return { advisor, series }
}
