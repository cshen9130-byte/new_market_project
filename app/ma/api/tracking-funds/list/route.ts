import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sanitizeRiskMetricText } from "@/lib/fund-nav-metrics"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  ensureTrackingFundsListCachePopulated,
  shouldUseTrackingFundsListCache,
} from "@/lib/server/tracking-funds-list-cache-pg"
import { enrichTrackFundMetricsRows, overlayTeamNavOnTrackRows } from "@/lib/server/list-cache-nav-batch"
import {
  buildListResponseCacheKey,
  withListResponseCache,
} from "@/lib/server/list-response-cache"
import { EMAIL_OPS_POOL_KEY } from "@/lib/server/email-tracking-pool-sync"
import { resolveVisibleEmailPoolRegistersForUser } from "@/lib/server/direct-email-visibility"
import { getUserById } from "@/lib/server/users"
import { recordInteractiveUserTraffic } from "@/lib/server/user-activity-priority"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface NavJoinConfig {
  latestNavJoin: string
  fallbackNavExpr: string
  fallbackDateExpr: string
  fallbackPctExpr: string
  allowedSort: Record<string, string>
  navScalarExpr: (days: number, cutoffExpr: string) => string
}

const TYPE6_LATEST_JOIN = (cutoffExpr: string) => `
    LEFT JOIN LATERAL (
      SELECT nav::numeric AS nav, price_date, price_change::numeric AS price_change
      FROM private_fund_nav_group_type6 n
      WHERE n.price_date <= ${cutoffExpr}
        AND (
          n.beian_hao = i.beian_hao
          OR n.product_name = i.product_name
          OR (i.short_name IS NOT NULL AND n.product_name = i.short_name)
        )
      ORDER BY
        CASE
          WHEN n.beian_hao = i.beian_hao THEN 0
          WHEN n.product_name = i.product_name THEN 1
          ELSE 2
        END,
        n.price_date DESC
      LIMIT 1
    ) nt6 ON true`

const LEGACY_LATEST_JOIN = (cutoffExpr: string) => `
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
    ) nf_short ON true`

function type6ScalarExpr(days: number, cutoffExpr: string): string {
  return `(SELECT n.nav::numeric
    FROM private_fund_nav_group_type6 n
    WHERE n.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
      AND (
        n.beian_hao = i.beian_hao
        OR n.product_name = i.product_name
        OR (i.short_name IS NOT NULL AND n.product_name = i.short_name)
      )
    ORDER BY
      CASE
        WHEN n.beian_hao = i.beian_hao THEN 0
        WHEN n.product_name = i.product_name THEN 1
        ELSE 2
      END,
      n.price_date DESC
    LIMIT 1)`
}

function type6ScalarParts(days: number, cutoffExpr: string): string[] {
  return [type6ScalarExpr(days, cutoffExpr)]
}

function legacyScalarParts(days: number, cutoffExpr: string): string[] {
  return [
    `(SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = i.beian_hao AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1)`,
    `(SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = i.product_name AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1)`,
    `(SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE i.short_name IS NOT NULL AND ngs.product_name = i.short_name AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1)`,
    `(SELECT nhc.nav::numeric FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = i.beian_hao AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1)`,
    `(SELECT nhn.nav::numeric FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = i.product_name AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1)`,
    `(SELECT nhs.nav::numeric FROM private_fund_nav_group_hy nhs
     WHERE i.short_name IS NOT NULL AND nhs.product_name = i.short_name AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1)`,
    `(SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = i.beian_hao AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1)`,
    `(SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = i.product_name AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1)`,
    `(SELECT nfs.nav::numeric FROM private_fund_nav nfs
     WHERE i.short_name IS NOT NULL AND nfs.product_name = i.short_name AND nfs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)`,
  ]
}

function buildNavJoinConfig(pool: string, cutoffExpr: string): NavJoinConfig {
  const useType6Only = pool === "bfl_ops"
  const fallbackNavExpr = useType6Only
    ? "nt6.nav"
    : "COALESCE(ng.nav, ng_name.nav, ng_short.nav, nh.nav, nh_name.nav, nh_short.nav, nf.nav, nf_name.nav, nf_short.nav)"
  const fallbackDateExpr = useType6Only
    ? "nt6.price_date"
    : "COALESCE(ng.price_date, ng_name.price_date, ng_short.price_date, nh.price_date, nh_name.price_date, nh_short.price_date, nf.price_date, nf_name.price_date, nf_short.price_date)"
  const fallbackPctExpr = useType6Only
    ? "nt6.price_change"
    : "COALESCE(ng.price_change, ng_name.price_change, ng_short.price_change, nh.price_change, nh_name.price_change, nh_short.price_change, nf.price_change, nf_name.price_change, nf_short.price_change)"

  return {
    latestNavJoin: useType6Only ? TYPE6_LATEST_JOIN(cutoffExpr) : LEGACY_LATEST_JOIN(cutoffExpr),
    fallbackNavExpr,
    fallbackDateExpr,
    fallbackPctExpr,
    allowedSort: {
      product_name: "i.product_name",
      first_added_at: "i.first_added_at",
      latest_nav: `COALESCE(en.nav, ${fallbackNavExpr})::numeric`,
      latest_nav_date: `COALESCE(en.nav_date, ${fallbackDateExpr})`,
      latest_price_change: `CASE WHEN en.nav IS NOT NULL AND en_prev.nav IS NOT NULL AND en_prev.nav <> 0 THEN (en.nav / en_prev.nav - 1) ELSE ${fallbackPctExpr}::numeric END`,
      ret_1w: "ret_1w",
      ret_1m: "ret_1m",
      ret_3m: "ret_3m",
      ret_6m: "ret_6m",
      ret_1y: "ret_1y",
      sharpe_1y: "pinfo.sharpe_1y",
      calmar_1y: "pinfo.calmar_1y",
    },
    navScalarExpr: (days, cutoff) => {
      const parts = useType6Only
        ? type6ScalarParts(days, cutoff)
        : legacyScalarParts(days, cutoff)
      return `COALESCE(\n    ${parts.join(",\n    ")}\n  )`
    },
  }
}

function navAtOffset(alias: string, days: number, cutoffExpr: string, navScalarExpr: NavJoinConfig["navScalarExpr"]): string {
  return `LEFT JOIN LATERAL (
    SELECT ${navScalarExpr(days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

interface TrackRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  manager: string | null
  inception_date: string | null
  first_added_at: string | null
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

function sanitizeTrackRows(rows: TrackRow[]): TrackRow[] {
  return rows.map((row) => ({
    ...row,
    sharpe_1y: sanitizeRiskMetricText(row.sharpe_1y),
    calmar_1y: sanitizeRiskMetricText(row.calmar_1y),
  }))
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

const SHANGHAI_DATE_EXPR = (col: string) => `(${col} AT TIME ZONE 'Asia/Shanghai')::date`

const BFL_OPS_SOURCE_CTE = `
WITH source AS (
  SELECT DISTINCT ON (o.register_number)
    o.register_number AS beian_hao,
    COALESCE(o.fund_short_name, o.fund_name) AS product_name,
    o.fund_name AS short_name,
    MIN(${SHANGHAI_DATE_EXPR("o.imported_at")}) OVER (PARTITION BY o.register_number) AS first_added_at,
    tag_data.strategy_company,
    o.company_strategy_one,
    o.company_strategy_two,
    o.company_strategy_three,
    o.platform_strategy_one,
    o.platform_strategy_two,
    o.platform_strategy_three
  FROM type6_ops_team_full o
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
  WHERE o.register_number IS NOT NULL
  ORDER BY o.register_number, o.updated_at DESC NULLS LAST, o.id DESC
)`

const BFL_OPS_TYPE6_LATEST_CTES = (cutoffExpr: string) => `
, latest_by_code AS (
  SELECT DISTINCT ON (beian_hao)
    beian_hao, nav::numeric AS nav, price_date, price_change::numeric AS price_change
  FROM private_fund_nav_group_type6
  WHERE price_date <= ${cutoffExpr}
  ORDER BY beian_hao, price_date DESC
),
latest_by_name AS (
  SELECT DISTINCT ON (product_name)
    product_name, nav::numeric AS nav, price_date, price_change::numeric AS price_change
  FROM private_fund_nav_group_type6
  WHERE price_date <= ${cutoffExpr}
  ORDER BY product_name, price_date DESC
)`

function bflOpsNavExpr(): string {
  return "COALESCE(lbc.nav, lbn.nav, lbs.nav)"
}

function bflOpsNavDateExpr(): string {
  return "COALESCE(lbc.price_date, lbn.price_date, lbs.price_date)"
}

function bflOpsNavPctExpr(): string {
  return "COALESCE(lbc.price_change, lbn.price_change, lbs.price_change)"
}

/** Prefer BFL/cache name when the pool stored the 备案号 as product_name. */
function resolvedCachedProductNameExpr(): string {
  return `CASE
    WHEN i.product_name ~ '^[A-Za-z0-9]{4,10}$'
      OR UPPER(BTRIM(i.product_name)) = UPPER(BTRIM(i.beian_hao))
    THEN COALESCE(
      CASE WHEN cache.product_name ~ '[ABC]类' THEN NULLIF(BTRIM(cache.product_name), '') END,
      NULLIF(BTRIM(cache.short_name), ''),
      NULLIF(BTRIM(cache.product_name), ''),
      i.product_name
    )
    ELSE i.product_name
  END`
}

const CACHE_ALLOWED_SORT: Record<string, string> = {
  product_name: resolvedCachedProductNameExpr(),
  first_added_at: "i.first_added_at",
  latest_nav: "cache.unit_nav",
  latest_nav_date: "cache.nav_date",
  latest_price_change: "cache.return_pct",
  ret_1w: "cache.ret_1w",
  ret_1m: "cache.ret_1m",
  ret_3m: "cache.ret_3m",
  ret_6m: "cache.ret_6m",
  ret_1y: "cache.ret_1y",
  sharpe_1y: "cache.sharpe_1y",
  calmar_1y: "cache.calmar_1y",
}

function cachedStrategyExprs(
  pool: string,
  strategySource: StrategySource,
): { l1: string; l2: string; l3: string } {
  const src = strategySource === "platform" ? "platform" : "company"
  const json = "cache.raw_strategy_json"
  // bfl / all: prefer denormalized columns (patched on 团队策略 save), fall back to JSON.
  if (pool === "bfl" || pool === "all") {
    return {
      l1: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l1, (${json}->'${src}'->>'strategy_one'), '')), '')`,
      l2: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l2, (${json}->'${src}'->>'strategy_two'), '')), '')`,
      l3: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l3, (${json}->'${src}'->>'strategy_three'), '')), '')`,
    }
  }
  return {
    l1: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l1, '')), '')`,
    l2: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l2, '')), '')`,
    l3: `NULLIF(BTRIM(COALESCE(cache.${src}_strategy_l3, '')), '')`,
  }
}

function cachedIndependentStrategyExprs(): {
  platform_l1: string
  platform_l2: string
  platform_l3: string
  company_l1: string
  company_l2: string
  company_l3: string
} {
  const json = "cache.raw_strategy_json"
  return {
    platform_l1: `NULLIF(BTRIM(COALESCE(cache.platform_strategy_l1, ${json}->'platform'->>'strategy_one', '')), '')`,
    platform_l2: `NULLIF(BTRIM(COALESCE(cache.platform_strategy_l2, ${json}->'platform'->>'strategy_two', '')), '')`,
    platform_l3: `NULLIF(BTRIM(COALESCE(cache.platform_strategy_l3, ${json}->'platform'->>'strategy_three', '')), '')`,
    company_l1: `NULLIF(BTRIM(COALESCE(cache.company_strategy_l1, ${json}->'company'->>'strategy_one', '')), '')`,
    company_l2: `NULLIF(BTRIM(COALESCE(cache.company_strategy_l2, ${json}->'company'->>'strategy_two', '')), '')`,
    company_l3: `NULLIF(BTRIM(COALESCE(cache.company_strategy_l3, ${json}->'company'->>'strategy_three', '')), '')`,
  }
}

function sourceIndependentStrategyExprs(
  alias: string,
  pool: string,
  isExternalPool: boolean,
): {
  platform_l1: string
  platform_l2: string
  platform_l3: string
  company_l1: string
  company_l2: string
  company_l3: string
} {
  const json = rawStrategyJsonExpr(alias)
  if (pool === "bfl") {
    return {
      platform_l1: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_one', '')), '')`,
      platform_l2: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_two', '')), '')`,
      platform_l3: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_three', '')), '')`,
      company_l1: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_one', '')), '')`,
      company_l2: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_two', '')), '')`,
      company_l3: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_three', '')), '')`,
    }
  }
  const col = (side: "platform" | "company", level: "one" | "two" | "three", key: string) =>
    `NULLIF(BTRIM(COALESCE(${alias}.${side}_strategy_${level}, (${json})->'${side}'->>'${key}', '')), '')`
  if (pool === "all" || isExternalPool) {
    return {
      platform_l1: col("platform", "one", "strategy_one"),
      platform_l2: col("platform", "two", "strategy_two"),
      platform_l3: col("platform", "three", "strategy_three"),
      company_l1: col("company", "one", "strategy_one"),
      company_l2: col("company", "two", "strategy_two"),
      company_l3: col("company", "three", "strategy_three"),
    }
  }
  return {
    platform_l1: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_one', '')), '')`,
    platform_l2: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_two', '')), '')`,
    platform_l3: `NULLIF(BTRIM(COALESCE((${json})->'platform'->>'strategy_three', '')), '')`,
    company_l1: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_one', '')), '')`,
    company_l2: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_two', '')), '')`,
    company_l3: `NULLIF(BTRIM(COALESCE((${json})->'company'->>'strategy_three', '')), '')`,
  }
}

function buildCachedFromClause(
  pool: string,
  isCustomPool: boolean,
  isMineAllPool: boolean,
): string {
  if (pool === "all") {
    return `FROM (
      SELECT
        f.beian_hao,
        (ARRAY_AGG(f.product_name ORDER BY
          CASE
            WHEN UPPER(BTRIM(f.product_name)) = UPPER(BTRIM(f.beian_hao)) THEN 2
            WHEN f.product_name ~ '^[A-Za-z0-9]{4,10}$' THEN 1
            ELSE 0
          END,
          f.priority ASC
        ))[1] AS product_name,
        ${SHANGHAI_DATE_EXPR("MIN(f.added_at)")} AS first_added_at
      FROM (
        SELECT beian_hao, product_name, 1 AS priority, NULL::timestamptz AS added_at
          FROM private_fund_info_bfl WHERE beian_hao IS NOT NULL
        UNION ALL SELECT register_number, product_name, 2, imported_at FROM tracking_pool WHERE register_number IS NOT NULL
        UNION ALL SELECT register_number, product_name, 3, imported_at FROM selected_pool WHERE register_number IS NOT NULL
        UNION ALL SELECT register_number, product_name, 4, imported_at FROM core_pool WHERE register_number IS NOT NULL
        UNION ALL SELECT register_number, product_name, 5, imported_at FROM hy_tracking_pool WHERE register_number IS NOT NULL
        UNION ALL SELECT register_number, product_name, 6, imported_at FROM fof_mom_tracking WHERE register_number IS NOT NULL
        UNION ALL SELECT register_number, product_name, 7, imported_at FROM user_custom_pool
          WHERE register_number IS NOT NULL AND (pool_key = 'jy_ops' OR pool_key LIKE 'custom_%')
      ) f
      GROUP BY f.beian_hao
    ) i
    INNER JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao`
  }
  if (pool === "bfl_ops") {
    // Start from type6 membership so manual adds appear immediately even before
    // the nightly list-cache refresh. Metrics come from LEFT JOIN cache.
    return `FROM (
      SELECT DISTINCT ON (t.register_number)
        t.register_number AS beian_hao,
        COALESCE(t.fund_short_name, t.fund_name) AS product_name,
        MIN(${SHANGHAI_DATE_EXPR("t.imported_at")}) OVER (PARTITION BY t.register_number) AS first_added_at
      FROM type6_ops_team_full t
      WHERE t.register_number IS NOT NULL
      ORDER BY t.register_number, t.updated_at DESC NULLS LAST, t.id DESC
    ) i
    LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao`
  }
  if (pool === "bfl") {
    return `FROM (
      SELECT i0.*, NULL::date AS first_added_at FROM private_fund_info_bfl i0
    ) i
    LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao`
  }
  if (isCustomPool) {
    const poolFilter = isMineAllPool
      ? "AND (p.pool_key = 'mine_default' OR p.pool_key LIKE 'mine_custom_%')"
      : "AND p.pool_key = $1"
    return `FROM (
      SELECT DISTINCT ON (UPPER(BTRIM(register_number)))
        p.register_number AS beian_hao,
        p.product_name,
        MIN(${SHANGHAI_DATE_EXPR("p.imported_at")}) OVER (PARTITION BY UPPER(BTRIM(register_number))) AS first_added_at
      FROM user_custom_pool p
      WHERE p.register_number IS NOT NULL ${poolFilter}
      ORDER BY UPPER(BTRIM(register_number)), p.updated_at DESC NULLS LAST, p.id DESC
    ) i
    LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao`
  }
  const sourceTable =
    pool === "selected" ? "selected_pool"
    : pool === "core" ? "core_pool"
    : pool === "hy" ? "hy_tracking_pool"
    : pool === "fof" ? "fof_mom_tracking"
    : pool === "jy" || pool === "tracking" ? "tracking_pool"
    : "tracking_pool"
  return `FROM (
    SELECT p.register_number AS beian_hao, p.product_name,
      MIN(${SHANGHAI_DATE_EXPR("p.imported_at")}) AS first_added_at
    FROM ${sourceTable} p
    WHERE p.register_number IS NOT NULL
    GROUP BY p.register_number, p.product_name
  ) i
  LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao`
}

async function handleCachedTrackingList(opts: {
  page: number
  pageSize: number
  offset: number
  sortKey: string
  sortDir: string
  pool: string
  requestedPool: string | null
  isCustomPool: boolean
  isMineAllPool: boolean
  keyword: string
  strategyL1: string
  strategyL2: string
  strategyL3: string
  strategySource: StrategySource
  orgSize: string
  teamTagMode: string
  teamTags: string[]
  personalTagMode: string
  personalTags: string[]
  personalUserKey: string
  asOfDate: string
  navSource?: string
  /** null = no email-visibility filter; [] = hide all; string[] = whitelist */
  emailVisibilityRegisters?: string[] | null
}): Promise<NextResponse> {
  const {
    page, pageSize, offset, sortKey, sortDir, pool, requestedPool,
    isCustomPool, isMineAllPool, keyword, strategyL1, strategyL2, strategyL3,
    strategySource, orgSize, teamTagMode, teamTags,
    personalTagMode, personalTags, personalUserKey, asOfDate, navSource,
    emailVisibilityRegisters = null,
  } = opts
  // Check server-side response cache first, with concurrent request deduplication
  // so that multiple simultaneous requests for the same pool never race to run
  // the same expensive query in parallel (only one fires; others await it).
  const serverCacheKey = buildListResponseCacheKey(opts)
  void navSource

  try {
    const responseBody = await withListResponseCache(serverCacheKey, async () => {
      await ensureTrackingFundsListCachePopulated()

      const { l1: strategyL1Expr, l2: strategyL2Expr, l3: strategyL3Expr } =
        cachedStrategyExprs(pool, strategySource)
      const indepStrategy = cachedIndependentStrategyExprs()
      const tagsCol = "COALESCE(cache.team_tags, '[]'::jsonb)"

      const filterParams: unknown[] =
        isCustomPool && requestedPool && !isMineAllPool ? [requestedPool] : []
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
        where.push(`(${resolvedCachedProductNameExpr()} ILIKE $${filterParams.length} OR i.product_name ILIKE $${filterParams.length} OR i.beian_hao ILIKE $${filterParams.length} OR cache.product_name ILIKE $${filterParams.length} OR cache.short_name ILIKE $${filterParams.length})`)
      }
      if (teamTags.length > 0) {
        filterParams.push(teamTags)
        if (teamTagMode === "or") {
          where.push(
            `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${tagsCol}) t WHERE BTRIM(t) = ANY($${filterParams.length}::text[]))`,
          )
        } else {
          where.push(
            `NOT EXISTS (SELECT 1 FROM unnest($${filterParams.length}::text[]) req(tag) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${tagsCol}) t WHERE BTRIM(t) = req.tag))`,
          )
        }
      }
      if (personalTags.length > 0 && personalUserKey) {
        filterParams.push(personalUserKey)
        const userKeyParam = filterParams.length
        const clauses = personalTags.map((tag) => {
          filterParams.push(tag)
          return `EXISTS (
            SELECT 1 FROM ops_personal_fund_tags pt
            WHERE pt.beian_hao = i.beian_hao
              AND pt.user_key = $${userKeyParam}
              AND pt.tag_name = $${filterParams.length}
          )`
        })
        where.push(personalTagMode === "or" ? `(${clauses.join(" OR ")})` : clauses.join(" AND "))
      }
      if (emailVisibilityRegisters !== null) {
        filterParams.push(emailVisibilityRegisters)
        where.push(`UPPER(BTRIM(i.beian_hao)) = ANY(SELECT UPPER(BTRIM(x)) FROM unnest($${filterParams.length}::text[]) x)`)
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
      const pLimit = filterParams.length + 1
      const pOffset = filterParams.length + 2
      const orderCol = CACHE_ALLOWED_SORT[sortKey] ?? "i.first_added_at"
      const orderSql = sortKey === "first_added_at" || !CACHE_ALLOWED_SORT[sortKey]
        ? `${orderCol} ${sortDir} NULLS LAST, ${resolvedCachedProductNameExpr()} ASC`
        : `${orderCol} ${sortDir} NULLS LAST`
      const baseFrom = buildCachedFromClause(pool, isCustomPool, isMineAllPool)

      if (personalTags.length > 0) {
        await query(`
          CREATE TABLE IF NOT EXISTS ops_personal_fund_tags (
            id         SERIAL PRIMARY KEY,
            beian_hao  VARCHAR(64) NOT NULL,
            tag_name   VARCHAR(255) NOT NULL,
            user_key   VARCHAR(255) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (beian_hao, tag_name, user_key)
          )
        `)
      }

      const [rows, countRow] = await Promise.all([
        query<TrackRow>(
          `SELECT
             i.beian_hao,
             ${resolvedCachedProductNameExpr()} AS product_name,
             cache.short_name,
             ${strategyL1Expr} AS strategy_l1,
             ${strategyL2Expr} AS strategy_l2,
             ${indepStrategy.platform_l1} AS platform_strategy_l1,
             ${indepStrategy.platform_l2} AS platform_strategy_l2,
             ${indepStrategy.platform_l3} AS platform_strategy_l3,
             ${indepStrategy.company_l1} AS company_strategy_l1,
             ${indepStrategy.company_l2} AS company_strategy_l2,
             ${indepStrategy.company_l3} AS company_strategy_l3,
             NULL::text AS manager,
             NULL::text AS inception_date,
             i.first_added_at::text AS first_added_at,
             cache.unit_nav::text AS latest_nav,
             cache.nav_date::text AS latest_nav_date,
             cache.return_pct::text AS latest_price_change,
             cache.ret_1w::text,
             cache.ret_1m::text,
             cache.ret_3m::text,
             cache.ret_6m::text,
             cache.ret_1y::text,
             cache.sharpe_1y::text,
             cache.calmar_1y::text
           ${baseFrom}
           ${whereClause}
           ORDER BY ${orderSql}
           LIMIT $${pLimit} OFFSET $${pOffset}`,
          [...filterParams, pageSize, offset],
        ),
        query<{ total: string }>(
          `SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`,
          filterParams,
        ),
      ])

      const total = parseInt(countRow[0]?.total ?? "0")
      const enrichedRows = await enrichTrackFundMetricsRows(rows, asOfDate)
      // Cache pre-overlay rows; team/manual tip overlay runs outside the TTL cache
      // so a fresh upload is visible immediately without waiting for cache expiry.
      return {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        data: sanitizeTrackRows(enrichedRows),
      }
    }) as {
      page: number
      pageSize: number
      total: number
      totalPages: number
      data: TrackRow[]
    }
    const data = sanitizeTrackRows(
      await overlayTeamNavOnTrackRows(responseBody.data ?? [], asOfDate),
    )
    return NextResponse.json({ ...responseBody, data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handleBflOpsList(opts: {
  page: number
  pageSize: number
  offset: number
  sortKey: string
  sortDir: string
  cutoffExpr: string
  keyword: string
  strategyL1: string
  strategyL2: string
  strategyL3: string
  strategyPrefix: string
  orgSize: string
  teamTagMode: string
  teamTags: string[]
  navSource?: string
  asOfDate?: string
}): Promise<NextResponse> {
  const {
    page, pageSize, offset, sortKey, sortDir, cutoffExpr,
    keyword, strategyL1, strategyL2, strategyL3, strategyPrefix,
    orgSize, teamTagMode, teamTags, navSource, asOfDate,
  } = opts

  const strategyL1Expr = `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_one, '')), '')`
  const strategyL2Expr = `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_two, '')), '')`
  const strategyL3Expr = `NULLIF(BTRIM(COALESCE(i.${strategyPrefix}_strategy_three, '')), '')`

  const filterParams: (string | number)[] = []
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
  const pLimit = filterParams.length + 1
  const pOffset = filterParams.length + 2

  const allowedSort: Record<string, string> = {
    product_name: "i.product_name",
    first_added_at: "i.first_added_at",
    latest_nav: `${bflOpsNavExpr()}::numeric`,
    latest_nav_date: bflOpsNavDateExpr(),
    latest_price_change: `${bflOpsNavPctExpr()}::numeric`,
    ret_1w: "ret_1w",
    ret_1m: "ret_1m",
    ret_3m: "ret_3m",
    ret_6m: "ret_6m",
    ret_1y: "ret_1y",
  }
  const orderCol = allowedSort[sortKey] ?? "i.first_added_at"
  const orderSql = sortKey === "first_added_at" || !allowedSort[sortKey]
    ? `${orderCol} ${sortDir} NULLS LAST, i.product_name ASC`
    : `${orderCol} ${sortDir} NULLS LAST`
  const sourceWithNav = `${BFL_OPS_SOURCE_CTE}${BFL_OPS_TYPE6_LATEST_CTES(cutoffExpr)}`

  try {
    const [rows, countRow] = await Promise.all([
      query<TrackRow>(
        `${sourceWithNav}
         SELECT
           i.beian_hao,
           i.product_name,
           i.short_name,
           ${strategyL1Expr} AS strategy_l1,
           ${strategyL2Expr} AS strategy_l2,
           NULLIF(BTRIM(i.platform_strategy_one), '') AS platform_strategy_l1,
           NULLIF(BTRIM(i.platform_strategy_two), '') AS platform_strategy_l2,
           NULLIF(BTRIM(i.platform_strategy_three), '') AS platform_strategy_l3,
           NULLIF(BTRIM(i.company_strategy_one), '') AS company_strategy_l1,
           NULLIF(BTRIM(i.company_strategy_two), '') AS company_strategy_l2,
           NULLIF(BTRIM(i.company_strategy_three), '') AS company_strategy_l3,
           NULL::text AS manager,
           NULL::text AS inception_date,
           i.first_added_at::text AS first_added_at,
           ${bflOpsNavExpr()}::text AS latest_nav,
           ${bflOpsNavDateExpr()}::text AS latest_nav_date,
           ${bflOpsNavPctExpr()}::text AS latest_price_change,
           NULL::text AS ret_1w,
           NULL::text AS ret_1m,
           NULL::text AS ret_3m,
           NULL::text AS ret_6m,
           NULL::text AS ret_1y,
           NULL::text AS sharpe_1y,
           NULL::text AS calmar_1y
         FROM source i
         LEFT JOIN latest_by_code lbc ON lbc.beian_hao = i.beian_hao
         LEFT JOIN latest_by_name lbn ON lbn.product_name = i.product_name AND lbc.nav IS NULL
         LEFT JOIN latest_by_name lbs ON lbs.product_name = i.short_name AND lbc.nav IS NULL AND lbn.nav IS NULL
           AND i.short_name IS NOT NULL AND i.short_name <> i.product_name
         ${whereClause}
         ORDER BY ${orderSql}
         LIMIT $${pLimit} OFFSET $${pOffset}`,
        [...filterParams, pageSize, offset],
      ),
      query<{ total: string }>(
        `${BFL_OPS_SOURCE_CTE}
         SELECT COUNT(*) AS total FROM source i ${whereClause}`,
        filterParams,
      ),
    ])

    const total = parseInt(countRow[0]?.total ?? "0")
    let data = sanitizeTrackRows(rows)
    if (asOfDate) {
      data = sanitizeTrackRows(await overlayTeamNavOnTrackRows(data, asOfDate))
    }
    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  recordInteractiveUserTraffic("/ma/api/tracking-funds/list", "GET", userId)
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const requestedPool = searchParams.get("pool")
  const isMineAllPool = requestedPool === "mine_all"
  const isCustomPool = requestedPool ? (requestedPool.startsWith("custom_") || requestedPool.startsWith("mine_custom_") || requestedPool === "mine_default" || requestedPool === "jy_ops" || isMineAllPool) : false
  const KNOWN_POOLS = new Set(["bfl_ops", "bfl", "jy_ops", "jy", "tracking", "selected", "core", "hy", "fof", "all"])
  if (requestedPool && !KNOWN_POOLS.has(requestedPool) && !isCustomPool) {
    return NextResponse.json({ page, pageSize: 50, total: 0, totalPages: 0, data: [] })
  }
  const pool: string =
    (requestedPool === "bfl_ops" || requestedPool === "jy_ops" || requestedPool === "jy"
      || requestedPool === "tracking" || requestedPool === "selected"
      || requestedPool === "core" || requestedPool === "hy" || requestedPool === "fof"
      || requestedPool === "all" || isCustomPool) && requestedPool
      ? requestedPool
      : "bfl"
  const isExport = searchParams.get("export") === "1"
  const pageSize = isExport ? 100000 : 50
  const offset   = isExport ? 0 : (page - 1) * pageSize
  const rawSort = searchParams.get("sort")
  const sortKey  = rawSort || "first_added_at"
  const sortDir  = searchParams.get("dir") === "desc" ? "DESC"
    : searchParams.get("dir") === "asc" ? "ASC"
    : rawSort ? "ASC" : "DESC"
  const keyword    = (searchParams.get("keyword") || "").trim()
  const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
  const strategyL2 = (searchParams.get("strategy_l2") || "").trim()
  const strategyL3 = (searchParams.get("strategy_l3") || "").trim()
  const orgSize = (searchParams.get("org_size") || "").trim()
  const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
  const teamTags = searchParams.getAll("team_tag").map((s) => s.trim()).filter(Boolean)
  const personalTagMode = searchParams.get("personal_tag_mode") === "or" ? "or" : "and"
  const personalTags = searchParams.getAll("personal_tag").map((s) => s.trim()).filter(Boolean)
  const personalUserKey = String(req.headers.get("x-market-user-id") || "").trim()
  const strategySource = normalizeStrategySource((searchParams.get("strategy_source") || "").trim().toLowerCase())
  const cutoffRaw = (searchParams.get("cutoff") || "").trim()
  const cutoffExpr = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw) ? `'${cutoffRaw}'::date` : "CURRENT_DATE"
  const strategyPrefix = strategySource === "platform" ? "platform" : "company"
  const navSource = searchParams.get("nav_source") === "team" ? "team" : "platform"
  const asOfDateForNav = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)
    ? cutoffRaw
    : new Date().toISOString().slice(0, 10)

  // 邮箱运维池: filter products by 直投设置 crawl-email → account visibility.
  let emailVisibilityRegisters: string[] | null = null
  if (pool === EMAIL_OPS_POOL_KEY && personalUserKey) {
    const user = await getUserById(personalUserKey).catch(() => null)
    emailVisibilityRegisters = await resolveVisibleEmailPoolRegistersForUser({
      userId: personalUserKey,
      isAdmin: user?.role === "admin",
    })
  }

  if (await shouldUseTrackingFundsListCache(cutoffRaw)) {
    return handleCachedTrackingList({
      page,
      pageSize,
      offset,
      sortKey,
      sortDir,
      pool,
      requestedPool,
      isCustomPool,
      isMineAllPool,
      keyword,
      strategyL1,
      strategyL2,
      strategyL3,
      strategySource,
      orgSize,
      teamTagMode,
      teamTags,
      personalTagMode,
      personalTags,
      personalUserKey,
      asOfDate: asOfDateForNav,
      navSource,
      emailVisibilityRegisters,
    })
  }

  if (pool === "bfl_ops") {
    return handleBflOpsList({
      page,
      pageSize,
      offset,
      sortKey,
      sortDir,
      cutoffExpr,
      keyword,
      strategyL1,
      strategyL2,
      strategyL3,
      strategyPrefix,
      orgSize,
      teamTagMode,
      teamTags,
      navSource,
      asOfDate: asOfDateForNav,
    })
  }

  const navConfig = buildNavJoinConfig(pool, cutoffExpr)
  const orderCol = navConfig.allowedSort[sortKey] ?? "i.first_added_at"

  const sourceJsonExpr = rawStrategyJsonExpr("i")
  const isExternalPool = pool === "jy" || pool === "tracking" || pool === "selected" || pool === "core" || pool === "hy" || pool === "fof" || isCustomPool
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

  const indepStrategy = sourceIndependentStrategyExprs("i", pool, isExternalPool)

  const sourceCte = pool === "all"
    ? `WITH all_funds AS (
        SELECT beian_hao, product_name, 1 AS priority, NULL::timestamptz AS added_at FROM private_fund_info_bfl WHERE beian_hao IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 2 AS priority, imported_at FROM tracking_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 3 AS priority, imported_at FROM selected_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 4 AS priority, imported_at FROM core_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 5 AS priority, imported_at FROM hy_tracking_pool WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 6 AS priority, imported_at FROM fof_mom_tracking WHERE register_number IS NOT NULL
        UNION ALL
        SELECT register_number AS beian_hao, product_name, 7 AS priority, imported_at FROM user_custom_pool
          WHERE register_number IS NOT NULL AND (pool_key = 'jy_ops' OR pool_key LIKE 'custom_%')
      ),
      deduped AS (
        SELECT DISTINCT ON (beian_hao) beian_hao, product_name
        FROM all_funds
        ORDER BY beian_hao, priority ASC
      ),
      first_added AS (
        SELECT beian_hao, MIN(added_at) AS added_at FROM all_funds GROUP BY beian_hao
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
          o.platform_strategy_three,
          ${SHANGHAI_DATE_EXPR("fa.added_at")} AS first_added_at
        FROM deduped d
        LEFT JOIN first_added fa ON fa.beian_hao = d.beian_hao
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
    : pool === "bfl_ops"
    ? `WITH source AS (
        SELECT DISTINCT ON (o.register_number)
          o.register_number AS beian_hao,
          COALESCE(o.fund_short_name, o.fund_name) AS product_name,
          o.fund_name AS short_name,
          NULL::text AS raw_strategy,
          tag_data.strategy_company,
          o.company_strategy_one,
          o.company_strategy_two,
          o.company_strategy_three,
          o.platform_strategy_one,
          o.platform_strategy_two,
          o.platform_strategy_three,
          MIN(${SHANGHAI_DATE_EXPR("o.imported_at")}) OVER (PARTITION BY o.register_number) AS first_added_at
        FROM type6_ops_team_full o
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
        WHERE o.register_number IS NOT NULL
        ORDER BY o.register_number, o.updated_at DESC NULLS LAST, o.id DESC
      )`
    : isExternalPool
    ? `WITH source AS (
        SELECT
          p.register_number AS beian_hao,
          CASE
            WHEN p.product_name ~ '^[A-Za-z0-9]{4,10}$'
              OR UPPER(BTRIM(p.product_name)) = UPPER(BTRIM(p.register_number))
            THEN COALESCE(
              CASE WHEN o.fund_name ~ '[ABC]类' THEN NULLIF(BTRIM(o.fund_name), '') END,
              NULLIF(BTRIM(o.fund_short_name), ''),
              NULLIF(BTRIM(o.fund_name), ''),
              NULLIF(BTRIM(b.fund_short_name), ''),
              p.product_name
            )
            ELSE p.product_name
          END AS product_name,
          COALESCE(o.fund_short_name, b.fund_short_name) AS short_name,
          NULL::text AS raw_strategy,
          tag_data.strategy_company,
          o.company_strategy_one,
          o.company_strategy_two,
          o.company_strategy_three,
          o.platform_strategy_one,
          o.platform_strategy_two,
          o.platform_strategy_three,
          ${SHANGHAI_DATE_EXPR("p.imported_at")} AS first_added_at
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
          ${isCustomPool ? (isMineAllPool ? "AND (p.pool_key = 'mine_default' OR p.pool_key LIKE 'mine_custom_%')" : "AND p.pool_key = $1") : ""}
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
          NULL::text AS platform_strategy_three,
          NULL::date AS first_added_at
        FROM private_fund_info_bfl
      )`

  // For custom pools, pool_key is always the first param ($1) unless listing all mine pools
  const filterParams: (string | number | string[])[] =
    isCustomPool && requestedPool && !isMineAllPool ? [requestedPool] : []
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
  if (personalTags.length > 0 && personalUserKey) {
    filterParams.push(personalUserKey)
    const userKeyParam = filterParams.length
    const clauses = personalTags.map((tag) => {
      filterParams.push(tag)
      return `EXISTS (
        SELECT 1 FROM ops_personal_fund_tags pt
        WHERE pt.beian_hao = i.beian_hao
          AND pt.user_key = $${userKeyParam}
          AND pt.tag_name = $${filterParams.length}
      )`
    })
    where.push(personalTagMode === "or" ? `(${clauses.join(" OR ")})` : clauses.join(" AND "))
  }
  if (emailVisibilityRegisters !== null) {
    filterParams.push(emailVisibilityRegisters)
    where.push(`UPPER(BTRIM(i.beian_hao)) = ANY(SELECT UPPER(BTRIM(x)) FROM unnest($${filterParams.length}::text[]) x)`)
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

  const orderSql = sortKey === "first_added_at" || !navConfig.allowedSort[sortKey]
    ? `${orderCol} ${sortDir} NULLS LAST, i.product_name ASC`
    : `${orderCol} ${sortDir} NULLS LAST`

  const { latestNavJoin, fallbackNavExpr, fallbackDateExpr, fallbackPctExpr } = navConfig
  const emailNavJoins = buildEmailNavLatestJoins("i.beian_hao", "i.product_name", "i.short_name", cutoffExpr)
  const { navExpr: currentNavExpr, dateExpr: currentDateExpr, pctExpr: currentPctExpr } =
    buildEmailNavLatestExprs(fallbackNavExpr, fallbackDateExpr, fallbackPctExpr)

  const histJoins = [
    navAtOffset("h1w",  7,   cutoffExpr, navConfig.navScalarExpr),
    navAtOffset("h1m",  30,  cutoffExpr, navConfig.navScalarExpr),
    navAtOffset("h3m",  90,  cutoffExpr, navConfig.navScalarExpr),
    navAtOffset("h6m",  180, cutoffExpr, navConfig.navScalarExpr),
    navAtOffset("h1y",  365, cutoffExpr, navConfig.navScalarExpr),
  ].join("\n")

  try {
    if (personalTags.length > 0) {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_personal_fund_tags (
          id         SERIAL PRIMARY KEY,
          beian_hao  VARCHAR(64) NOT NULL,
          tag_name   VARCHAR(255) NOT NULL,
          user_key   VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (beian_hao, tag_name, user_key)
        )
      `)
    }
    const [rows, countRow] = await Promise.all([
      query<TrackRow>(
        `${sourceCte}
         SELECT
           i.beian_hao,
           i.product_name,
           i.short_name,
            ${strategyL1Expr}                             AS strategy_l1,
            ${strategyL2Expr}                             AS strategy_l2,
           ${indepStrategy.platform_l1}                   AS platform_strategy_l1,
           ${indepStrategy.platform_l2}                   AS platform_strategy_l2,
           ${indepStrategy.platform_l3}                   AS platform_strategy_l3,
           ${indepStrategy.company_l1}                    AS company_strategy_l1,
           ${indepStrategy.company_l2}                    AS company_strategy_l2,
           ${indepStrategy.company_l3}                    AS company_strategy_l3,
           NULL::text                                    AS manager,
           NULL::text                                    AS inception_date,
           i.first_added_at::text                          AS first_added_at,
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
           pinfo.sharpe_1y::text AS sharpe_1y,
           pinfo.calmar_1y::text AS calmar_1y
         FROM source i
         LEFT JOIN private_fund_info pinfo ON pinfo.beian_hao = i.beian_hao
         ${emailNavJoins}
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

    const total = parseInt(countRow[0]?.total ?? "0")
    // Historical cutoffs skip the precomputed cache — still recompute stale/corrupt NAV
    // so parent funds (e.g. SBHK26) pick up share-class email dates like the detail page.
    let data = await enrichTrackFundMetricsRows(rows, asOfDateForNav)
    data = await overlayTeamNavOnTrackRows(data, asOfDateForNav)
    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: sanitizeTrackRows(data),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Startup warm-up for bfl_ops (worker only). On next-server (RUN_BACKGROUND_JOBS=0)
// this used to fire in every PM2 cluster worker and peg both CPUs at boot.
// ---------------------------------------------------------------------------
declare global { var _bflOpsWarmScheduled: boolean | undefined }
if (!global._bflOpsWarmScheduled && process.env.RUN_BACKGROUND_JOBS !== "0") {
  global._bflOpsWarmScheduled = true
  setTimeout(async () => {
    try {
      const asOfDate = new Date().toISOString().slice(0, 10)
      await handleCachedTrackingList({
        page: 1, pageSize: 50, offset: 0,
        sortKey: "product_name", sortDir: "DESC",
        pool: "bfl_ops", requestedPool: "bfl_ops",
        isCustomPool: false, isMineAllPool: false,
        keyword: "", strategyL1: "", strategyL2: "", strategyL3: "",
        strategySource: "company" as const, orgSize: "不限", teamTagMode: "and", teamTags: [],
        personalTagMode: "and", personalTags: [], personalUserKey: "", asOfDate,
      })
    } catch { /* ignore — warm-up is best-effort */ }
  }, 1_000)
}
