/**
 * Load email 估值表 metrics for list-cache enrichment during ETL refresh.
 */

import { query } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import { resolveManagedProductBeian } from "@/lib/server/managed-product-beian"

export type EmailFundMetricsRow = {
  custody_balance: number | null
  net_asset_value: number | null
  /** Latest 估值表 unit NAV — used when email/type6 NAV series is missing (e.g. SCN504). */
  unit_nav: number | null
  valuation_date: string | null
}

export type EmailUnderlyingMarketRow = {
  market_value: number | null
}

function normalizeFundKey(name: string): string {
  return name
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
    .replace(/[ABC]类$/u, "")
    .trim()
}

export async function loadEmailFundMetricsLookup(): Promise<{
  byProductCode: Map<string, EmailFundMetricsRow>
  byFundName: Map<string, EmailFundMetricsRow>
}> {
  await ensureEmailValuationMetricsTables()
  const rows = await query<{
    product_code: string | null
    fund_name: string
    custody_balance: string | null
    net_asset_value: string | null
    unit_nav: string | null
    valuation_date: string | null
  }>(`SELECT product_code, fund_name,
            custody_balance::text, net_asset_value::text,
            unit_nav::text, valuation_date::text
      FROM ops_email_valuation_fund_metrics_latest`)

  const byProductCode = new Map<string, EmailFundMetricsRow>()
  const byFundName = new Map<string, EmailFundMetricsRow>()

  for (const row of rows) {
    const unitNav = row.unit_nav != null ? parseFloat(row.unit_nav) : null
    const metrics: EmailFundMetricsRow = {
      custody_balance: row.custody_balance != null ? parseFloat(row.custody_balance) : null,
      net_asset_value: row.net_asset_value != null ? parseFloat(row.net_asset_value) : null,
      unit_nav: unitNav != null && Number.isFinite(unitNav) && unitNav > 0 ? unitNav : null,
      valuation_date: row.valuation_date?.slice(0, 10) ?? null,
    }
    if (row.product_code?.trim()) {
      byProductCode.set(row.product_code.trim(), metrics)
    }
    byFundName.set(row.fund_name.trim(), metrics)
    byFundName.set(normalizeFundKey(row.fund_name), metrics)
  }

  return { byProductCode, byFundName }
}

export function resolveEmailFundMetrics(
  productName: string,
  beianHao: string | null,
  lookup: Awaited<ReturnType<typeof loadEmailFundMetricsLookup>>,
): EmailFundMetricsRow {
  const empty: EmailFundMetricsRow = {
    custody_balance: null,
    net_asset_value: null,
    unit_nav: null,
    valuation_date: null,
  }
  const resolved =
    resolveManagedProductBeian(productName, beianHao)?.trim()
    || beianHao?.trim()
    || ""
  if (resolved && lookup.byProductCode.has(resolved)) {
    return lookup.byProductCode.get(resolved)!
  }
  const beian = beianHao?.trim()
  if (beian && beian !== resolved && lookup.byProductCode.has(beian)) {
    return lookup.byProductCode.get(beian)!
  }
  const exact = lookup.byFundName.get(productName.trim())
  if (exact) return exact
  const normalized = lookup.byFundName.get(normalizeFundKey(productName))
  if (normalized) return normalized
  return empty
}

export async function loadEmailUnderlyingMarketLookup(): Promise<{
  byProductCode: Map<string, EmailUnderlyingMarketRow>
  byName: Map<string, EmailUnderlyingMarketRow>
}> {
  await ensureEmailValuationMetricsTables()
  const rows = await query<{
    underlying_product_code: string | null
    underlying_name: string
    market_value: string | null
  }>(`SELECT underlying_product_code, underlying_name, market_value::text
      FROM ops_email_valuation_underlying_market_latest`)

  const byProductCode = new Map<string, EmailUnderlyingMarketRow>()
  const byName = new Map<string, EmailUnderlyingMarketRow>()

  for (const row of rows) {
    const metrics: EmailUnderlyingMarketRow = {
      market_value: row.market_value != null ? parseFloat(row.market_value) : null,
    }
    if (row.underlying_product_code?.trim()) {
      byProductCode.set(row.underlying_product_code.trim(), metrics)
    }
    byName.set(row.underlying_name.trim(), metrics)
    byName.set(normalizeFundKey(row.underlying_name), metrics)
  }

  return { byProductCode, byName }
}

export function resolveEmailUnderlyingMarket(
  productName: string,
  beianHao: string | null,
  lookup: Awaited<ReturnType<typeof loadEmailUnderlyingMarketLookup>>,
): EmailUnderlyingMarketRow {
  const beian = beianHao?.trim()
  if (beian && lookup.byProductCode.has(beian)) {
    return lookup.byProductCode.get(beian)!
  }
  const exact = lookup.byName.get(productName.trim())
  if (exact) return exact
  const normalized = lookup.byName.get(normalizeFundKey(productName))
  if (normalized) return normalized
  return { market_value: null }
}
