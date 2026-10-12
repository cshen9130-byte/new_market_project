/**
 * Platform data list: every private fund in private_fund_info, paged in SQL,
 * then filled with the same platform NAV / team NAV / valuation columns as team data.
 */

import { query } from "@/lib/db"
import { appendStrategyLevelFilter } from "@/lib/ma/strategy-unconfigured"
import { sqlPreferAmacOfficialName } from "@/lib/server/fund-name-match"
import {
  sqlStrategySourceExprs,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"
import {
  attachNavAnomalyDiagnosis,
  enrichPlatformFundPage,
  filterByNavAnomalyCause,
  loadBeianCodesWithOperationDate,
  operationDateByFundId,
  type PlatformFundSeed,
  type TeamDataElementsFilter,
  type TeamDataListRow,
  type TeamDataNavAnomalyCauseFilter,
  type TeamDataNavAnomalyFilter,
  type TeamDataNavGapFilter,
  type TeamDataNavLagFilter,
  type TeamDataOperationDateFilter,
  type TeamDataProductSourceFilter,
} from "@/lib/server/team-data-query-pg"
import type { NavAnomalyHit } from "@/lib/server/nav-anomaly"
import { loadFreshNavSeriesFlags, NAV_SERIES_FLAG_RULE } from "@/lib/server/nav-series-flags-pg"

export type PlatformProductClassFilter = "all" | "private" | "asset" | "trust" | "equity"
export type PlatformNavPresenceFilter = "all" | "present" | "absent"
/** Same buckets as the 私募基金 list 净值日期 filter. */
export type PlatformNavDateFilter = "all" | "m1" | "m1_3" | "m3_6" | "within_m6" | "over_m6"

export type PlatformDataListParams = {
  page: number
  pageSize: number
  keyword: string
  strategySource: "company" | "platform"
  strategyL1: string
  strategyL2: string
  strategyL3: string
  elementsFilter: TeamDataElementsFilter
  navLagFilter: TeamDataNavLagFilter
  navGapFilter: TeamDataNavGapFilter
  navAnomalyFilter: TeamDataNavAnomalyFilter
  navAnomalyCauseFilter?: TeamDataNavAnomalyCauseFilter
  productSourceFilter: TeamDataProductSourceFilter
  operationDateFilter?: TeamDataOperationDateFilter
  /** 私募基金 excludes 股权 / 信托 / 资管. Default on the 平台数据 page. */
  productClassFilter?: PlatformProductClassFilter
  /** present = 平台单位净值 is filled (latest_nav is not null). */
  navPresenceFilter?: PlatformNavPresenceFilter
  /** Age of latest_nav_date. */
  navDateFilter?: PlatformNavDateFilter
  sort: string
  sortDir: "ASC" | "DESC"
}

/** Equity / venture names are only a fallback while AMAC fund_type is empty. */
const EQUITY_CLASS_SQL = `(
  COALESCE(BTRIM(a.fund_type), '') IN ('股权投资基金', '创业投资基金')
  OR (
    COALESCE(BTRIM(a.fund_type), '') = ''
    AND (
      i.product_name LIKE '%股权投资%'
      OR i.product_name LIKE '%创业投资%'
      OR i.product_name LIKE '%有限合伙%'
    )
  )
)`

const TRUST_CLASS_SQL = `(
  COALESCE(BTRIM(a.fund_type), '') = '信托计划'
  OR (COALESCE(BTRIM(a.fund_type), '') = '' AND i.product_name LIKE '%信托%')
)`

const ASSET_CLASS_SQL = `(
  COALESCE(BTRIM(a.fund_type), '') IN (
    '证券公司及其子公司的资产管理计划',
    '期货公司及其子公司的资产管理计划',
    '期货公司集合资管产品',
    '保险公司及其子公司的资产管理计划',
    '基金专户',
    '银行理财产品'
  )
  OR (
    COALESCE(BTRIM(a.fund_type), '') = ''
    AND (i.product_name LIKE '%资产管理%' OR i.product_name LIKE '%资管计划%')
  )
)`

const PRODUCT_CLASS_SQL: Record<Exclude<PlatformProductClassFilter, "all">, string> = {
  private: `NOT (${EQUITY_CLASS_SQL} OR ${TRUST_CLASS_SQL} OR ${ASSET_CLASS_SQL})`,
  asset: ASSET_CLASS_SQL,
  trust: TRUST_CLASS_SQL,
  equity: EQUITY_CLASS_SQL,
}

const NAV_DATE_SQL: Record<Exclude<PlatformNavDateFilter, "all">, string> = {
  m1: "i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month'",
  m1_3: "i.latest_nav_date >= CURRENT_DATE - INTERVAL '3 months' AND i.latest_nav_date < CURRENT_DATE - INTERVAL '1 month'",
  m3_6: "i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months' AND i.latest_nav_date < CURRENT_DATE - INTERVAL '3 months'",
  within_m6: "i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'",
  over_m6: "i.latest_nav_date < CURRENT_DATE - INTERVAL '6 months'",
}

/** Same 14-day lag window as team data. */
const NAV_LAG_DAYS = 14

const ELEMENTS_PRESENT_SQL = `EXISTS (
  SELECT 1 FROM basicinfo_bfl_track b
  WHERE (b.register_number = i.beian_hao OR b.record_key = i.beian_hao)
    AND (
      b.mandator_name IS NOT NULL
      OR b.open_day IS NOT NULL
      OR b.fee_manage_rate IS NOT NULL
      OR b.fee_trust IS NOT NULL
      OR b.fee_purchase IS NOT NULL
      OR b.fee_redeem IS NOT NULL
      OR b.closed_period IS NOT NULL
      OR b.precautious_line IS NOT NULL
      OR b.stop_line IS NOT NULL
      OR NULLIF(BTRIM(b.fee_manage), '') IS NOT NULL
      OR NULLIF(BTRIM(b.fee_admin_service), '') IS NOT NULL
      OR NULLIF(BTRIM(b.fee_pay), '') IS NOT NULL
    )
)`

const TEAM_NAV_JOIN = `LEFT JOIN LATERAL (
  SELECT (
    SELECT MAX(d) FROM (
      SELECT MAX(e.nav_date) AS d
      FROM ops_email_nav_records e
      WHERE e.product_code = i.beian_hao
        AND e.nav IS NOT NULL
        AND e.nav_date IS NOT NULL
      UNION ALL
      SELECT MAX(m.nav_date)
      FROM ops_team_nav_manual m
      WHERE m.beian_hao = i.beian_hao
        AND m.nav_type = 'pre_fee'
    ) dates
  ) AS team_nav_date,
  (
    SELECT u.nav FROM (
      SELECT e.nav_date, e.nav
      FROM ops_email_nav_records e
      WHERE e.product_code = i.beian_hao
        AND e.nav IS NOT NULL
        AND e.nav_date IS NOT NULL
      UNION ALL
      SELECT m.nav_date, m.unit_nav AS nav
      FROM ops_team_nav_manual m
      WHERE m.beian_hao = i.beian_hao
        AND m.nav_type = 'pre_fee'
        AND m.unit_nav IS NOT NULL
    ) u
    ORDER BY u.nav_date DESC NULLS LAST
    LIMIT 1
  ) AS team_nav
) team ON true`

const VALUATION_JOIN = `LEFT JOIN LATERAL (
  SELECT MAX(v.valuation_date) AS valuation_date
  FROM ops_email_valuation_records v
  WHERE v.product_code = i.beian_hao
) val ON true`

type SeedRow = {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  first_entry_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function isoDay(raw: string | null | undefined): string | null {
  const day = (raw ?? "").trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function toSeeds(rows: SeedRow[]): PlatformFundSeed[] {
  return rows
    .filter((row) => row.beian_hao?.trim() && row.product_name?.trim())
    .map((row) => ({
      id: row.beian_hao.trim(),
      beian_hao: row.beian_hao.trim(),
      product_name: row.product_name.trim(),
      strategy_l1: row.strategy_l1?.trim() || null,
      strategy_l2: row.strategy_l2?.trim() || null,
      strategy_l3: row.strategy_l3?.trim() || null,
      first_entry_date: isoDay(row.first_entry_date),
    }))
}

/** Series overlay can miss a code that still has private_fund_info.latest_nav. */
function withStoredPlatformNav(rows: TeamDataListRow[], seeds: SeedRow[]): TeamDataListRow[] {
  const byId = new Map<string, { nav: string; date: string | null }>()
  for (const seed of seeds) {
    const nav = seed.latest_nav?.trim()
    const id = seed.beian_hao?.trim()
    if (!id || !nav) continue
    byId.set(id, { nav, date: isoDay(seed.latest_nav_date) })
  }
  return rows.map((row) => {
    if (row.platform_nav) return row
    const stored = byId.get(row.id)
    if (!stored) return row
    return {
      ...row,
      platform_nav: stored.nav,
      platform_nav_date: row.platform_nav_date || stored.date,
    }
  })
}

function resortPage(rows: TeamDataListRow[], sort: string, dir: "ASC" | "DESC"): TeamDataListRow[] {
  const numeric = sort === "platform_nav" || sort === "team_nav"
  const keys = new Set(["platform_nav", "platform_nav_date", "team_nav", "team_nav_date", "valuation_date"])
  if (!keys.has(sort)) return rows
  const mul = dir === "ASC" ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[sort as keyof TeamDataListRow]
    const bv = b[sort as keyof TeamDataListRow]
    if (numeric) {
      const an = av == null || av === "" ? null : parseFloat(String(av))
      const bn = bv == null || bv === "" ? null : parseFloat(String(bv))
      if (an == null && bn == null) return a.product_name.localeCompare(b.product_name, "zh")
      if (an == null || !Number.isFinite(an)) return 1
      if (bn == null || !Number.isFinite(bn)) return -1
      return (an - bn) * mul || a.product_name.localeCompare(b.product_name, "zh")
    }
    const as = av == null ? "" : String(av)
    const bs = bv == null ? "" : String(bv)
    if (!as && !bs) return a.product_name.localeCompare(b.product_name, "zh")
    if (!as) return 1
    if (!bs) return -1
    return as.localeCompare(bs) * mul || a.product_name.localeCompare(b.product_name, "zh")
  })
}

function readStoredAnomaly(value: unknown): NavAnomalyHit | null {
  if (value == null || typeof value !== "object") return null
  const rec = value as NavAnomalyHit
  if (rec.reason !== "jump" && rec.reason !== "spike") return null
  if (!rec.date || !Number.isFinite(rec.ratio)) return null
  return rec
}

type StaleFlagRow = { beian_hao: string; product_name: string; tip: string | null }

/** Recompute flags whose latest NAV date or rule no longer matches. */
async function refreshStaleSeriesFlags(
  amacJoin: string,
  joins: string[],
  whereSql: string,
  filterParams: unknown[],
): Promise<void> {
  await loadFreshNavSeriesFlags([])
  const ruleIdx = filterParams.length + 1
  const stalePredicate = `(
    f.beian_hao IS NULL
    OR f.tip_date IS DISTINCT FROM LEFT(COALESCE(i.latest_nav_date::text, ''), 10)
    OR f.rule_version IS DISTINCT FROM $${ruleIdx}
  )`
  const staleSql = `
    SELECT BTRIM(i.beian_hao) AS beian_hao,
           i.product_name,
           LEFT(COALESCE(i.latest_nav_date::text, ''), 10) AS tip
    FROM private_fund_info i
    ${amacJoin}
    ${joins.join("\n")}
    LEFT JOIN ops_nav_series_flags f ON f.beian_hao = BTRIM(i.beian_hao)
    ${whereSql ? `${whereSql} AND ${stalePredicate}` : `WHERE ${stalePredicate}`}`
  const stale = await query<StaleFlagRow>(staleSql, [...filterParams, NAV_SERIES_FLAG_RULE])
  const dated = await query<StaleFlagRow & { operation_date: string | null }>(`
    SELECT BTRIM(i.beian_hao) AS beian_hao,
           i.product_name,
           LEFT(COALESCE(i.latest_nav_date::text, ''), 10) AS tip,
           f.operation_date
    FROM ops_nav_series_flags f
    JOIN private_fund_info i ON BTRIM(i.beian_hao) = f.beian_hao
    WHERE f.operation_date <> ''
       OR BTRIM(i.beian_hao) IN (
         SELECT BTRIM(beian_hao) FROM ops_fund_operation_dates
         UNION
         SELECT BTRIM(register_number) FROM basicinfo_bfl_track
          WHERE operation_date IS NOT NULL AND NULLIF(BTRIM(register_number), '') IS NOT NULL
         UNION
         SELECT BTRIM(record_key) FROM basicinfo_bfl_track
          WHERE operation_date IS NOT NULL AND NULLIF(BTRIM(record_key), '') IS NOT NULL
       )`)
  if (dated.length > 0) {
    const live = await operationDateByFundId(dated.map((row) => ({
      id: row.beian_hao.trim(),
      beian_hao: row.beian_hao.trim(),
    })))
    const seen = new Set(stale.map((row) => row.beian_hao.trim()))
    for (const row of dated) {
      const id = row.beian_hao.trim()
      if (seen.has(id)) continue
      if ((live.get(id) ?? "") === (row.operation_date ?? "")) continue
      seen.add(id)
      stale.push(row)
    }
  }
  if (stale.length === 0) return
  await loadFreshNavSeriesFlags(stale.flatMap((row) => {
    const beian = row.beian_hao?.trim()
    const name = row.product_name?.trim()
    if (!beian || !name) return []
    return [{
      id: beian,
      beian_hao: beian,
      product_name: name,
      strategy_l1: null,
      strategy_l2: null,
      strategy_l3: null,
      first_entry_date: null,
      tipDate: isoDay(row.tip),
    }]
  }))
}

export async function listPlatformPrivateFunds(params: PlatformDataListParams): Promise<{
  data: TeamDataListRow[]
  total: number
  error?: string
  message?: string
}> {
  const {
    page,
    pageSize,
    keyword,
    strategySource,
    strategyL1,
    strategyL2,
    strategyL3,
    elementsFilter,
    navLagFilter,
    navGapFilter,
    navAnomalyFilter,
    navAnomalyCauseFilter = "all",
    productSourceFilter,
    operationDateFilter = "all",
    productClassFilter = "all",
    navPresenceFilter = "all",
    navDateFilter = "all",
    sort,
    sortDir,
  } = params

  const filterParams: unknown[] = []
  const where: string[] = []
  const sharedJoins: string[] = []
  const rowOnlyJoins: string[] = []
  const nameExpr = sqlPreferAmacOfficialName("i.product_name", "a.fund_name")
  const strategy = sqlStrategySourceExprs(strategySource, "t6", "i")
  const strategyJoin = sqlType6LatestStrategyJoin("i.beian_hao", "t6")
  const hasStrategyFilter = Boolean(strategyL1 || strategyL2 || strategyL3)

  if (hasStrategyFilter) sharedJoins.push(strategyJoin)
  else rowOnlyJoins.push(strategyJoin)

  if (strategyL1) appendStrategyLevelFilter(strategyL1, strategy.l1, where, filterParams)
  if (strategyL2) appendStrategyLevelFilter(strategyL2, strategy.l2, where, filterParams)
  if (strategyL3) appendStrategyLevelFilter(strategyL3, strategy.l3, where, filterParams, "ilike")

  if (keyword) {
    filterParams.push(`%${keyword}%`)
    const idx = filterParams.length
    where.push(`(
      i.product_name ILIKE $${idx}
      OR i.beian_hao ILIKE $${idx}
      OR a.fund_name ILIKE $${idx}
    )`)
  }

  if (elementsFilter === "present") where.push(ELEMENTS_PRESENT_SQL)
  else if (elementsFilter === "missing") where.push(`NOT ${ELEMENTS_PRESENT_SQL}`)

  if (productClassFilter !== "all") where.push(PRODUCT_CLASS_SQL[productClassFilter])
  if (navPresenceFilter === "present") where.push("i.latest_nav IS NOT NULL")
  else if (navPresenceFilter === "absent") where.push("i.latest_nav IS NULL")
  if (navDateFilter !== "all") where.push(NAV_DATE_SQL[navDateFilter])

  const sortNeedsTeam = sort === "team_nav" || sort === "team_nav_date"
  if (navLagFilter === "behind_2w" || navLagFilter === "within_2w" || sortNeedsTeam) {
    if (navLagFilter === "behind_2w" || navLagFilter === "within_2w") sharedJoins.push(TEAM_NAV_JOIN)
    else rowOnlyJoins.push(TEAM_NAV_JOIN)
  }
  if (sort === "valuation_date") rowOnlyJoins.push(VALUATION_JOIN)

  if (navLagFilter === "behind_2w" || navLagFilter === "within_2w") {
    filterParams.push(shanghaiToday())
    const todayIdx = filterParams.length
    if (navLagFilter === "within_2w") {
      where.push(`team.team_nav_date IS NOT NULL AND team.team_nav_date >= $${todayIdx}::date - ${NAV_LAG_DAYS}`)
    } else {
      where.push(`(team.team_nav_date IS NULL OR team.team_nav_date < $${todayIdx}::date - ${NAV_LAG_DAYS})`)
    }
  }

  if (productSourceFilter === "manual") {
    where.push(`EXISTS (
      SELECT 1 FROM ops_team_data_products m
      WHERE UPPER(BTRIM(m.beian_hao)) = UPPER(BTRIM(i.beian_hao))
    )`)
  } else if (productSourceFilter === "email") {
    where.push(`EXISTS (
      SELECT 1 FROM ops_email_nav_records e
      WHERE e.product_code = i.beian_hao
        AND e.nav IS NOT NULL
        AND e.nav_date IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM ops_team_data_products m
      WHERE UPPER(BTRIM(m.beian_hao)) = UPPER(BTRIM(i.beian_hao))
    )`)
  }

  if (operationDateFilter === "present" || operationDateFilter === "absent") {
    const codes = await loadBeianCodesWithOperationDate()
    if (operationDateFilter === "present" && codes.length === 0) {
      return { data: [], total: 0 }
    }
    if (codes.length > 0) {
      filterParams.push(codes)
      const idx = filterParams.length
      where.push(
        operationDateFilter === "present"
          ? `UPPER(BTRIM(i.beian_hao)) = ANY($${idx}::text[])`
          : `NOT (UPPER(BTRIM(i.beian_hao)) = ANY($${idx}::text[]))`,
      )
    }
  }

  const orderExpr: Record<string, string> = {
    product_name: nameExpr,
    beian_hao: "i.beian_hao",
    platform_nav: "i.latest_nav",
    platform_nav_date: "i.latest_nav_date",
    team_nav: "team.team_nav",
    team_nav_date: "team.team_nav_date",
    valuation_date: "val.valuation_date",
    first_entry_date: "COALESCE(a.put_on_record_date, i.inception_date)",
  }
  const orderSql = `${orderExpr[sort] ?? orderExpr.first_entry_date} ${sortDir === "ASC" ? "ASC" : "DESC"} NULLS LAST`
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  const amacJoin = "LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao"
  const selectSql = `
    SELECT
      i.beian_hao,
      ${nameExpr} AS product_name,
      ${strategy.l1} AS strategy_l1,
      ${strategy.l2} AS strategy_l2,
      ${strategy.l3} AS strategy_l3,
      COALESCE(a.put_on_record_date, i.inception_date)::text AS first_entry_date,
      i.latest_nav::text AS latest_nav,
      i.latest_nav_date::text AS latest_nav_date
    FROM private_fund_info i
    ${amacJoin}
    ${sharedJoins.join("\n")}
    ${rowOnlyJoins.join("\n")}
    ${whereSql}
    ORDER BY ${orderSql}`

  const needsSeries = navGapFilter !== "all" || navAnomalyFilter !== "all"
  if (needsSeries) {
    const seriesJoins = [...sharedJoins]
    if (sort === "valuation_date" && !seriesJoins.includes(VALUATION_JOIN)) seriesJoins.push(VALUATION_JOIN)
    if ((sort === "team_nav" || sort === "team_nav_date") && !seriesJoins.includes(TEAM_NAV_JOIN)) {
      seriesJoins.push(TEAM_NAV_JOIN)
    }
    await refreshStaleSeriesFlags(amacJoin, sharedJoins, whereSql, filterParams)

    const flagPreds: string[] = []
    if (navGapFilter === "interior_2w") flagPreds.push("f.has_interior_gap")
    else if (navGapFilter === "no_interior_2w") flagPreds.push("NOT f.has_interior_gap")
    if (navAnomalyFilter === "jump") flagPreds.push("f.anomaly IS NOT NULL")
    else if (navAnomalyFilter === "no_jump") flagPreds.push("f.anomaly IS NULL")
    const flagWhere = [...where, ...flagPreds]
    const flagWhereSql = flagWhere.length > 0 ? `WHERE ${flagWhere.join(" AND ")}` : ""
    const fromSql = `
      FROM private_fund_info i
      ${amacJoin}
      ${seriesJoins.join("\n")}
      JOIN ops_nav_series_flags f ON f.beian_hao = BTRIM(i.beian_hao)
      ${flagWhereSql}`
    const flaggedSql = `
      SELECT
        i.beian_hao,
        i.product_name,
        NULL::text AS strategy_l1,
        NULL::text AS strategy_l2,
        NULL::text AS strategy_l3,
        COALESCE(a.put_on_record_date, i.inception_date)::text AS first_entry_date,
        i.latest_nav::text AS latest_nav,
        i.latest_nav_date::text AS latest_nav_date,
        f.anomaly AS anomaly
      ${fromSql}
      ORDER BY ${orderSql}`

    type FlaggedSeed = SeedRow & { anomaly: unknown }
    let seriesRows: FlaggedSeed[]
    let total: number
    const diagnoseAll = navAnomalyFilter === "jump" && navAnomalyCauseFilter !== "all"
    if (diagnoseAll) {
      seriesRows = await query<FlaggedSeed>(flaggedSql, filterParams)
      total = seriesRows.length
    } else {
      const limitIdx = filterParams.length + 1
      const offsetIdx = filterParams.length + 2
      const [countRows, pageOnly] = await Promise.all([
        query<{ total: string }>(`SELECT COUNT(*)::text AS total ${fromSql}`, filterParams),
        query<FlaggedSeed>(
          `${flaggedSql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...filterParams, pageSize, (page - 1) * pageSize],
        ),
      ])
      total = parseInt(countRows[0]?.total ?? "0", 10) || 0
      seriesRows = pageOnly
    }

    let anomalyById = new Map<string, NavAnomalyHit>()
    for (const row of seriesRows) {
      const id = row.beian_hao?.trim()
      const hit = readStoredAnomaly(row.anomaly)
      if (id && hit) anomalyById.set(id, hit)
    }
    if (diagnoseAll) {
      const filtered = await filterByNavAnomalyCause(
        seriesRows
          .filter((row) => row.beian_hao?.trim() && row.product_name?.trim())
          .map((row) => ({
            id: row.beian_hao.trim(),
            beian_hao: row.beian_hao.trim(),
            product_name: row.product_name.trim(),
          })),
        anomalyById,
        navAnomalyCauseFilter,
      )
      const keep = new Set(filtered.rows.map((row) => row.id))
      seriesRows = seriesRows.filter((row) => keep.has(row.beian_hao.trim()))
      anomalyById = filtered.hits
      total = seriesRows.length
      seriesRows = seriesRows.slice((page - 1) * pageSize, page * pageSize)
    }

    const pageIds = seriesRows.map((row) => row.beian_hao.trim().toUpperCase()).filter(Boolean)
    let hydrated: SeedRow[] = seriesRows
    if (pageIds.length > 0) {
      const marker = `ORDER BY ${orderSql}`
      const extra = `UPPER(BTRIM(i.beian_hao)) = ANY($${filterParams.length + 1}::text[])`
      const pageSql = whereSql
        ? selectSql.replace(marker, `AND ${extra}\n    ${marker}`)
        : selectSql.replace(marker, `WHERE ${extra}\n    ${marker}`)
      const loaded = await query<SeedRow>(pageSql, [...filterParams, pageIds])
      const byId = new Map(loaded.map((row) => [row.beian_hao.trim().toUpperCase(), row]))
      hydrated = seriesRows.map((row) => byId.get(row.beian_hao.trim().toUpperCase()) ?? row)
    }
    let data = resortPage(withStoredPlatformNav(await enrichPlatformFundPage(toSeeds(hydrated)), hydrated), sort, sortDir)
    if (navAnomalyFilter === "jump") {
      data = data.map((row) => ({
        ...row,
        nav_anomaly: anomalyById.get(row.id) ?? null,
      }))
      if (data.some((row) => row.nav_anomaly && !row.nav_anomaly.cause)) {
        data = await attachNavAnomalyDiagnosis(data)
      }
    }
    if (operationDateFilter === "present") data = await withOperationDates(data)
    return { data, total }
  }

  const limitIdx = filterParams.length + 1
  const offsetIdx = filterParams.length + 2
  const [countRows, pageRows] = await Promise.all([
    query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM private_fund_info i
       ${amacJoin}
       ${sharedJoins.join("\n")}
       ${whereSql}`,
      filterParams,
    ),
    query<SeedRow>(
      `${selectSql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...filterParams, pageSize, (page - 1) * pageSize],
    ),
  ])
  const total = parseInt(countRows[0]?.total ?? "0", 10) || 0
  let data = resortPage(withStoredPlatformNav(await enrichPlatformFundPage(toSeeds(pageRows)), pageRows), sort, sortDir)
  if (operationDateFilter === "present") data = await withOperationDates(data)
  return { data, total }
}

async function withOperationDates(rows: TeamDataListRow[]): Promise<TeamDataListRow[]> {
  const dates = await operationDateByFundId(rows)
  return rows.map((row) => ({
    ...row,
    operation_date: dates.get(row.id) ?? null,
  }))
}
