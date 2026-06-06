import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name:         "i.product_name",
  latest_nav:           "COALESCE(ng.nav, ng_name.nav, ng_short.nav, nh.nav, nh_name.nav, nh_short.nav, nf.nav, nf_name.nav, nf_short.nav)::numeric",
  latest_nav_date:      "COALESCE(ng.price_date, ng_name.price_date, ng_short.price_date, nh.price_date, nh_name.price_date, nh_short.price_date, nf.price_date, nf_name.price_date, nf_short.price_date)",
  latest_price_change:  "COALESCE(ng.price_change, ng_name.price_change, ng_short.price_change, nh.price_change, nh_name.price_change, nh_short.price_change, nf.price_change, nf_name.price_change, nf_short.price_change)::numeric",
  ret_1w:               "ret_1w",
  ret_1m:               "ret_1m",
  ret_3m:               "ret_3m",
  ret_6m:               "ret_6m",
  ret_1y:               "ret_1y",
}

function navScalarExpr(days: number, cutoffExpr = "CURRENT_DATE"): string {
  return `COALESCE(
    (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = i.beian_hao AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = i.product_name AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE i.short_name IS NOT NULL AND ngs.product_name = i.short_name AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nhc.nav::numeric FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = i.beian_hao AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1),
    (SELECT nhn.nav::numeric FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = i.product_name AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1),
    (SELECT nhs.nav::numeric FROM private_fund_nav_group_hy nhs
     WHERE i.short_name IS NOT NULL AND nhs.product_name = i.short_name AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1),
    (SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = i.beian_hao AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = i.product_name AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.nav::numeric FROM private_fund_nav nfs
     WHERE i.short_name IS NOT NULL AND nfs.product_name = i.short_name AND nfs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)
  )`
}

// Build a LATERAL subquery that gets the closest NAV on or before a given offset
function navAtOffset(alias: string, days: number, cutoffExpr = "CURRENT_DATE"): string {
  return `LEFT JOIN LATERAL (
    SELECT ${navScalarExpr(days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

interface NavSeriesPoint {
  price_date: string
  level: string | null
}

interface OneYearRatios {
  sharpe_1y: string | null
  calmar_1y: string | null
}

interface TrackRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  manager: string | null
  inception_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

type StrategySource = "company" | "platform"

function normalizeStrategySource(raw: string | null): StrategySource {
  return raw === "platform" ? "platform" : "company"
}

const ORG_SIZE_SCALE: Record<string, string> = {
  "100亿以上": "100亿元以上",
  "50-100亿": "50-100亿元",
  "20-50亿": "20-50亿元",
  "10-20亿": "10-20亿元",
  "5-10亿": "5-10亿元",
  "0-5亿": "0-5亿元",
}

function rawStrategyJsonExpr(alias: string): string {
  const rawText = `LTRIM(COALESCE(${alias}.raw_strategy, ''))`
  return `
    CASE
      WHEN LEFT(${rawText}, 2) = '{"' THEN ${rawText}::jsonb
      WHEN LEFT(${rawText}, 2) = '{' || CHR(39) THEN REPLACE(${rawText}, CHR(39), CHR(34))::jsonb
      ELSE '{}'::jsonb
    END
  `.trim()
}

function std(values: number[]): number {
  if (values.length <= 1) return NaN
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const arr = [...values].sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid]
}

function calcOneYearRatios(points: NavSeriesPoint[]): OneYearRatios {
  if (points.length < 3) return { sharpe_1y: null, calmar_1y: null }

  const byDate = new Map<string, { ts: number; level: number }>()
  for (const p of points) {
    const ts = new Date(p.price_date).getTime()
    const level = p.level ? parseFloat(p.level) : NaN
    if (!Number.isFinite(ts) || !Number.isFinite(level) || level <= 0) continue
    byDate.set(p.price_date, { ts, level })
  }

  const series = Array.from(byDate.values()).sort((a, b) => a.ts - b.ts)
  if (series.length < 3) return { sharpe_1y: null, calmar_1y: null }

  const first = series[0]
  const last = series[series.length - 1]
  const days = (last.ts - first.ts) / 86_400_000
  if (!Number.isFinite(days) || days <= 0) return { sharpe_1y: null, calmar_1y: null }

  const periodRet = last.level / first.level - 1
  if (!Number.isFinite(periodRet) || periodRet <= -1) return { sharpe_1y: null, calmar_1y: null }
  const annRet = Math.pow(1 + periodRet, 365 / days) - 1

  const periodicRets: number[] = []
  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]
    const curr = series[i]
    if (prev.level > 0) periodicRets.push(curr.level / prev.level - 1)
    const gap = (curr.ts - prev.ts) / 86_400_000
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }

  const medGap = median(gaps)
  const periodsPerYear = !Number.isFinite(medGap)
    ? 52
    : medGap <= 2
      ? 252
      : medGap <= 10
        ? 52
        : medGap <= 20
          ? 26
          : medGap <= 45
            ? 12
            : 4

  const vol = periodicRets.length > 1 ? std(periodicRets) * Math.sqrt(periodsPerYear) : NaN

  let peak = series[0].level
  let maxDrawdown = 0
  for (const p of series) {
    if (p.level > peak) peak = p.level
    const dd = peak > 0 ? (peak - p.level) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const sharpe = Number.isFinite(vol) && vol > 0 ? annRet / vol : NaN
  const calmar = maxDrawdown > 0 ? annRet / maxDrawdown : NaN

  return {
    sharpe_1y: Number.isFinite(sharpe) ? sharpe.toFixed(2) : null,
    calmar_1y: Number.isFinite(calmar) ? calmar.toFixed(2) : null,
  }
}

async function loadOneYearSeries(beianHao: string, productName: string, shortName: string | null): Promise<NavSeriesPoint[]> {
  const rows = await query<NavSeriesPoint>(
    `WITH candidates AS (
       SELECT 1 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav_group
       WHERE beian_hao = $1

       UNION ALL

       SELECT 2 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav_group
       WHERE $2 <> '' AND product_name = $2

       UNION ALL

       SELECT 3 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav_group
       WHERE $3 <> '' AND product_name = $3

       UNION ALL

      SELECT 4 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
      FROM private_fund_nav_group_hy
      WHERE beian_hao = $1

      UNION ALL

      SELECT 5 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
      FROM private_fund_nav_group_hy
      WHERE $2 <> '' AND product_name = $2

      UNION ALL

      SELECT 6 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
      FROM private_fund_nav_group_hy
      WHERE $3 <> '' AND product_name = $3

      UNION ALL

      SELECT 7 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav
       WHERE beian_hao = $1

       UNION ALL

      SELECT 8 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav
       WHERE $2 <> '' AND product_name = $2

       UNION ALL

      SELECT 9 AS pri, price_date, COALESCE(cumulative_nav, nav)::numeric AS level
       FROM private_fund_nav
       WHERE $3 <> '' AND product_name = $3
     ),
     best AS (
       SELECT MIN(pri) AS pri FROM candidates
     )
     SELECT c.price_date::text AS price_date, c.level::text AS level
     FROM candidates c
     JOIN best b ON c.pri = b.pri
     WHERE c.price_date >= CURRENT_DATE - INTERVAL '370 days'
     ORDER BY c.price_date ASC`,
    [beianHao, productName ?? "", shortName ?? ""]
  )
  return rows
}

async function addOneYearRiskMetrics(rows: TrackRow[]): Promise<TrackRow[]> {
  if (rows.length === 0) return rows
  const batchSize = 8
  const out: TrackRow[] = []

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const enriched = await Promise.all(
      batch.map(async (row) => {
        const series = await loadOneYearSeries(row.beian_hao, row.product_name, row.short_name)
        const ratios = calcOneYearRatios(series)
        return { ...row, ...ratios }
      })
    )
    out.push(...enriched)
  }

  return out
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const requestedPool = searchParams.get("pool")
  const isCustomPool = requestedPool ? (requestedPool.startsWith("custom_") || requestedPool.startsWith("mine_custom_") || requestedPool === "mine_default") : false
  const KNOWN_POOLS = new Set(["bfl", "tracking", "selected", "core", "hy", "fof", "all"])
  if (requestedPool && !KNOWN_POOLS.has(requestedPool) && !isCustomPool) {
    return NextResponse.json({ page, pageSize: 50, total: 0, totalPages: 0, data: [] })
  }
  const pool = requestedPool === "tracking" || requestedPool === "selected" || requestedPool === "core" || requestedPool === "hy" || requestedPool === "fof" || requestedPool === "all" || isCustomPool ? requestedPool : "bfl"
  const isExport = searchParams.get("export") === "1"
  const pageSize = isExport ? 100000 : 50
  const offset   = isExport ? 0 : (page - 1) * pageSize
  const sortKey  = searchParams.get("sort") || "product_name"
  const sortDir  = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
  const keyword    = (searchParams.get("keyword") || "").trim()
  const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
  const strategyL2 = (searchParams.get("strategy_l2") || "").trim()
  const strategyL3 = (searchParams.get("strategy_l3") || "").trim()
  const orgSize = (searchParams.get("org_size") || "").trim()
  const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
  const teamTags = searchParams.getAll("team_tag").map((s) => s.trim()).filter(Boolean)
  const strategySource = normalizeStrategySource((searchParams.get("strategy_source") || "").trim().toLowerCase())
  const cutoffRaw = (searchParams.get("cutoff") || "").trim()
  const cutoffExpr = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw) ? `'${cutoffRaw}'::date` : "CURRENT_DATE"
  const orderCol = ALLOWED_SORT[sortKey] ?? "i.product_name"

  const sourceJsonExpr = rawStrategyJsonExpr("i")
  const strategyPrefix = strategySource === "platform" ? "platform" : "company"
  const isExternalPool = pool === "tracking" || pool === "selected" || pool === "core" || pool === "hy" || pool === "fof" || isCustomPool
  const sourceTable = pool === "selected" ? "selected_pool" : pool === "core" ? "core_pool" : pool === "hy" ? "hy_tracking_pool" : pool === "fof" ? "fof_mom_tracking" : isCustomPool ? "user_custom_pool" : "tracking_pool"
  const strategyL1Expr = pool === "all"
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_one, (${sourceJsonExpr}->'${strategySource}'->>'strategy_one'), '')), '')`
    : isExternalPool
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_one, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_one'), '')), '')`
  const strategyL2Expr = pool === "all"
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_two, (${sourceJsonExpr}->'${strategySource}'->>'strategy_two'), '')), '')`
    : isExternalPool
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_two, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_two'), '')), '')`
  const strategyL3Expr = pool === "all"
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_three, (${sourceJsonExpr}->'${strategySource}'->>'strategy_three'), '')), '')`
    : isExternalPool
    ? `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_three, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_three'), '')), '')`

  const sourceCte = pool === "all"
    ? `WITH all_funds AS (
        SELECT beian_hao, product_name, 1 AS priority FROM private_fund_info_bfl WHERE beian_hao IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 2 AS priority FROM tracking_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 3 AS priority FROM selected_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 4 AS priority FROM core_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 5 AS priority FROM hy_tracking_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 6 AS priority FROM fof_mom_tracking WHERE register_number IS NOT NULL
      ),
      deduped AS (
        SELECT DISTINCT ON (beian_hao) beian_hao, product_name
        FROM all_funds
        ORDER BY beian_hao, priority ASC
      ),
      source AS (
        SELECT
          d.beian_hao,
          d.product_name,
          COALESCE(o.fund_short_name, bfl.short_name) AS short_name,
          bfl.raw_strategy,
          COALESCE(tag_data.strategy_company, bfl.strategy_company) AS strategy_company,
          o.company_strategy_one,
          o.company_strategy_two,
          o.company_strategy_three,
          o.platform_strategy_one,
          o.platform_strategy_two,
          o.platform_strategy_three
        FROM deduped d
        LEFT JOIN LATERAL (
          SELECT * FROM type6_ops_team_full o
          WHERE o.register_number = d.beian_hao
          ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
          LIMIT 1
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT short_name, raw_strategy, strategy_company
          FROM private_fund_info_bfl
          WHERE beian_hao = d.beian_hao
          LIMIT 1
        ) bfl ON true
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN jsonb_typeof(o.tag->'company') = 'array' THEN (
              SELECT string_agg(BTRIM(tag_value), ',')
              FROM jsonb_array_elements_text(o.tag->'company') AS tag_values(tag_value)
              WHERE BTRIM(tag_value) <> ''
            )
            ELSE NULL
          END AS strategy_company
        ) tag_data
      )`
    : isExternalPool
    ? `WITH source AS (
        SELECT
          p.register_number AS beian_hao,
          p.product_name,
          COALESCE(o.fund_short_name, b.fund_short_name) AS short_name,
          NULL::text AS raw_strategy,
          tag_data.strategy_company,
          o.company_strategy_one,
          o.company_strategy_two,
          o.company_strategy_three,
          o.platform_strategy_one,
          o.platform_strategy_two,
          o.platform_strategy_three
        FROM ${sourceTable} p
        LEFT JOIN LATERAL (
          SELECT * FROM type6_ops_team_full o
          WHERE o.register_number = p.register_number
          ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
          LIMIT 1
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT * FROM basicinfo_bfl_track b
          WHERE b.register_number = p.register_number OR b.record_key = p.register_number
          ORDER BY b.updated_at DESC NULLS LAST, b.id DESC
          LIMIT 1
        ) b ON true
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN jsonb_typeof(o.tag->'company') = 'array' THEN (
              SELECT string_agg(BTRIM(tag_value), ',')
              FROM jsonb_array_elements_text(o.tag->'company') AS tag_values(tag_value)
              WHERE BTRIM(tag_value) <> ''
            )
            ELSE NULL
          END AS strategy_company
        ) tag_data
        WHERE p.register_number IS NOT NULL
          ${isCustomPool ? "AND p.pool_key = $1" : ""}
      )`
    : `WITH source AS (
        SELECT
          beian_hao,
          product_name,
          short_name,
          raw_strategy,
          strategy_company,
          NULL::text AS company_strategy_one,
          NULL::text AS company_strategy_two,
          NULL::text AS company_strategy_three,
          NULL::text AS platform_strategy_one,
          NULL::text AS platform_strategy_two,
          NULL::text AS platform_strategy_three
        FROM private_fund_info_bfl
      )`

  // For custom pools, pool_key is always the first param ($1)
  const filterParams: (string | number)[] = isCustomPool && requestedPool ? [requestedPool] : []
  const where: string[] = []

  if (strategyL1) {
    filterParams.push(strategyL1)
    where.push(`${strategyL1Expr} = $${filterParams.length}`)
  }
  if (strategyL2) {
    filterParams.push(strategyL2)
    where.push(`${strategyL2Expr} = $${filterParams.length}`)
  }
  if (strategyL3) {
    filterParams.push(`%${strategyL3}%`)
    where.push(`COALESCE(${strategyL3Expr}, '') ILIKE $${filterParams.length}`)
  }
  if (keyword) {
    filterParams.push(`%${keyword}%`)
    where.push(`(i.product_name ILIKE $${filterParams.length} OR i.beian_hao ILIKE $${filterParams.length})`)
  }
  if (teamTags.length > 0) {
    const clauses = teamTags.map((tag) => {
      filterParams.push(tag)
      return `POSITION(',' || $${filterParams.length} || ',' IN ',' || regexp_replace(COALESCE(i.strategy_company, ''), '\\s+', '', 'g') || ',') > 0`
    })
    where.push(teamTagMode === "or" ? `(${clauses.join(" OR ")})` : clauses.join(" AND "))
  }
  const scaleValue = ORG_SIZE_SCALE[orgSize]
  if (scaleValue) {
    filterParams.push(scaleValue)
    where.push(`EXISTS (
      SELECT 1 FROM basicinfo_bfl_track b
      WHERE b.scale = $${filterParams.length}
        AND (b.record_key = i.beian_hao OR b.register_number = i.beian_hao)
    )`)
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const pLimit  = filterParams.length + 1
  const pOffset = filterParams.length + 2

  const orderSql = `${orderCol} ${sortDir} NULLS LAST`

  // Latest NAV (with group→regular fallback)
  const latestNavJoin = `
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE beian_hao = i.beian_hao AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) ng ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE product_name = i.product_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) ng_name ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group
      WHERE i.short_name IS NOT NULL AND product_name = i.short_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) ng_short ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group_hy
      WHERE beian_hao = i.beian_hao AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nh ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group_hy
      WHERE product_name = i.product_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nh_name ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group_hy
      WHERE i.short_name IS NOT NULL AND product_name = i.short_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nh_short ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE beian_hao = i.beian_hao AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nf ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE product_name = i.product_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nf_name ON true
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav
      WHERE i.short_name IS NOT NULL AND product_name = i.short_name AND price_date <= ${cutoffExpr}
      ORDER BY price_date DESC LIMIT 1
    ) nf_short ON true
  `

  const currentNavExpr = "COALESCE(ng.nav, ng_name.nav, ng_short.nav, nh.nav, nh_name.nav, nh_short.nav, nf.nav, nf_name.nav, nf_short.nav)"
  const currentDateExpr = "COALESCE(ng.price_date, ng_name.price_date, ng_short.price_date, nh.price_date, nh_name.price_date, nh_short.price_date, nf.price_date, nf_name.price_date, nf_short.price_date)"
  const currentPctExpr = "COALESCE(ng.price_change, ng_name.price_change, ng_short.price_change, nh.price_change, nh_name.price_change, nh_short.price_change, nf.price_change, nf_name.price_change, nf_short.price_change)"

  // Historical NAV at each window for period-return calculation
  const histJoins = [
    navAtOffset("h1w",  7,   cutoffExpr),
    navAtOffset("h1m",  30,  cutoffExpr),
    navAtOffset("h3m",  90,  cutoffExpr),
    navAtOffset("h6m",  180, cutoffExpr),
    navAtOffset("h1y",  365, cutoffExpr),
  ].join("\n")

  try {
    const [rows, countRow] = await Promise.all([
      query<TrackRow>(
        `${sourceCte}
         SELECT
           i.beian_hao,
           i.product_name,
           i.short_name,
            ${strategyL1Expr}                             AS strategy_l1,
            ${strategyL2Expr}                             AS strategy_l2,
           NULL::text                                    AS manager,
           NULL::text                                    AS inception_date,
           ${currentNavExpr}::text                         AS latest_nav,
           ${currentDateExpr}::text                        AS latest_nav_date,
           ${currentPctExpr}::text                         AS latest_price_change,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
             THEN (((${currentNavExpr}) / h1w.nav) - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
             THEN (((${currentNavExpr}) / h1m.nav) - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
             THEN (((${currentNavExpr}) / h3m.nav) - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
             THEN (((${currentNavExpr}) / h6m.nav) - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
             THEN (((${currentNavExpr}) / h1y.nav) - 1)::text END AS ret_1y,
           NULL::text AS sharpe_1y,
           NULL::text AS calmar_1y
         FROM source i
         ${latestNavJoin}
         ${histJoins}
         ${whereClause}
         ORDER BY ${orderSql}
         LIMIT $${pLimit} OFFSET $${pOffset}`,
        [...filterParams, pageSize, offset]
      ),
      query<{ total: string }>(
        `${sourceCte}
         SELECT COUNT(*) AS total FROM source i ${whereClause}`,
        filterParams
      ),
    ])

    let data = await addOneYearRiskMetrics(rows)

    if (sortKey === "sharpe_1y" || sortKey === "calmar_1y") {
      const asc = sortDir === "ASC"
      data = [...data].sort((a, b) => {
        const av = a[sortKey] != null ? parseFloat(a[sortKey] as string) : null
        const bv = b[sortKey] != null ? parseFloat(b[sortKey] as string) : null
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return asc ? av - bv : bv - av
      })
    }

    const total = parseInt(countRow[0]?.total ?? "0")
    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
