import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { canModifyCompareAccount } from "@/lib/permissions"
import { resolveFundMomAccountLinks } from "@/lib/server/ops-fund-mom-accounts"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

type AdvisorRow = {
  advisor_name: string | null
  company: string | null
  sector: string | null
}

export type AccountComparePoint = {
  date: string
  nav: number
  dailyReturn: number
  pnl: number
  equity: number
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao } = await params
  const { searchParams } = new URL(req.url)
  const productName = searchParams.get("product_name")
  const linked = await resolveFundMomAccountLinks(beian_hao, productName)
  const fallbackAccount = linked[0]?.account ?? null
  const requestUser = await getRequestUser(req)
  const canPickAccount = canModifyCompareAccount(requestUser)
  const account = ((canPickAccount ? searchParams.get("account") : null) || fallbackAccount || "").trim()
  const from = searchParams.get("from") || ""
  const to = searchParams.get("to") || ""

  try {
    let availableAccounts: string[] = linked.map((row) => row.account)
    try {
      const accRes = await publicQuery(
        `SELECT DISTINCT LOWER(TRIM("账户"::text)) AS account
         FROM public.mom_daily_reports
         WHERE "账户" IS NOT NULL AND TRIM("账户"::text) <> ''
         ORDER BY 1`,
      )
      const seen = new Set(availableAccounts.map((a) => a.toLowerCase()))
      for (const row of accRes.rows as Array<{ account: string }>) {
        const acc = String(row.account || "").toLowerCase()
        if (!acc || seen.has(acc)) continue
        seen.add(acc)
        availableAccounts.push(acc)
      }
    } catch {
      // keep linked accounts only
    }
    if (!canPickAccount) {
      const locked = (account || fallbackAccount || "").toLowerCase()
      availableAccounts = locked ? [locked] : []
    }

    if (!account) {
      return NextResponse.json({
        ok: true,
        account: null,
        defaultAccount: fallbackAccount,
        linkedAccounts: linked,
        availableAccounts,
        advisor: null,
        series: [],
        message: "请选择要对比的 MOM 账户",
      })
    }

    const accountKey = account.toUpperCase()
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
         ${dateFilter.join("\n         ")}
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

    let advisor: AdvisorRow | null = null
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
      advisor = (advisorRes.rows[0] as AdvisorRow | undefined) ?? null
    } catch {
      advisor = null
    }

    return NextResponse.json({
      ok: true,
      account: account.toLowerCase(),
      defaultAccount: fallbackAccount,
      linkedAccounts: linked,
      availableAccounts,
      advisor,
      series,
      message: series.length ? null : `账户 ${account.toLowerCase()} 暂无 MOM 结算数据`,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist") || msg.includes("mom_daily_reports")) {
      return NextResponse.json({
        ok: true,
        account: account.toLowerCase(),
        defaultAccount: fallbackAccount,
        linkedAccounts: linked,
        availableAccounts: linked.map((row) => row.account),
        advisor: null,
        series: [],
        message: "MOM 结算数据尚未导入",
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
