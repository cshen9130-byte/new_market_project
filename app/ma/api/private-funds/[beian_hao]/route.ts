import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { isWeekendIsoDate } from "@/lib/nav-trading-day"
import { tryGetCustomFundPrivateDetail } from "@/lib/server/custom-funds"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import { recomputeNavPriceChanges, type LegacyNavRow } from "@/lib/server/email-nav-query"
import { lookupFundInfoFallback } from "@/lib/server/fof-underlying-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import { lookupAmacFundMetadata } from "@/lib/server/amac-fund-metadata"
import { preferOfficialManagerName } from "@/lib/server/manager-name-canonical"
import { ensureShareClassBeianProduct } from "@/lib/server/share-class-product"
import {
  loadBasicinfoTrackByBeianKeys,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import {
  buildDetailHeaderFromListCache,
  loadDetailNavSeriesFast,
  lookupListCacheFundHeader,
  resolveRouteFundIdFast,
  type ListCacheFundHeader,
} from "@/lib/server/fund-detail-fast-path"
import {
  detailNavCacheCoversTeamDates,
  getDetailNavCache,
  isDetailNavCacheFresh,
  persistDetailNavSeries,
  syncListTipsFromDetailSeries,
} from "@/lib/server/fund-detail-nav-cache-pg"
import { loadManualTeamNavBatch, manualNavPointsForBeian } from "@/lib/server/team-nav-manage-pg"
import {
  getDetailResponseMemoryCache,
  rememberDetailResponseMemoryCache,
} from "@/lib/server/fund-detail-response-memory-cache"
import { loadTeamBenchmark } from "@/lib/server/ops-team-benchmarks"

export const dynamic = "force-dynamic"

// Minimum elapsed days of NAV history before annualizing "since inception" return/Sharpe.
const MIN_DAYS_FOR_ANNUALIZATION = 30

type InfoRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  manager: string
  inception_date: string | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

function pctFromCache(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? (n * 100).toFixed(4) : null
}

/** Drop non-trading days from detail payload (also sanitizes stale in-memory cache). */
function sanitizeDetailNavSeries<T extends LegacyNavRow>(rows: T[]): T[] {
  const filtered = rows.filter((row) => isChinaTradingDay(String(row.price_date).slice(0, 10)))
  return recomputeNavPriceChanges(filtered) as T[]
}

function sanitizeDetailBody<T extends {
  nav_series?: LegacyNavRow[]
  metrics?: {
    latest_nav?: string | null
    latest_nav_date?: string | null
    latest_cum_nav?: string | null
    latest_cum_nav_reinvested?: string | null
  }
}>(body: T): T {
  const series = Array.isArray(body.nav_series) ? sanitizeDetailNavSeries(body.nav_series) : []
  const latest = series[series.length - 1]
  const metrics = body.metrics
    ? {
        ...body.metrics,
        latest_nav: latest?.nav ?? body.metrics.latest_nav ?? null,
        latest_nav_date: latest?.price_date ?? (
          body.metrics.latest_nav_date && !isWeekendIsoDate(body.metrics.latest_nav_date)
            ? body.metrics.latest_nav_date
            : null
        ),
        latest_cum_nav: latest?.cum_nav_withdrawal ?? body.metrics.latest_cum_nav ?? null,
        latest_cum_nav_reinvested: latest?.cumulative_nav ?? body.metrics.latest_cum_nav_reinvested ?? null,
      }
    : body.metrics
  return { ...body, nav_series: series, metrics }
}

/** 团队策略 is highest priority; fall back to 平台策略 only when team data is empty. */
function preferTeamStrategy(
  company: { l1: string | null; l2: string | null; l3: string | null },
  platform: { l1: string | null; l2: string | null; l3: string | null },
): { l1: string | null; l2: string | null; l3: string | null } {
  if (company.l1 || company.l2 || company.l3) return company
  return platform
}

function infoFromListCache(
  beian_hao: string,
  cached: ListCacheFundHeader,
): InfoRow {
  const preferred = preferTeamStrategy(
    {
      l1: cached.company_strategy_l1,
      l2: cached.company_strategy_l2,
      l3: cached.company_strategy_l3,
    },
    {
      l1: cached.platform_strategy_l1,
      l2: cached.platform_strategy_l2,
      l3: cached.platform_strategy_l3,
    },
  )
  return {
    beian_hao: cached.beian_hao ?? beian_hao,
    product_name: cached.product_name,
    short_name: cached.short_name,
    strategy_l1: preferred.l1,
    strategy_l2: preferred.l2,
    strategy_l3: preferred.l3,
    manager: "",
    inception_date: null,
    benchmark: null,
    ret_1w: null,
    ret_1m: null,
    ret_3m: null,
    ret_6m: null,
    ret_1y: null,
    sharpe_1y: cached.sharpe_1y,
    calmar_1y: cached.calmar_1y,
  }
}

async function loadTrackingInfoFallback(beian_hao: string): Promise<InfoRow | undefined> {
  try {
    const rows = await query<{
      register_number: string
      fund_name: string
      short_name: string | null
      company_strategy_one: string | null
      company_strategy_two: string | null
      company_strategy_three: string | null
    }>(
      `SELECT register_number, fund_name, fund_short_name AS short_name,
              company_strategy_one, company_strategy_two, company_strategy_three
       FROM type6_ops_team_full
       WHERE register_number = $1
       LIMIT 1`,
      [beian_hao],
    )
    if (rows[0]) {
      return {
        beian_hao: rows[0].register_number,
        product_name: rows[0].short_name ?? rows[0].fund_name,
        short_name: rows[0].fund_name,
        strategy_l1: rows[0].company_strategy_one,
        strategy_l2: rows[0].company_strategy_two,
        strategy_l3: rows[0].company_strategy_three,
        manager: "",
        inception_date: null,
        benchmark: null,
        ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null,
        sharpe_1y: null, calmar_1y: null,
      }
    }
  } catch { /* table may not exist */ }

  const poolTables = [
    { table: "tracking_pool", nameCol: "product_name", idCol: "register_number" },
    { table: "selected_pool", nameCol: "product_name", idCol: "register_number" },
    { table: "core_pool", nameCol: "product_name", idCol: "register_number" },
    { table: "hy_tracking_pool", nameCol: "product_name", idCol: "register_number" },
    { table: "fof_mom_tracking", nameCol: "product_name", idCol: "register_number" },
    { table: "user_custom_pool", nameCol: "product_name", idCol: "register_number" },
  ]
  for (const p of poolTables) {
    try {
      const rows = await query<{ product_name: string }>(
        `SELECT ${p.nameCol} AS product_name FROM ${p.table} WHERE ${p.idCol} = $1 LIMIT 1`,
        [beian_hao],
      )
      if (rows[0]) {
        return {
          beian_hao,
          product_name: rows[0].product_name,
          short_name: null,
          strategy_l1: null,
          strategy_l2: null,
          strategy_l3: null,
          manager: "",
          inception_date: null,
          benchmark: null,
          ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null,
          sharpe_1y: null, calmar_1y: null,
        }
      }
    } catch { /* table may not exist */ }
  }
  return undefined
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
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

    const phase = new URL(req.url).searchParams.get("phase")

    // Instant paint path: serve name / latest NAV / period returns from list caches.
    if (phase === "header") {
      const cached = await lookupListCacheFundHeader(rawId)
      if (cached) {
        const payload = buildDetailHeaderFromListCache(rawId, cached)
        const teamBenchmark = await loadTeamBenchmark(
          [payload.info.beian_hao, rawId].filter(Boolean),
        ).catch(() => null)
        return NextResponse.json({
          ...payload,
          info: { ...payload.info, team_benchmark: teamBenchmark },
        })
      }
      return NextResponse.json({ error: "Header cache miss", partial: true }, { status: 404 })
    }

    // Resolve identity + list-cache hint in parallel (cache also feeds the NAV fast path).
    const [beian_hao, listHeaderEarly, teamManualMap] = await Promise.all([
      resolveRouteFundIdFast(rawId),
      lookupListCacheFundHeader(rawId),
      loadManualTeamNavBatch([rawId]),
    ])

    const cacheKey = beian_hao || rawId
    let teamManualPoints = [
      ...manualNavPointsForBeian(teamManualMap, rawId),
      ...manualNavPointsForBeian(teamManualMap, beian_hao),
    ]
    const cachedDetail = getDetailResponseMemoryCache(cacheKey)
    const memoryCoversTeam = cachedDetail != null && detailNavCacheCoversTeamDates(
      {
        nav_series: Array.isArray((cachedDetail as { nav_series?: unknown }).nav_series)
          ? (cachedDetail as { nav_series: Parameters<typeof detailNavCacheCoversTeamDates>[0]["nav_series"] }).nav_series
          : [],
      },
      teamManualPoints.map((point) => point.nav_date),
    )
    if (cachedDetail && memoryCoversTeam) {
      const body = sanitizeDetailBody(cachedDetail as Parameters<typeof sanitizeDetailBody>[0])
      const teamBenchmark = await loadTeamBenchmark([cacheKey, rawId].filter(Boolean)).catch(() => null)
      if (body && typeof body === "object" && "info" in body && body.info && typeof body.info === "object") {
        return NextResponse.json({
          ...body,
          info: { ...body.info, team_benchmark: teamBenchmark ?? (body.info as { team_benchmark?: string | null }).team_benchmark ?? null },
        })
      }
      return NextResponse.json(body)
    }

    const infoRows = await query<InfoRow>(
      `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1, strategy_l2, NULL::text AS strategy_l3, manager,
              inception_date::text AS inception_date, benchmark,
              ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
              sharpe_1y::text, calmar_1y::text
       FROM private_fund_info WHERE beian_hao = $1`,
      [beian_hao],
    )

    const bflRows = infoRows[0]
      ? []
      : await query<InfoRow>(
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
          [beian_hao],
        )

    const trackingRow = (infoRows[0] || bflRows[0])
      ? undefined
      : await loadTrackingInfoFallback(beian_hao)

    let info: InfoRow | null | undefined = infoRows[0] ?? bflRows[0] ?? trackingRow
    let listHeader =
      listHeaderEarly
      ?? (rawId !== beian_hao ? await lookupListCacheFundHeader(beian_hao) : null)

    const managedRouteOverride =
      lookupManagedProductOverride(rawId)
      ?? lookupManagedProductOverride(beian_hao)
    if (managedRouteOverride) {
      const overrideInfo = await lookupFundInfoFallback(managedRouteOverride.beian_hao)
      if (overrideInfo) info = overrideInfo
    } else if (!info) {
      // Exact FOF/list-cache hit wins over email fallbacks that may carry
      // TA-virtual investor names (AVM35A → "荣熙共赢A类").
      const listBeian = listHeader?.beian_hao?.trim()
      if (
        listHeader
        && listBeian
        && listBeian.toUpperCase() === (beian_hao || rawId).toUpperCase()
      ) {
        info = infoFromListCache(beian_hao, listHeader)
      } else {
        info =
          (await lookupFundInfoFallback(beian_hao))
          ?? (rawId !== beian_hao ? await lookupFundInfoFallback(rawId) : null)
      }
    }

    if (!info && listHeader) {
      info = infoFromListCache(beian_hao, listHeader)
    }
    if (!info) {
      const ownerUserId = String(req.headers.get("x-market-user-id") || "").trim() || undefined
      const customDetail = tryGetCustomFundPrivateDetail(rawId, ownerUserId)
        ?? (rawId !== beian_hao ? tryGetCustomFundPrivateDetail(beian_hao, ownerUserId) : null)
      if (customDetail) {
        const teamBenchmark = await loadTeamBenchmark([
          customDetail.info.beian_hao,
          rawId,
          beian_hao,
        ].filter(Boolean)).catch(() => null)
        return NextResponse.json({
          ...customDetail,
          info: {
            ...customDetail.info,
            team_benchmark: teamBenchmark || customDetail.info.benchmark || null,
          },
        })
      }

      // Element-extract / picker may link to a synthesized share-class code (e.g. AJD58B)
      // before the tier row exists. Materialize it from the main product (SAJD58).
      const ensured =
        await ensureShareClassBeianProduct(rawId)
        ?? (rawId !== beian_hao ? await ensureShareClassBeianProduct(beian_hao) : null)
      if (ensured?.beian_hao) {
        const ensuredRows = await query<InfoRow>(
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
           WHERE beian_hao = $1
           LIMIT 1`,
          [ensured.beian_hao],
        ).catch(() => [] as InfoRow[])
        info = ensuredRows[0] ?? {
          beian_hao: ensured.beian_hao,
          product_name: ensured.product_name,
          short_name: ensured.product_name,
          strategy_l1: null,
          strategy_l2: null,
          strategy_l3: null,
          manager: "",
          inception_date: null,
          benchmark: null,
          ret_1w: null,
          ret_1m: null,
          ret_3m: null,
          ret_6m: null,
          ret_1y: null,
          sharpe_1y: null,
          calmar_1y: null,
        }
      }
      if (!info) return NextResponse.json({ error: "Fund not found" }, { status: 404 })
    }

    const routeBeianHao = info.beian_hao || beian_hao
    const productName = info.product_name ?? ""
    let shortName = info.short_name ?? ""
    let strategy_l3: string | null = info.strategy_l3 ?? null

    if (manualNavPointsForBeian(teamManualMap, routeBeianHao).length === 0) {
      const extraManual = await loadManualTeamNavBatch([routeBeianHao])
      teamManualPoints = [
        ...teamManualPoints,
        ...manualNavPointsForBeian(extraManual, routeBeianHao),
      ]
    }

    if (!listHeader) {
      listHeader =
        await lookupListCacheFundHeader(routeBeianHao)
        ?? await lookupListCacheFundHeader(productName)
    }

    const bflNameRows = await query<{ product_name: string; short_name: string | null }>(
      `SELECT product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
      [routeBeianHao],
    ).catch(() => [] as { product_name: string; short_name: string | null }[])
    if (!shortName && bflNameRows[0]?.short_name) {
      shortName = bflNameRows[0].short_name
    }
    const emailNameAliases = [
      bflNameRows[0]?.product_name,
      bflNameRows[0]?.short_name,
      info.product_name,
      info.short_name,
    ]

    const managedOverride =
      lookupManagedProductOverride(routeBeianHao)
      ?? lookupManagedProductOverride(productName)
      ?? lookupManagedProductOverride(rawId)

    // Cheap track row first so AMAC gets proper hints; then NAV + AMAC + strategy in parallel.
    // Share-class codes (VN917B) have no AMAC/BFL row — inherit parent SVN917 like 基金档案.
    const trackKeys = await resolveFundElementsBeianKeys(routeBeianHao, productName)
    // Keep operation_date out of this SELECT — a missing column would blank
    // 成立时间 / 管理人 / 规模 the same way it blanks 基金档案 申赎 fields.
    const bflTrackRows = await loadBasicinfoTrackByBeianKeys<{
      scale: string | null
      manager_names: string | null
      advisor: string | null
      register_code: string | null
      inception_date: string | null
    }>(
      trackKeys,
      `SELECT scale, manager_names, advisor, register_code,
              inception_date::text AS inception_date
       FROM basicinfo_bfl_track`,
    ).catch(() => [] as {
      scale: string | null
      manager_names: string | null
      advisor: string | null
      register_code: string | null
      inception_date: string | null
    }[])
    const bflTrack = bflTrackRows[0]
    const trackAdvisor = bflTrack?.advisor?.trim() || null

    // Prefer persistent detail NAV cache (same series as loadDetailNavSeriesFast).
    // Freshness: tip date must not lag the list-cache tip, and uploaded team NAV
    // dates must already be in the cached series (VW7878-style platform stubs).
    const pgCached = await getDetailNavCache(routeBeianHao, productName)
    const pgCacheHit =
      pgCached != null
      && isDetailNavCacheFresh(pgCached, listHeader)
      && detailNavCacheCoversTeamDates(
        pgCached,
        teamManualPoints.map((point) => point.nav_date),
      )

    const [strategyL3Rows, type6StrategyRows, navSeriesRaw, amacResolved, teamBenchmark, operationDateRows] = await Promise.all([
      strategy_l3
        ? Promise.resolve([] as { l3: string | null }[])
        : query<{ l3: string | null }>(
            `SELECT strategy_three::text AS l3 FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
            [routeBeianHao],
          ).catch(() => [] as { l3: string | null }[]),
      // type6 holds both company (团队) and platform (平台) strategies.
      // Detail tags / 编辑要素 → 团队策略 must prefer company whenever present.
      query<{
        company_strategy_one: string | null
        company_strategy_two: string | null
        company_strategy_three: string | null
        platform_strategy_one: string | null
        platform_strategy_two: string | null
        platform_strategy_three: string | null
      }>(
        `SELECT NULLIF(BTRIM(company_strategy_one), '')    AS company_strategy_one,
                NULLIF(BTRIM(company_strategy_two), '')    AS company_strategy_two,
                NULLIF(BTRIM(company_strategy_three), '')  AS company_strategy_three,
                NULLIF(BTRIM(platform_strategy_one), '')   AS platform_strategy_one,
                NULLIF(BTRIM(platform_strategy_two), '')   AS platform_strategy_two,
                NULLIF(BTRIM(platform_strategy_three), '') AS platform_strategy_three
         FROM type6_ops_team_full
         WHERE register_number = $1
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [routeBeianHao],
      ).catch(() => [] as {
        company_strategy_one: string | null
        company_strategy_two: string | null
        company_strategy_three: string | null
        platform_strategy_one: string | null
        platform_strategy_two: string | null
        platform_strategy_three: string | null
      }[]),
      pgCacheHit && pgCached
        ? Promise.resolve(pgCached.nav_series)
        : loadDetailNavSeriesFast({
            beian_hao: routeBeianHao,
            product_name: productName,
            short_name: shortName,
            rawId,
            emailNameAliases,
            listHeader,
          }),
      lookupAmacFundMetadata(routeBeianHao, {
        managerHint: trackAdvisor || info.manager?.trim() || null,
        registerCode: bflTrack?.register_code ?? null,
      }),
      loadTeamBenchmark([routeBeianHao, beian_hao, rawId].filter(Boolean)).catch(() => null),
      loadBasicinfoTrackByBeianKeys<{ operation_date: string | null }>(
        trackKeys,
        `SELECT operation_date::text AS operation_date
         FROM basicinfo_bfl_track`,
      ).catch(() => [] as { operation_date: string | null }[]),
    ])
    const nav_series = sanitizeDetailNavSeries(navSeriesRaw)

    if (navSeriesRaw.length > 0) {
      if (!pgCacheHit) {
        // Write-through so the next open is instant (same merge result).
        // Also advances FOF / 跟踪产品 list tips to match this page.
        void persistDetailNavSeries({
          beian_hao: routeBeianHao,
          product_name: productName,
          short_name: shortName || null,
          nav_series: navSeriesRaw,
        })
      } else {
        // Detail cache hit — still write-through list tips. FOF/managed
        // listHeader may already match while 跟踪产品 tip still lags.
        void syncListTipsFromDetailSeries({
          beian_hao: routeBeianHao,
          product_name: productName,
          nav_series: navSeriesRaw,
        })
      }
    }

    const type6Strategy = type6StrategyRows[0]
    if (type6Strategy) {
      const preferred = preferTeamStrategy(
        {
          l1: type6Strategy.company_strategy_one,
          l2: type6Strategy.company_strategy_two,
          l3: type6Strategy.company_strategy_three,
        },
        {
          // Prefer type6 platform over BFL strategy_* when team data is empty.
          l1: type6Strategy.platform_strategy_one ?? info.strategy_l1,
          l2: type6Strategy.platform_strategy_two ?? info.strategy_l2,
          l3: type6Strategy.platform_strategy_three ?? strategy_l3 ?? info.strategy_l3,
        },
      )
      info = {
        ...info,
        strategy_l1: preferred.l1,
        strategy_l2: preferred.l2,
        strategy_l3: preferred.l3,
      }
      strategy_l3 = preferred.l3
    } else if (!strategy_l3) {
      strategy_l3 = strategyL3Rows[0]?.l3 ?? null
    }

    const scale = bflTrack?.scale?.trim() || amacResolved?.mgmt_scale || null
    const manager_names = bflTrack?.manager_names?.trim() || null
    const trackInception =
      bflTrack?.inception_date?.slice(0, 10) ??
      amacResolved?.establish_date ??
      null
    const trackOperationDate = operationDateRows[0]?.operation_date?.slice(0, 10) ?? null

    const hasSeed = loadManagedProductNavSeed(routeBeianHao).length > 0
    const nav_data_source: "team" | "platform" =
      managedOverride || hasSeed || teamManualPoints.length > 0 ? "team" : "platform"

    const first = nav_series[0]
    const latest = nav_series[nav_series.length - 1]

    const latestReinvestedNav = latest ? parseFloat(latest.cumulative_nav) : null
    const firstReinvestedNav = first ? parseFloat(first.cumulative_nav) : null
    const ret_since_inception =
      latestReinvestedNav !== null && firstReinvestedNav !== null && firstReinvestedNav > 0
        ? latestReinvestedNav / firstReinvestedNav - 1
        : null

    const inceptionDate = first ? new Date(first.price_date) : null
    const latestDate = latest ? new Date(latest.price_date) : null
    const days =
      inceptionDate && latestDate
        ? (latestDate.getTime() - inceptionDate.getTime()) / 86_400_000
        : null

    const ann_ret =
      ret_since_inception !== null && days && days >= MIN_DAYS_FOR_ANNUALIZATION
        ? Math.pow(1 + ret_since_inception, 365 / days) - 1
        : null

    const yearPrefix = latest ? latest.price_date.slice(0, 4) + "-01-01" : null
    const ytdBase = yearPrefix
      ? [...nav_series].reverse().find((r) => r.price_date < yearPrefix)
        ?? nav_series.find((r) => r.price_date >= yearPrefix)
        ?? null
      : null
    const ytd_ret =
      ytdBase && latest
        ? parseFloat(latest.cumulative_nav) / parseFloat(ytdBase.cumulative_nav) - 1
        : null

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

    let sharpe_since_inception: string | null = null
    if (ann_ret !== null && dailyReturns.length > 1 && days && days >= MIN_DAYS_FOR_ANNUALIZATION) {
      const totalYears = days / 365
      const recordsPerYear = dailyReturns.length / totalYears
      const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
      const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length
      const annVol = Math.sqrt(variance) * Math.sqrt(recordsPerYear)
      if (annVol > 0) sharpe_since_inception = (ann_ret / annVol).toFixed(2)
    }

    const body = {
      partial: false,
      info: {
        ...info,
        strategy_l3,
        scale,
        manager_names,
        inception_date:
          info.inception_date?.slice(0, 10) ??
          trackInception ??
          amacResolved?.establish_date ??
          null,
        operation_date: trackOperationDate,
        team_benchmark: teamBenchmark,
        manager:
          preferOfficialManagerName(
            info.manager?.trim() || trackAdvisor,
            amacResolved?.manager_name,
          ) || info.manager,
        manager_registration_no: amacResolved?.registration_no ?? null,
        ret_1w: info.ret_1w ?? pctFromCache(listHeader?.ret_1w) ?? null,
        ret_1m: info.ret_1m ?? pctFromCache(listHeader?.ret_1m) ?? null,
        ret_3m: info.ret_3m ?? pctFromCache(listHeader?.ret_3m) ?? null,
        ret_6m: info.ret_6m ?? pctFromCache(listHeader?.ret_6m) ?? null,
        ret_1y: info.ret_1y ?? pctFromCache(listHeader?.ret_1y) ?? null,
        sharpe_1y: info.sharpe_1y ?? listHeader?.sharpe_1y ?? null,
        calmar_1y: info.calmar_1y ?? listHeader?.calmar_1y ?? null,
      },
      nav_series,
      nav_data_source,
      metrics: {
        latest_nav: latest?.nav ?? null,
        latest_nav_date: latest?.price_date ?? null,
        latest_cum_nav: latest?.cum_nav_withdrawal ?? null,
        latest_cum_nav_reinvested: latest?.cumulative_nav ?? null,
        ret_since_inception: ret_since_inception !== null ? (ret_since_inception * 100).toFixed(2) : null,
        ann_ret: ann_ret !== null ? (ann_ret * 100).toFixed(2) : null,
        ytd_ret: ytd_ret !== null ? (ytd_ret * 100).toFixed(2) : null,
        max_drawdown: maxDrawdown > 0 ? (maxDrawdown * 100).toFixed(2) : null,
        sharpe_since_inception,
      },
    }

    const safeBody = sanitizeDetailBody(body)
    rememberDetailResponseMemoryCache(cacheKey, safeBody)
    if (routeBeianHao !== cacheKey) {
      rememberDetailResponseMemoryCache(routeBeianHao, safeBody)
    }

    return NextResponse.json(safeBody)
  } catch (err) {
    console.error("[private-funds/detail]", err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "Failed to load fund detail", detail: message }, { status: 500 })
  }
}
