import { query } from "@/lib/db"
import {
  buildFofUnderlyingBeianJoins,
} from "@/lib/server/fof-underlying-query"
import { ensureManagedFofUnderlyingTable, refreshManagedFofUnderlying } from "@/lib/server/managed-fof-underlying-pg"

export type InvestmentUnderlyingProduct = {
  product_key: string
  product_name: string
  beian_hao: string | null
  group_name: string
  market_value: number | null
  valuation_date: string | null
  manager_name: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
}

export type InvestmentUnderlyingGroupRow = {
  group_name: string
  product_count: number
  market_value: number
  pct: number
}

export type InvestmentUnderlyingStatsResult = {
  as_of_date: string
  group_by: "strategy" | "manager"
  strategy_source: "company" | "platform"
  strategy_level: 1 | 2 | 3
  products: InvestmentUnderlyingProduct[]
  summary: InvestmentUnderlyingGroupRow[]
  total: InvestmentUnderlyingGroupRow
}

const UNCONFIGURED_LABEL = "底层未配置"
const MANAGER_UNCONFIGURED_LABEL = "管理人未配置"
const PRODUCT_EXPR = "agg.product_name"

const OPS_BY_BEIAN_JOIN = `
     LEFT JOIN LATERAL (
       SELECT company_strategy_one, company_strategy_two, company_strategy_three,
              platform_strategy_one, platform_strategy_two, platform_strategy_three
       FROM type6_ops_team_full t6
       WHERE agg.beian_hao IS NOT NULL AND BTRIM(agg.beian_hao) <> ''
         AND t6.register_number = agg.beian_hao
       ORDER BY t6.updated_at DESC NULLS LAST, t6.id DESC
       LIMIT 1
     ) ops ON true`

function strategyColumns(strategySource: "company" | "platform"): {
  l1: string
  l2: string
  l3: string
} {
  if (strategySource === "platform") {
    return {
      l1: `NULLIF(BTRIM(COALESCE(o.platform_strategy_one, ops.platform_strategy_one)), '')`,
      l2: `NULLIF(BTRIM(COALESCE(o.platform_strategy_two, ops.platform_strategy_two)), '')`,
      l3: `NULLIF(BTRIM(COALESCE(o.platform_strategy_three, ops.platform_strategy_three)), '')`,
    }
  }
  return {
    l1: `COALESCE(NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
    l2: `COALESCE(NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
    l3: `COALESCE(NULLIF(BTRIM(o.company_strategy_three), ''), NULLIF(BTRIM(ops.company_strategy_three), ''), NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
  }
}

function groupLabel(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim()
  return v || fallback
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundPct(part: number, total: number): number {
  if (total <= 0) return 0
  return round2((part / total) * 100)
}

type UnderlyingRow = {
  product_key: string
  product_name: string
  beian_hao: string | null
  market_value: string | null
  valuation_date: string | null
  manager_name: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
}

function resolveGroupName(
  row: Pick<
    UnderlyingRow,
    | "manager_name"
    | "company_strategy_l1"
    | "company_strategy_l2"
    | "company_strategy_l3"
    | "platform_strategy_l1"
    | "platform_strategy_l2"
    | "platform_strategy_l3"
  >,
  opts: {
    groupBy: "strategy" | "manager"
    strategySource: "company" | "platform"
    strategyLevel: 1 | 2 | 3
  },
): string {
  if (opts.groupBy === "manager") {
    return groupLabel(row.manager_name, MANAGER_UNCONFIGURED_LABEL)
  }
  const strategy =
    opts.strategySource === "platform"
      ? (opts.strategyLevel === 3 ? row.platform_strategy_l3
        : opts.strategyLevel === 2 ? row.platform_strategy_l2
        : row.platform_strategy_l1)
      : (opts.strategyLevel === 3 ? row.company_strategy_l3
        : opts.strategyLevel === 2 ? row.company_strategy_l2
        : row.company_strategy_l1)
  return groupLabel(strategy, UNCONFIGURED_LABEL)
}

function buildSummary(
  items: Array<{ group_name: string; market_value: number | null }>,
): { summary: InvestmentUnderlyingGroupRow[]; total: InvestmentUnderlyingGroupRow } {
  const byGroup = new Map<string, { count: number; mv: number }>()
  let totalMv = 0
  let totalCount = 0

  for (const p of items) {
    const mv = p.market_value ?? 0
    if (mv <= 0) continue
    const cur = byGroup.get(p.group_name) ?? { count: 0, mv: 0 }
    cur.count += 1
    cur.mv += mv
    byGroup.set(p.group_name, cur)
    totalMv += mv
    totalCount += 1
  }

  const summary = Array.from(byGroup.entries())
    .map(([group_name, { count, mv }]) => ({
      group_name,
      product_count: count,
      market_value: round2(mv),
      pct: roundPct(mv, totalMv),
    }))
    .sort((a, b) => b.market_value - a.market_value)

  return {
    summary,
    total: {
      group_name: "合计",
      product_count: totalCount,
      market_value: round2(totalMv),
      pct: totalMv > 0 ? 100 : 0,
    },
  }
}

export async function queryInvestmentUnderlyingStats(params: {
  managedProductIds?: string[]
  groupBy?: "strategy" | "manager"
  strategySource?: "company" | "platform"
  strategyLevel?: 1 | 2 | 3
}): Promise<InvestmentUnderlyingStatsResult> {
  const strategySource = params.strategySource === "platform" ? "platform" : "company"
  const groupBy = params.groupBy === "manager" ? "manager" : "strategy"
  const strategyLevel = params.strategyLevel === 2 || params.strategyLevel === 3
    ? params.strategyLevel
    : 1
  const companyCols = strategyColumns("company")
  const platformCols = strategyColumns("platform")

  await ensureManagedFofUnderlyingTable()

  const emptyTable = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_fof_underlying`,
  )
  if (parseInt(emptyTable[0]?.n ?? "0", 10) === 0) {
    void refreshManagedFofUnderlying().catch((err) => {
      console.error("[investment-underlying-stats] background refresh failed:", err)
    })
  }

  const selectedIds = (params.managedProductIds ?? []).map((id) => id.trim()).filter(Boolean)
  const filterParams: unknown[] = []
  let filterSql = ""
  if (selectedIds.length > 0) {
    filterSql = `AND m.managed_product_id = ANY($1::bigint[])`
    filterParams.push(selectedIds)
  }

  const rows = await query<UnderlyingRow>(
    `WITH agg AS (
       SELECT
         COALESCE(
           NULLIF(BTRIM(UPPER(m.underlying_product_code)), ''),
           'NAME:' || TRIM(m.underlying_name)
         ) AS product_key,
         MAX(m.underlying_name) AS product_name,
         MAX(NULLIF(BTRIM(m.underlying_product_code), '')) AS beian_hao,
         SUM(COALESCE(m.market_value, 0))::text AS market_value,
         MAX(m.valuation_date::text) AS valuation_date
       FROM ops_managed_fof_underlying m
       WHERE COALESCE(m.market_value, 0) > 0
         ${filterSql}
       GROUP BY 1
     )
     SELECT
       agg.product_key,
       agg.product_name,
       agg.beian_hao,
       agg.market_value,
       agg.valuation_date,
       COALESCE(
         NULLIF(BTRIM(pfi.manager), ''),
         NULLIF(BTRIM(track.manager_names), ''),
         NULLIF(BTRIM(track.advisor), '')
       ) AS manager_name,
       ${companyCols.l1} AS company_strategy_l1,
       ${companyCols.l2} AS company_strategy_l2,
       ${companyCols.l3} AS company_strategy_l3,
       ${platformCols.l1} AS platform_strategy_l1,
       ${platformCols.l2} AS platform_strategy_l2,
       ${platformCols.l3} AS platform_strategy_l3
     FROM agg
     ${buildFofUnderlyingBeianJoins(PRODUCT_EXPR)}
     ${OPS_BY_BEIAN_JOIN}
     LEFT JOIN private_fund_info pfi ON pfi.beian_hao = agg.beian_hao
     LEFT JOIN LATERAL (
       SELECT manager_names, advisor
       FROM basicinfo_bfl_track b
       WHERE agg.beian_hao IS NOT NULL AND BTRIM(agg.beian_hao) <> ''
         AND b.register_number = agg.beian_hao
       ORDER BY b.updated_at DESC NULLS LAST, b.id DESC
       LIMIT 1
     ) track ON true
     WHERE COALESCE(agg.market_value::numeric, 0) > 0
     ORDER BY agg.market_value::numeric DESC NULLS LAST, agg.product_name`,
    filterParams,
  )

  const groupOpts: {
    groupBy: "strategy" | "manager"
    strategySource: "company" | "platform"
    strategyLevel: 1 | 2 | 3
  } = { groupBy, strategySource, strategyLevel }
  const products: InvestmentUnderlyingProduct[] = rows.map((r) => {
    const mv = r.market_value != null ? parseFloat(r.market_value) : null
    const group_name = resolveGroupName(r, groupOpts)
    return {
      product_key: r.product_key,
      product_name: r.product_name,
      beian_hao: r.beian_hao,
      group_name,
      market_value: mv != null && Number.isFinite(mv) && mv > 0 ? round2(mv) : null,
      valuation_date: r.valuation_date,
      manager_name: r.manager_name,
      company_strategy_l1: r.company_strategy_l1,
      company_strategy_l2: r.company_strategy_l2,
      company_strategy_l3: r.company_strategy_l3,
      platform_strategy_l1: r.platform_strategy_l1,
      platform_strategy_l2: r.platform_strategy_l2,
      platform_strategy_l3: r.platform_strategy_l3,
    }
  })

  const groupable = products.map((p) => ({
    group_name: p.group_name,
    market_value: p.market_value,
  }))
  const { summary, total } = buildSummary(groupable)

  const asOfDate = rows
    .map((r) => r.valuation_date)
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString().slice(0, 10)

  return {
    as_of_date: asOfDate,
    group_by: groupBy,
    strategy_source: strategySource,
    strategy_level: strategyLevel,
    products,
    summary,
    total,
  }
}
