import { query } from "@/lib/db"
import { resolveManagedProductBeian } from "@/lib/server/managed-product-beian"
import {
  buildManagedProductsFrom,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import {
  ensureManagedProductsListCachePopulated,
} from "@/lib/server/managed-products-list-cache-pg"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"

export type InvestmentOverviewProduct = {
  id: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  group_name: string
  net_asset_value: number | null
  valuation_date: string | null
  team_tags: string[]
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
}

export type InvestmentOverviewGroupRow = {
  group_name: string
  product_count: number
  net_asset_value: number
  pct: number
}

export type InvestmentOverviewSeriesPoint = {
  date: string
  total: number
  groups: Record<string, number>
}

export type InvestmentAssetAllocationResult = {
  as_of_date: string
  start_date: string
  end_date: string
  group_by: "strategy" | "tag"
  strategy_source: "company" | "platform"
  strategy_level: 1 | 2 | 3
  products: InvestmentOverviewProduct[]
  summary: InvestmentOverviewGroupRow[]
  total: InvestmentOverviewGroupRow
  series: InvestmentOverviewSeriesPoint[]
}

const UNCONFIGURED_LABEL = "策略未配置"
const TAG_UNCONFIGURED_LABEL = "标签未配置"
const PRODUCT_EXPR = "m.product_name"
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)

/** Resolve type6 strategies by 备案号 — more reliable than name-only lateral `o`. */
const OPS_BY_BEIAN_JOIN = `
     LEFT JOIN LATERAL (
       SELECT company_strategy_one, company_strategy_two, company_strategy_three,
              platform_strategy_one, platform_strategy_two, platform_strategy_three
       FROM type6_ops_team_full t6
       WHERE cache.beian_hao IS NOT NULL AND BTRIM(cache.beian_hao) <> ''
         AND t6.register_number = cache.beian_hao
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
    l1: `COALESCE(NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
    l2: `COALESCE(NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
    l3: `COALESCE(NULLIF(BTRIM(o.company_strategy_three), ''), NULLIF(BTRIM(ops.company_strategy_three), ''), NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
  }
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultDateRange(): { start: string; end: string } {
  const end = new Date()
  const start = addMonths(end, -6)
  return { start: fmtIsoDate(start), end: fmtIsoDate(end) }
}

function groupLabel(value: string | null | undefined, fallback: string): string {
  const s = (value ?? "").trim()
  return s || fallback
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundPct(part: number, total: number): number {
  if (total <= 0) return 0
  return round2((part / total) * 100)
}

function parseTeamTags(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((t) => String(t).trim()).filter(Boolean)
  } catch {
    return []
  }
}

type ProductRow = {
  id: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  team_tags: string | null
  cache_nav_date: string | null
  net_asset_value: string | null
}

type HistoryRow = {
  product_id: string
  valuation_date: string
  net_asset_value: string | null
}

type GroupableProduct = {
  id: string
  group_name: string
  net_asset_value: number | null
}

function resolveGroupName(
  row: Pick<ProductRow, "company_strategy_l1" | "company_strategy_l2" | "company_strategy_l3" | "platform_strategy_l1" | "platform_strategy_l2" | "platform_strategy_l3" | "team_tags">,
  opts: {
    groupBy: "strategy" | "tag"
    strategySource: "company" | "platform"
    strategyLevel: 1 | 2 | 3
  },
): string {
  if (opts.groupBy === "tag") {
    const tags = parseTeamTags(row.team_tags)
    return groupLabel(tags[0], TAG_UNCONFIGURED_LABEL)
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
  items: Array<{ group_name: string; net_asset_value: number | null }>,
): { summary: InvestmentOverviewGroupRow[]; total: InvestmentOverviewGroupRow } {
  const byGroup = new Map<string, { count: number; nav: number }>()
  let totalNav = 0
  let totalCount = 0

  for (const p of items) {
    const nav = p.net_asset_value ?? 0
    if (nav <= 0) continue
    const cur = byGroup.get(p.group_name) ?? { count: 0, nav: 0 }
    cur.count += 1
    cur.nav += nav
    byGroup.set(p.group_name, cur)
    totalNav += nav
    totalCount += 1
  }

  const summary = Array.from(byGroup.entries())
    .map(([group_name, { count, nav }]) => ({
      group_name,
      product_count: count,
      net_asset_value: round2(nav),
      pct: roundPct(nav, totalNav),
    }))
    .sort((a, b) => b.net_asset_value - a.net_asset_value)

  return {
    summary,
    total: {
      group_name: "合计",
      product_count: totalCount,
      net_asset_value: round2(totalNav),
      pct: totalNav > 0 ? 100 : 0,
    },
  }
}

function buildSeries(
  products: GroupableProduct[],
  history: HistoryRow[],
  startDate: string,
  endDate: string,
): InvestmentOverviewSeriesPoint[] {
  const groupById = new Map(products.map((p) => [p.id, p.group_name]))
  const dates = new Set<string>()
  const navByProductDate = new Map<string, number>()

  for (const row of history) {
    const nav = row.net_asset_value != null ? parseFloat(row.net_asset_value) : NaN
    if (!Number.isFinite(nav) || nav <= 0) continue
    dates.add(row.valuation_date)
    navByProductDate.set(`${row.product_id}\u0001${row.valuation_date}`, nav)
  }

  const sortedDates = Array.from(dates).filter((d) => d >= startDate && d <= endDate).sort()
  if (sortedDates.length === 0) return []

  const lastNavByProduct = new Map<string, number>()
  const points: InvestmentOverviewSeriesPoint[] = []

  for (const date of sortedDates) {
    for (const p of products) {
      const key = `${p.id}\u0001${date}`
      if (navByProductDate.has(key)) {
        lastNavByProduct.set(p.id, navByProductDate.get(key)!)
      }
    }

    const groups: Record<string, number> = {}
    let total = 0
    for (const p of products) {
      const nav = lastNavByProduct.get(p.id)
      if (nav == null || nav <= 0) continue
      const g = groupById.get(p.id) ?? UNCONFIGURED_LABEL
      groups[g] = round2((groups[g] ?? 0) + nav)
      total += nav
    }

    if (total > 0) {
      points.push({ date, total: round2(total), groups })
    }
  }

  return points
}

export async function queryInvestmentAssetAllocation(params: {
  startDate?: string
  endDate?: string
  productIds?: string[]
  strategySource?: "company" | "platform"
  groupBy?: "strategy" | "tag"
  strategyLevel?: 1 | 2 | 3
}): Promise<InvestmentAssetAllocationResult> {
  const defaults = defaultDateRange()
  const startDate = params.startDate && isValidDate(params.startDate) ? params.startDate : defaults.start
  const endDate = params.endDate && isValidDate(params.endDate) ? params.endDate : defaults.end
  const strategySource = params.strategySource === "platform" ? "platform" : "company"
  const groupBy = params.groupBy === "tag" ? "tag" : "strategy"
  const strategyLevel = params.strategyLevel === 2 || params.strategyLevel === 3
    ? params.strategyLevel
    : 1
  const companyCols = strategyColumns("company")
  const platformCols = strategyColumns("platform")

  await ensureManagedProductsListCachePopulated()
  await ensureEmailValuationTable()

  const productRows = await query<ProductRow>(
    `SELECT m.id::text AS id,
            m.product_name,
            ${SHORT_EXPR} AS short_name,
            cache.beian_hao,
            ${companyCols.l1} AS company_strategy_l1,
            ${companyCols.l2} AS company_strategy_l2,
            ${companyCols.l3} AS company_strategy_l3,
            ${platformCols.l1} AS platform_strategy_l1,
            ${platformCols.l2} AS platform_strategy_l2,
            ${platformCols.l3} AS platform_strategy_l3,
            cache.team_tags::text AS team_tags,
            cache.nav_date::text AS cache_nav_date,
            COALESCE(cache.net_asset_value, m.net_asset_value)::text AS net_asset_value
     ${buildManagedProductsFrom(PRODUCT_EXPR)}
     LEFT JOIN ops_managed_products_list_cache cache
       ON cache.managed_product_id = m.id
     ${OPS_BY_BEIAN_JOIN}
     WHERE m.product_name <> '合计'
       AND (COALESCE(cache.net_asset_value, m.net_asset_value) IS NULL
            OR COALESCE(cache.net_asset_value, m.net_asset_value) > 0)
     ORDER BY m.sequence_no NULLS LAST, m.id`,
  )

  const selectedIds = new Set((params.productIds ?? []).map((id) => id.trim()).filter(Boolean))
  const filteredRows = selectedIds.size > 0
    ? productRows.filter((r) => selectedIds.has(r.id))
    : productRows

  const groupOpts = { groupBy, strategySource, strategyLevel }
  const productIds = filteredRows.map((r) => r.id)
  let history: HistoryRow[] = []

  if (productIds.length > 0) {
    history = await query<HistoryRow>(
      `SELECT DISTINCT ON (m.id, v.valuation_date)
              m.id::text AS product_id,
              v.valuation_date::text AS valuation_date,
              COALESCE(v.net_asset_value, v.net_asset)::text AS net_asset_value
       ${buildManagedProductsFrom(PRODUCT_EXPR)}
       INNER JOIN ops_managed_products_list_cache cache
         ON cache.managed_product_id = m.id
       INNER JOIN ops_email_valuation_records v
         ON v.valuation_date BETWEEN $2::date AND $3::date
        AND COALESCE(v.net_asset_value, v.net_asset) IS NOT NULL
        AND COALESCE(v.net_asset_value, v.net_asset) > 0
        AND (
          (cache.beian_hao IS NOT NULL AND BTRIM(cache.beian_hao) <> ''
           AND UPPER(BTRIM(v.product_code)) = UPPER(BTRIM(cache.beian_hao)))
          OR v.fund_name = m.product_name
          OR v.fund_name = ${SHORT_EXPR}
        )
       WHERE m.id = ANY($1::bigint[])
       ORDER BY m.id, v.valuation_date, v.id DESC`,
      [productIds, startDate, endDate],
    )
  }

  const latestNavByProduct = new Map<string, { date: string; nav: number }>()
  for (const row of history) {
    const nav = row.net_asset_value != null ? parseFloat(row.net_asset_value) : NaN
    if (!Number.isFinite(nav) || nav <= 0) continue
    const prev = latestNavByProduct.get(row.product_id)
    if (!prev || row.valuation_date >= prev.date) {
      latestNavByProduct.set(row.product_id, { date: row.valuation_date, nav })
    }
  }

  const groupable: GroupableProduct[] = []
  const products: InvestmentOverviewProduct[] = filteredRows.map((r) => {
    const beian = resolveManagedProductBeian(r.product_name, r.beian_hao)
    const cacheNav = r.net_asset_value != null ? parseFloat(r.net_asset_value) : null
    const hist = latestNavByProduct.get(r.id)
    const nav = hist?.nav ?? (cacheNav != null && Number.isFinite(cacheNav) ? cacheNav : null)
    const group_name = resolveGroupName(r, groupOpts)
    groupable.push({
      id: r.id,
      group_name,
      net_asset_value: nav != null && nav > 0 ? round2(nav) : null,
    })
    return {
      id: r.id,
      product_name: r.product_name,
      short_name: r.short_name,
      beian_hao: beian,
      group_name,
      net_asset_value: nav != null && nav > 0 ? round2(nav) : null,
      valuation_date: hist?.date ?? r.cache_nav_date,
      team_tags: parseTeamTags(r.team_tags),
      company_strategy_l1: r.company_strategy_l1,
      company_strategy_l2: r.company_strategy_l2,
      company_strategy_l3: r.company_strategy_l3,
      platform_strategy_l1: r.platform_strategy_l1,
      platform_strategy_l2: r.platform_strategy_l2,
      platform_strategy_l3: r.platform_strategy_l3,
    }
  })

  const { summary, total } = buildSummary(groupable)
  const series = buildSeries(groupable, history, startDate, endDate)

  const latestHistDate = history.map((h) => h.valuation_date).sort().at(-1)

  return {
    as_of_date: latestHistDate && latestHistDate <= endDate ? latestHistDate : endDate,
    start_date: startDate,
    end_date: endDate,
    group_by: groupBy,
    strategy_source: strategySource,
    strategy_level: strategyLevel,
    products,
    summary,
    total,
    series,
  }
}
