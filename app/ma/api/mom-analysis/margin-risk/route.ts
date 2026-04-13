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

export async function GET() {
  try {
    // Time-series: daily margin/equity + fund NAV matching product-nav formula exactly
    // (net of handling_fee + performance_fee on flows; net pnl = 当日盈亏 - 手续费 + 权利金收入 - 权利金支出)
    const tsSql = `
      WITH daily_pnl AS (
        SELECT
          "交易日期"::date AS date,
          SUM(
            COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏",     ''), ',', ''), ' ', ''), '')::numeric, 0)
            - COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("当日手续费",  ''), ',', ''), ' ', ''), '')::numeric, 0)
            + COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("权利金收入",  ''), ',', ''), ' ', ''), '')::numeric, 0)
            - COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("权利金支出",  ''), ',', ''), ' ', ''), '')::numeric, 0)
          ) AS day_pnl
        FROM mom_daily_reports
        GROUP BY "交易日期"::date
      ),
      fund_flows AS (
        SELECT
          confirmation_date::date AS date,
          SUM(CASE
            WHEN transaction_type IN ('认购确认', '申购确认') THEN
              COALESCE(confirmed_amount, 0) - COALESCE(handling_fee, 0) - COALESCE(performance_fee, 0)
            WHEN transaction_type = '赎回确认' THEN
              -(COALESCE(confirmed_amount, 0) - COALESCE(handling_fee, 0) - COALESCE(performance_fee, 0))
            ELSE 0
          END) AS net_flow
        FROM mom_fund_transactions
        WHERE transaction_type IN ('认购确认', '申购确认', '赎回确认')
        GROUP BY confirmation_date::date
      ),
      all_nav_dates AS (SELECT date FROM daily_pnl UNION SELECT date FROM fund_flows),
      daily_change AS (
        SELECT d.date,
          COALESCE(p.day_pnl, 0) + COALESCE(f.net_flow, 0) AS delta
        FROM all_nav_dates d
        LEFT JOIN daily_pnl p ON p.date = d.date
        LEFT JOIN fund_flows f ON f.date = d.date
      ),
      fund_nav AS (
        SELECT date,
          SUM(delta) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) AS nav
        FROM daily_change
      ),
      daily_margin AS (
        SELECT
          "交易日期"::date AS date,
          SUM((NULLIF(REPLACE(REPLACE(COALESCE("保证金占用", ''), ',', ''), ' ', ''), ''))::numeric) AS margin,
          SUM((NULLIF(REPLACE(REPLACE(COALESCE("客户权益",   ''), ',', ''), ' ', ''), ''))::numeric) AS equity,
          SUM((NULLIF(REPLACE(REPLACE(COALESCE("可用资金",   ''), ',', ''), ' ', ''), ''))::numeric) AS available
        FROM mom_daily_reports
        GROUP BY "交易日期"::date
      )
      SELECT
        m.date::text AS date,
        m.margin,
        m.equity,
        m.available,
        n.nav AS fund_nav
      FROM daily_margin m
      LEFT JOIN fund_nav n ON n.date = m.date
      ORDER BY m.date ASC
    `

    // Long vs short margin breakdown from position details
    const lsSql = `
      SELECT
        "交易日期"::date::text                                         AS date,
        SUM(CASE WHEN "买持仓"::numeric > 0 THEN "保证金"::numeric ELSE 0 END) AS long_margin,
        SUM(CASE WHEN "卖持仓"::numeric > 0 THEN "保证金"::numeric ELSE 0 END) AS short_margin
      FROM mom_futures_position_details
      GROUP BY "交易日期"::date
      ORDER BY "交易日期"::date ASC
    `

    // Per-account latest snapshot + time-series risk ratio
    const acctSql = `
      SELECT
        "账户"            AS account,
        "交易日期"::text  AS date,
        (NULLIF(REPLACE(REPLACE(REPLACE(COALESCE("风险度",     ''), ',', ''), ' ', ''), '%', ''), ''))::numeric  AS risk_ratio,
        (NULLIF(REPLACE(REPLACE(COALESCE("保证金占用", ''), ',', ''), ' ', ''), ''))::numeric  AS margin,
        (NULLIF(REPLACE(REPLACE(COALESCE("客户权益",   ''), ',', ''), ' ', ''), ''))::numeric  AS equity,
        (NULLIF(REPLACE(REPLACE(COALESCE("可用资金",   ''), ',', ''), ' ', ''), ''))::numeric  AS available
      FROM mom_daily_reports
      ORDER BY "交易日期" ASC
    `

    const [tsRows, acctRows, lsRows] = await Promise.all([
      query<{ date: string; margin: string | null; equity: string | null; available: string | null; fund_nav: string | null }>(tsSql),
      query<{ account: string; date: string; risk_ratio: string | null; margin: string | null; equity: string | null; available: string | null }>(acctSql),
      query<{ date: string; long_margin: string | null; short_margin: string | null }>(lsSql).catch(() => [] as { date: string; long_margin: string | null; short_margin: string | null }[]),
    ])

    // Build portfolio timeseries with riskRatio = margin / fund_nav * 100
    const lsMap = new Map(lsRows.map(r => [r.date, r]))
    const timeseries = tsRows.map(r => {
      const margin = parseNum(r.margin) ?? 0
      const equity = parseNum(r.equity) ?? 0
      const fundNav = parseNum(r.fund_nav) ?? (equity > 0 ? equity : null)
      return {
        date: r.date,
        margin,
        equity,
        available: parseNum(r.available) ?? 0,
        fundNav,
        riskRatio: fundNav != null && fundNav > 0 ? margin / fundNav * 100 : null,
        // Long/short split: use position details only for the proportion,
        // then scale to the authoritative total margin so bars always sum correctly.
        longMarginRatio: (() => {
          if (fundNav == null || fundNav <= 0 || margin <= 0) return null
          const ls = lsMap.get(r.date)
          const lm = parseNum(ls?.long_margin) ?? null
          const sm = parseNum(ls?.short_margin) ?? null
          if (lm == null || sm == null) return null
          const lsTotal = lm + sm
          if (lsTotal <= 0) return null
          return (margin * (lm / lsTotal)) / fundNav * 100
        })(),
        shortMarginRatio: (() => {
          if (fundNav == null || fundNav <= 0 || margin <= 0) return null
          const ls = lsMap.get(r.date)
          const lm = parseNum(ls?.long_margin) ?? null
          const sm = parseNum(ls?.short_margin) ?? null
          if (lm == null || sm == null) return null
          const lsTotal = lm + sm
          if (lsTotal <= 0) return null
          return (margin * (sm / lsTotal)) / fundNav * 100
        })(),
      }
    })

    // Per-account time-series
    const acctMap = new Map<string, { date: string; riskRatio: number | null; margin: number; equity: number; available: number }[]>()
    for (const r of acctRows) {
      if (!acctMap.has(r.account)) acctMap.set(r.account, [])
      const margin = parseNum(r.margin) ?? 0
      const equity = parseNum(r.equity) ?? 0
      acctMap.get(r.account)!.push({
        date: r.date,
        riskRatio: parseNum(r.risk_ratio),
        margin,
        equity,
        available: parseNum(r.available) ?? 0,
      })
    }

    const accounts = Array.from(acctMap.entries()).map(([account, series]) => ({
      account,
      series,
    }))

    // Latest snapshot per account
    const latest = accounts.map(a => {
      const last = a.series[a.series.length - 1]
      return { account: a.account, ...last }
    }).sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))

    return NextResponse.json({ ok: true, timeseries, accounts, latest })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, timeseries: [], accounts: [], latest: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
