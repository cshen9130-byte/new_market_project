import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { loadEmailNavSeries, loadPrivateFundLegacyNavRows, mergeLegacyWithTeamNav, mergeNavSeriesWithEmail } from "@/lib/server/email-nav-query"
import { resolveRouteFundId, lookupFundInfoFallback } from "@/lib/server/fof-underlying-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import { loadManagedProductNavSeries } from "@/lib/server/team-nav-manage-pg"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> }
) {
  try {
    const { beian_hao: rawParam } = await params
    const rawId = (() => {
      try {
        return decodeURIComponent(rawParam).trim()
      } catch {
        return rawParam.trim()
      }
    })()
    const beian_hao = await resolveRouteFundId(rawId)

  const infoRows = await query<{
    beian_hao:      string
    product_name:   string
    short_name:     string | null
    strategy_l1:    string | null
    strategy_l2:    string | null
    strategy_l3:    string | null
    manager:        string
    inception_date: string | null
    benchmark:      string | null
    ret_1w:         string | null
    ret_1m:         string | null
    ret_3m:         string | null
    ret_6m:         string | null
    ret_1y:         string | null
    sharpe_1y:      string | null
    calmar_1y:      string | null
  }>(
    `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1, strategy_l2, NULL::text AS strategy_l3, manager,
            inception_date::text AS inception_date, benchmark,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text
     FROM private_fund_info WHERE beian_hao = $1`,
    [beian_hao]
  )

  const bflRows = infoRows[0]
    ? []
    : await query<{
        beian_hao:      string
        product_name:   string
        short_name:     string | null
        strategy_l1:    string | null
        strategy_l2:    string | null
        strategy_l3:    string | null
        manager:        string
        inception_date: string | null
        benchmark:      string | null
        ret_1w:         string | null
        ret_1m:         string | null
        ret_3m:         string | null
        ret_6m:         string | null
        ret_1y:         string | null
        sharpe_1y:      string | null
        calmar_1y:      string | null
      }>(
        `SELECT beian_hao, product_name, short_name,
                strategy_one AS strategy_l1,
                strategy_two AS strategy_l2,
                strategy_three AS strategy_l3,
                ''::text     AS manager,
                NULL::text   AS inception_date,
                NULL::text   AS benchmark,
                NULL::text   AS ret_1w,
                NULL::text   AS ret_1m,
                NULL::text   AS ret_3m,
                NULL::text   AS ret_6m,
                NULL::text   AS ret_1y,
                NULL::text   AS sharpe_1y,
                NULL::text   AS calmar_1y
         FROM private_fund_info_bfl
         WHERE beian_hao = $1`,
        [beian_hao]
      )

  // Fallback: look for fund in tracking pool tables (type6_ops_team_full or register_number pools)
  type InfoRowShape = typeof infoRows[0]
  const trackingRow: InfoRowShape | undefined = (infoRows[0] || bflRows[0])
    ? undefined
    : await (async () => {
        // Try type6_ops_team_full first (has most metadata)
        try {
          const rows = await query<{ register_number: string; fund_name: string; short_name: string | null; company_strategy_one: string | null; company_strategy_two: string | null; company_strategy_three: string | null }>(
            `SELECT register_number, fund_name, fund_short_name AS short_name,
                    company_strategy_one, company_strategy_two, company_strategy_three
             FROM type6_ops_team_full
             WHERE register_number = $1
             LIMIT 1`,
            [beian_hao]
          )
          if (rows[0]) {
            return {
              beian_hao:      rows[0].register_number,
              product_name:   rows[0].short_name ?? rows[0].fund_name,
              short_name:     rows[0].fund_name,
              strategy_l1:    rows[0].company_strategy_one,
              strategy_l2:    rows[0].company_strategy_two,
              strategy_l3:    rows[0].company_strategy_three,
              manager:        "",
              inception_date: null,
              benchmark:      null,
              ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null,
              sharpe_1y: null, calmar_1y: null,
            } as InfoRowShape
          }
        } catch { /* table may not exist */ }

        // Try generic pool tables
        const poolTables = [
          { table: "tracking_pool",   nameCol: "product_name", idCol: "register_number" },
          { table: "selected_pool",   nameCol: "product_name", idCol: "register_number" },
          { table: "core_pool",       nameCol: "product_name", idCol: "register_number" },
          { table: "hy_tracking_pool",nameCol: "product_name", idCol: "register_number" },
          { table: "fof_mom_tracking",nameCol: "product_name", idCol: "register_number" },
          { table: "user_custom_pool",nameCol: "product_name", idCol: "register_number" },
        ]
        for (const p of poolTables) {
          try {
            const rows = await query<{ product_name: string }>(
              `SELECT ${p.nameCol} AS product_name FROM ${p.table} WHERE ${p.idCol} = $1 LIMIT 1`,
              [beian_hao]
            )
            if (rows[0]) {
              return {
                beian_hao,
                product_name: rows[0].product_name,
                short_name:   null,
                strategy_l1:  null,
                strategy_l2:  null,
                strategy_l3:  null,
                manager:      "",
                inception_date: null, benchmark: null,
                ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null,
                sharpe_1y: null, calmar_1y: null,
              } as InfoRowShape
            }
          } catch { /* table may not exist */ }
        }
        return undefined
      })()

  let info = infoRows[0] ?? bflRows[0] ?? trackingRow
  if (!info) {
    info = (await lookupFundInfoFallback(rawId)) ?? (rawId !== beian_hao ? await lookupFundInfoFallback(beian_hao) : null)
  }
  if (!info) return NextResponse.json({ error: "Fund not found" }, { status: 404 })

  const routeBeianHao = info.beian_hao || beian_hao

  // Fetch strategy_l3 from various sources (column may not exist in all tables — use try-catch)
  let strategy_l3: string | null = (info as Record<string, unknown>).strategy_l3 as string | null ?? null
  if (!strategy_l3) {
    for (const [sql, params] of [
      [`SELECT strategy_three::text AS l3 FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`, [routeBeianHao]],
      [`SELECT company_strategy_three::text AS l3 FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`, [routeBeianHao]],
    ] as [string, string[]][]) {
      try {
        const rows = await query<{ l3: string | null }>(sql, params)
        if (rows[0]?.l3) { strategy_l3 = rows[0].l3; break }
      } catch { /* column may not exist */ }
    }
  }

  const productName = info.product_name ?? ""
  let shortName = info.short_name ?? ""

  const bflNameRows = await query<{ product_name: string; short_name: string | null }>(
    `SELECT product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
    [routeBeianHao],
  ).catch(() => [] as { product_name: string; short_name: string | null }[])

  const emailNameAliases = [
    bflNameRows[0]?.product_name,
    bflNameRows[0]?.short_name,
    info.product_name,
    info.short_name,
  ]
  if (!shortName && bflNameRows[0]?.short_name) {
    shortName = bflNameRows[0].short_name
  }

  const bflTrackRows = await query<{ scale: string | null; manager_names: string | null }>(
    `SELECT scale, manager_names
     FROM basicinfo_bfl_track
     WHERE register_number = $1
        OR record_key = $1
        OR ($2 <> '' AND (fund_name = $2 OR fund_short_name = $2))
        OR ($3 <> '' AND (fund_name = $3 OR fund_short_name = $3))
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [routeBeianHao, productName, shortName]
  ).catch(() => [] as { scale: string | null; manager_names: string | null }[])

  const scale = bflTrackRows[0]?.scale ?? null
  const manager_names = bflTrackRows[0]?.manager_names ?? null

  let navRows: {
    price_date: string
    nav: string
    cumulative_nav: string
    cum_nav_withdrawal: string
    price_change: string
  }[] = []
  try {
    navRows = await query<{
      price_date:         string
      nav:                string
      cumulative_nav:     string
      cum_nav_withdrawal: string
      price_change:       string
    }>(
      `SELECT DISTINCT ON (price_date)
          price_date::text AS price_date,
          nav::text,
          cumulative_nav::text,
          cum_nav_withdrawal::text,
          price_change::text
       FROM (
         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 0 AS pri
         FROM private_fund_nav_group_type6
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 1 AS pri
         FROM private_fund_nav_group_type6
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 2 AS pri
         FROM private_fund_nav_group_type6
         WHERE $3 <> '' AND product_name = $3

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 3 AS pri
         FROM private_fund_nav_group
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 4 AS pri
         FROM private_fund_nav_group
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 5 AS pri
         FROM private_fund_nav_group
         WHERE $3 <> '' AND product_name = $3

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 6 AS pri
         FROM private_fund_nav_group_hy
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 7 AS pri
         FROM private_fund_nav_group_hy
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 8 AS pri
         FROM private_fund_nav_group_hy
         WHERE $3 <> '' AND product_name = $3

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 9 AS pri
         FROM private_fund_nav
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 10 AS pri
         FROM private_fund_nav
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 11 AS pri
         FROM private_fund_nav
         WHERE $3 <> '' AND product_name = $3
       ) nav_union
       ORDER BY price_date ASC, pri ASC`,
      [routeBeianHao, productName, shortName],
    )
  } catch (err) {
    console.error("[private-funds/detail] legacy nav query failed:", err)
  }

  let emailNavRows: Awaited<ReturnType<typeof loadEmailNavSeries>> = []
  try {
    emailNavRows = await loadEmailNavSeries(routeBeianHao, productName, shortName || null, emailNameAliases)
  } catch (err) {
    console.error("[private-funds/detail] email nav query failed:", err)
  }

  const managedOverride =
    lookupManagedProductOverride(routeBeianHao)
    ?? lookupManagedProductOverride(productName)
    ?? lookupManagedProductOverride(rawId)

  let nav_series = mergeNavSeriesWithEmail(navRows, emailNavRows)
  if (managedOverride) {
    try {
      const [teamSeries, seedRows] = await Promise.all([
        loadManagedProductNavSeries({
          beian_hao: managedOverride.beian_hao,
          product_name: managedOverride.product_name,
          short_name: shortName || null,
          extraNames: emailNameAliases,
        }),
        Promise.resolve(loadManagedProductNavSeed(managedOverride.beian_hao)),
      ])
      if (teamSeries.length > 0) {
        // Email 估值表 stream wins; seed/legacy only backfill dates before the email series starts.
        const legacyNoType6 = await loadPrivateFundLegacyNavRows(
          routeBeianHao,
          productName,
          shortName,
          { excludeType6: true },
        )
        const firstTeamDate = teamSeries[0]?.price_date ?? ""
        const seedBackfill = seedRows.filter((row) => !firstTeamDate || row.price_date < firstTeamDate)
        let base = mergeNavSeriesWithEmail(legacyNoType6, [])
        if (seedBackfill.length > 0) {
          base = mergeLegacyWithTeamNav(base, seedBackfill)
        }
        nav_series = mergeLegacyWithTeamNav(base, teamSeries)
      } else if (seedRows.length > 0) {
        nav_series = mergeNavSeriesWithEmail(seedRows, emailNavRows)
      } else {
        const legacyNoType6 = await loadPrivateFundLegacyNavRows(
          routeBeianHao,
          productName,
          shortName,
          { excludeType6: true },
        )
        nav_series = mergeNavSeriesWithEmail(legacyNoType6, emailNavRows)
      }
    } catch (err) {
      console.error("[private-funds/detail] managed product nav query failed:", err)
    }
  } else if (emailNavRows.length > 0) {
    nav_series = mergeNavSeriesWithEmail(navRows, emailNavRows)
  } else {
    const seedRows = loadManagedProductNavSeed(routeBeianHao)
    if (seedRows.length > 0) {
      nav_series = mergeNavSeriesWithEmail(seedRows, [])
    }
  }
  const first = nav_series[0]
  const latest = nav_series[nav_series.length - 1]

  // Headline returns should follow the reinvested series, which matches the source system.
  const latestReinvestedNav = latest ? parseFloat(latest.cumulative_nav) : null
  const firstReinvestedNav = first ? parseFloat(first.cumulative_nav) : null
  const ret_since_inception =
    latestReinvestedNav !== null && firstReinvestedNav !== null && firstReinvestedNav > 0
      ? latestReinvestedNav / firstReinvestedNav - 1
      : null

  // Days since inception
  const inceptionDate = first  ? new Date(first.price_date)  : null
  const latestDate    = latest ? new Date(latest.price_date) : null
  const days =
    inceptionDate && latestDate
      ? (latestDate.getTime() - inceptionDate.getTime()) / 86_400_000
      : null

  // Annualized since inception
  const ann_ret =
    ret_since_inception !== null && days && days > 0
      ? Math.pow(1 + ret_since_inception, 365 / days) - 1
      : null

  // YTD return: use the last value before year start when available, otherwise the
  // first value inside the year. This matches common fund-reporting conventions.
  const yearPrefix = latest ? latest.price_date.slice(0, 4) + "-01-01" : null
  const ytdBase = yearPrefix
    ? [...nav_series].reverse().find((r) => r.price_date < yearPrefix) ?? nav_series.find((r) => r.price_date >= yearPrefix) ?? null
    : null
  const ytd_ret =
    ytdBase && latest
      ? parseFloat(latest.cumulative_nav) / parseFloat(ytdBase.cumulative_nav) - 1
      : null

  // Max drawdown + daily returns for Sharpe (from cumulative_nav reinvested series)
  let peak = -Infinity
  let maxDrawdown = 0
  const dailyReturns: number[] = []
  for (let i = 0; i < nav_series.length; i++) {
    const v = parseFloat(nav_series[i].cumulative_nav)
    if (v > peak) peak = v
    const dd = peak > 0 ? (peak - v) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
    if (i > 0) {
      const prev = parseFloat(nav_series[i - 1].cumulative_nav)
      if (prev > 0) dailyReturns.push(v / prev - 1)
    }
  }

  // Since-inception Sharpe = annualised return / annualised volatility (rf = 0)
  // Use actual records-per-year so weekly/daily funds both annualise correctly
  let sharpe_since_inception: string | null = null
  if (ann_ret !== null && dailyReturns.length > 1 && days && days > 0) {
    const totalYears = days / 365
    const recordsPerYear = dailyReturns.length / totalYears
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recordsPerYear)
    if (annVol > 0) sharpe_since_inception = (ann_ret / annVol).toFixed(2)
  }

  return NextResponse.json({
    info: { ...info, strategy_l3, scale, manager_names },
    nav_series,
    metrics: {
      latest_nav:                latest?.nav              ?? null,
      latest_nav_date:           latest?.price_date       ?? null,
      latest_cum_nav:            latest?.cum_nav_withdrawal ?? null,
      latest_cum_nav_reinvested: latest?.cumulative_nav   ?? null,
      ret_since_inception: ret_since_inception !== null ? (ret_since_inception * 100).toFixed(2) : null,
      ann_ret:             ann_ret             !== null ? (ann_ret             * 100).toFixed(2) : null,
      ytd_ret:             ytd_ret             !== null ? (ytd_ret             * 100).toFixed(2) : null,
      max_drawdown:        maxDrawdown > 0               ? (maxDrawdown        * 100).toFixed(2) : null,
      sharpe_since_inception,
    },
  })
  } catch (err) {
    console.error("[private-funds/detail]", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "Failed to load fund detail", detail: message }, { status: 500 })
  }
}
