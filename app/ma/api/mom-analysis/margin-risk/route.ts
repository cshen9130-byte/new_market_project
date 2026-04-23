import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null
  const clean = String(v).replace(/[,%\s]/g, "").trim()
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

async function _GET() {
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

    // Sector-level daily margin grouped by mom_advisor_info.sector
    // Falls back to per-account grouping if mom_advisor_info table doesn't exist yet
    const sectorSqlWithAdvisor = `
      SELECT
        d."交易日期"::date::text                                                                            AS date,
        COALESCE(NULLIF(TRIM(a.sector), ''), '未分类')                                                     AS sector,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE(d."保证金占用", ''), ',', ''), ' ', ''), ''))::numeric)       AS sector_margin
      FROM mom_daily_reports d
      LEFT JOIN mom_advisor_info a ON a.account_code = d."账户"
      GROUP BY d."交易日期"::date, COALESCE(NULLIF(TRIM(a.sector), ''), '未分类')
      ORDER BY d."交易日期"::date ASC
    `
    const sectorSqlByAccount = `
      SELECT
        "交易日期"::date::text                                                                              AS date,
        "账户"                                                                                              AS sector,
        SUM((NULLIF(REPLACE(REPLACE(COALESCE("保证金占用", ''), ',', ''), ' ', ''), ''))::numeric)         AS sector_margin
      FROM mom_daily_reports
      GROUP BY "交易日期"::date, "账户"
      ORDER BY "交易日期"::date ASC
    `

    // Per-sector long/short margin from position details joined with mom_advisor_info
    const sectorLsSql = `
      SELECT
        fp."交易日期"::date::text                                                                           AS date,
        COALESCE(NULLIF(TRIM(a.sector), ''), '未分类')                                                     AS sector,
        SUM(CASE WHEN (NULLIF(REPLACE(fp."买持仓", ',', ''), ''))::numeric > 0
              THEN (NULLIF(REPLACE(REPLACE(fp."保证金", ',', ''), ' ', ''), ''))::numeric ELSE 0 END)      AS long_margin,
        SUM(CASE WHEN (NULLIF(REPLACE(fp."卖持仓", ',', ''), ''))::numeric > 0
              THEN (NULLIF(REPLACE(REPLACE(fp."保证金", ',', ''), ' ', ''), ''))::numeric ELSE 0 END)      AS short_margin
      FROM mom_futures_position_details fp
      LEFT JOIN mom_advisor_info a ON a.account_code = fp."账户"
      GROUP BY fp."交易日期"::date, COALESCE(NULLIF(TRIM(a.sector), ''), '未分类')
      ORDER BY fp."交易日期"::date ASC
    `

    const [tsRows, acctRows, lsRows] = await Promise.all([
      query<{ date: string; margin: string | null; equity: string | null; available: string | null; fund_nav: string | null }>(tsSql),
      query<{ account: string; date: string; risk_ratio: string | null; margin: string | null; equity: string | null; available: string | null }>(acctSql),
      query<{ date: string; long_margin: string | null; short_margin: string | null }>(lsSql).catch(() => [] as { date: string; long_margin: string | null; short_margin: string | null }[]),
    ])

    type SectorRow = { date: string; sector: string; sector_margin: string | null }
    const sectorRows: SectorRow[] = await query<SectorRow>(sectorSqlWithAdvisor).catch(async () => {
      console.warn("[margin-risk] mom_advisor_info unavailable, falling back to per-account grouping")
      return query<SectorRow>(sectorSqlByAccount).catch(() => [] as SectorRow[])
    })

    type SectorLsRow = { date: string; sector: string; long_margin: string | null; short_margin: string | null }
    const sectorLsRows: SectorLsRow[] = await query<SectorLsRow>(sectorLsSql).catch(() => [] as SectorLsRow[])

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

    // Per-sector time-series: sector margin / portfolio fund_nav
    const fundNavMap = new Map(timeseries.map(r => [r.date, r.fundNav]))
    const sectorMap = new Map<string, { date: string; riskRatio: number | null }[]>()
    for (const r of sectorRows) {
      if (!sectorMap.has(r.sector)) sectorMap.set(r.sector, [])
      const sm = parseNum(r.sector_margin) ?? 0
      const fundNav = fundNavMap.get(r.date) ?? null
      sectorMap.get(r.sector)!.push({
        date: r.date,
        riskRatio: fundNav != null && fundNav > 0 ? sm / fundNav * 100 : null,
      })
    }
    const sectorSeries = Array.from(sectorMap.entries()).map(([sector, series]) => ({ sector, series }))

    // Per-sector long/short timeseries (scaled proportionally like portfolio LS)
    const sectorLsMap = new Map<string, { date: string; longMarginRatio: number | null; shortMarginRatio: number | null }[]>()
    for (const r of sectorLsRows) {
      if (!sectorLsMap.has(r.sector)) sectorLsMap.set(r.sector, [])
      const lm = parseNum(r.long_margin) ?? 0
      const sm = parseNum(r.short_margin) ?? 0
      const fundNav = fundNavMap.get(r.date) ?? null
      sectorLsMap.get(r.sector)!.push({
        date: r.date,
        longMarginRatio: fundNav != null && fundNav > 0 ? lm / fundNav * 100 : null,
        shortMarginRatio: fundNav != null && fundNav > 0 ? sm / fundNav * 100 : null,
      })
    }
    const sectorLsSeries = Array.from(sectorLsMap.entries()).map(([sector, series]) => ({ sector, series }))

    // Per-account latest-date long/short from position details
    const acctLsSql = `
      SELECT
        fp."账户"                AS account,
        fp."交易日期"::date::text AS date,
        SUM(CASE WHEN (NULLIF(REPLACE(fp."买持仓", ',', ''), ''))::numeric > 0
              THEN (NULLIF(REPLACE(REPLACE(fp."保证金", ',', ''), ' ', ''), ''))::numeric ELSE 0 END) AS long_margin,
        SUM(CASE WHEN (NULLIF(REPLACE(fp."卖持仓", ',', ''), ''))::numeric > 0
              THEN (NULLIF(REPLACE(REPLACE(fp."保证金", ',', ''), ' ', ''), ''))::numeric ELSE 0 END) AS short_margin
      FROM mom_futures_position_details fp
      GROUP BY fp."账户", fp."交易日期"::date
      ORDER BY fp."交易日期"::date ASC
    `

    type AcctLsRow = { account: string; date: string; long_margin: string | null; short_margin: string | null }
    const acctLsRows: AcctLsRow[] = await query<AcctLsRow>(acctLsSql).catch(() => [] as AcctLsRow[])

    // Latest LS per account: pick the most recent date row for each account
    const acctLsLatestMap = new Map<string, { longMarginRatio: number | null; shortMarginRatio: number | null }>()
    // Group by account, take last row (already ordered ASC so last = latest)
    const acctLsGrouped = new Map<string, AcctLsRow[]>()
    for (const r of acctLsRows) {
      if (!acctLsGrouped.has(r.account)) acctLsGrouped.set(r.account, [])
      acctLsGrouped.get(r.account)!.push(r)
    }
    for (const [account, rows] of acctLsGrouped) {
      const last = rows[rows.length - 1]
      const lm = parseNum(last.long_margin) ?? 0
      const sm = parseNum(last.short_margin) ?? 0
      const total = lm + sm
      // Store proportions (0–1); chart will multiply by account's own riskRatio
      acctLsLatestMap.set(account, {
        longMarginRatio: total > 0 ? lm / total : null,
        shortMarginRatio: total > 0 ? sm / total : null,
      })
    }
    // Merge into latest snapshot (with sector from mom_advisor_info)
    const acctSectorRows: { account_code: string; sector: string }[] = await query<{ account_code: string; sector: string }>(
      `SELECT account_code, COALESCE(NULLIF(TRIM(sector),''),'未分类') AS sector FROM mom_advisor_info`
    ).catch(() => [] as { account_code: string; sector: string }[])
    const acctSectorMap = new Map(acctSectorRows.map(r => [r.account_code, r.sector]))

    const latestWithLs = latest.map(a => ({
      ...a,
      sector: acctSectorMap.get(a.account) ?? '未分类',
      ...(acctLsLatestMap.get(a.account) ?? { longMarginRatio: null, shortMarginRatio: null }),
    }))

    // Merge guoxin (guosen) account into all data structures — skipped if unavailable
    try {
      const guosenMarginRows = await query<{
        trade_date: string; margin_occupied: string | null
        client_equity: string | null; fund_avail: string | null
      }>(
        `SELECT trade_date::text AS trade_date,
                COALESCE(margin_occupied, 0)::text AS margin_occupied,
                COALESCE(client_equity, 0)::text   AS client_equity,
                COALESCE(fund_avail, 0)::text       AS fund_avail
         FROM guosen_account_summary
         ORDER BY trade_date ASC`,
      )

      if (guosenMarginRows.length > 0) {
        // Per-account timeseries
        const guosenAcctSeries = guosenMarginRows.map(r => {
          const margin  = parseNum(r.margin_occupied) ?? 0
          const equity  = parseNum(r.client_equity)   ?? 0
          return {
            date:      r.trade_date,
            riskRatio: equity > 0 ? Math.round(margin / equity * 1000) / 10 : null,
            margin,
            equity,
            available: parseNum(r.fund_avail) ?? 0,
          }
        })
        accounts.push({ account: "guoxin", series: guosenAcctSeries })

        // Compute long/short margin proportions from guosen_position_detail
        const guosenLsRows = await query<{ long_margin: string | null; short_margin: string | null }>(
          `SELECT
             SUM(CASE WHEN bs='买' THEN COALESCE(margin,0) ELSE 0 END)::text AS long_margin,
             SUM(CASE WHEN bs='卖' THEN COALESCE(margin,0) ELSE 0 END)::text AS short_margin
           FROM guosen_position_detail
           WHERE settlement_date = (SELECT MAX(settlement_date) FROM guosen_position_detail)`,
        ).catch(() => [] as { long_margin: string | null; short_margin: string | null }[])
        const lsRow = guosenLsRows[0]
        const glm = lsRow ? (parseNum(lsRow.long_margin) ?? 0) : 0
        const gsm = lsRow ? (parseNum(lsRow.short_margin) ?? 0) : 0
        const gLsTotal = glm + gsm
        const guoxinLongRatio  = gLsTotal > 0 ? glm / gLsTotal : null
        const guoxinShortRatio = gLsTotal > 0 ? gsm / gLsTotal : null

        // Latest snapshot
        const lastG = guosenAcctSeries[guosenAcctSeries.length - 1]
        latestWithLs.push({
          account:          "guoxin",
          date:             lastG.date,
          riskRatio:        lastG.riskRatio,
          margin:           lastG.margin,
          equity:           lastG.equity,
          available:        lastG.available,
          sector:           "未分类",
          longMarginRatio:  guoxinLongRatio,
          shortMarginRatio: guoxinShortRatio,
        })
        latestWithLs.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))

        // Merge into portfolio timeseries
        const guosenDateMap = new Map(guosenMarginRows.map(r => [r.trade_date, r]))
        for (const ts of timeseries) {
          const g = guosenDateMap.get(ts.date)
          if (!g) continue
          const gMargin = parseNum(g.margin_occupied) ?? 0
          const gEquity = parseNum(g.client_equity)   ?? 0
          ts.margin    += gMargin
          ts.equity    += gEquity
          ts.available += parseNum(g.fund_avail) ?? 0
          ts.fundNav    = ts.fundNav != null ? ts.fundNav + gEquity : gEquity
          ts.riskRatio  = ts.fundNav > 0 ? ts.margin / ts.fundNav * 100 : null
        }
      }
    } catch {
      // guosen_account_summary not available — skip
    }

    return NextResponse.json({ ok: true, timeseries, accounts, latest: latestWithLs, sectorSeries, sectorLsSeries })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, timeseries: [], accounts: [], latest: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("margin-risk", _GET)
