/**
 * Load email 估值表 metrics for list-cache enrichment during ETL refresh.
 */

import { query } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import {
  remapManagedProductBeianCode,
  resolveManagedProductBeian,
  resolveManagedProductBeianIgnoringShareClass,
} from "@/lib/server/managed-product-beian"

export type EmailFundMetricsRow = {
  product_code: string | null
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

function emptyMetrics(): EmailFundMetricsRow {
  return {
    product_code: null,
    custody_balance: null,
    net_asset_value: null,
    unit_nav: null,
    valuation_date: null,
  }
}

function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null
  const n = typeof raw === "number" ? raw : parseFloat(String(raw))
  return Number.isFinite(n) ? n : null
}

/** Fund-level 资产净值 — never a unit NAV (0.05–500). */
function parseFundNavAmount(raw: string | number | null | undefined): number | null {
  const n = parseAmount(raw)
  if (n == null || n < 1000) return null
  return n
}

export function deriveNetAssetValue(row: {
  net_asset_value?: string | null
  net_asset?: string | null
  total_asset?: string | null
  total_liability?: string | null
  paid_in_capital?: string | null
  unit_nav?: string | null
  summary_nav?: string | null
}): number | null {
  const unitNav = parseAmount(row.unit_nav)
  const paidIn = parseFundNavAmount(row.paid_in_capital)
  const implied =
    unitNav != null && unitNav > 0.05 && paidIn != null ? unitNav * paidIn : null

  const fromColumns = parseFundNavAmount(row.net_asset_value)
    ?? parseFundNavAmount(row.net_asset)
    ?? parseFundNavAmount(row.summary_nav)
    ?? (() => {
      const assets = parseFundNavAmount(row.total_asset)
      const liab = parseAmount(row.total_liability) ?? 0
      return assets != null ? assets - liab : null
    })()

  if (implied != null && implied >= 1000) {
    if (fromColumns == null || fromColumns > implied * 2.5) return implied
  }
  return fromColumns
}

/** True when a 估值表 row's product_code is this managed product (or a known alias). */
export function valuationMetricsCodeBelongsToBeian(
  productCode: string | null | undefined,
  canonicalBeian: string,
): boolean {
  const code = (productCode ?? "").trim()
  const target = canonicalBeian.trim()
  if (!code || !target) return !code
  if (code.toUpperCase() === target.toUpperCase()) return true
  const remapped = remapManagedProductBeianCode(code)
  return remapped != null && remapped.toUpperCase() === target.toUpperCase()
}

/**
 * TA虚拟净值 mails store the underlying code with the 在管 product's fund_name
 * (SBKM53 + 金舆锡泰一号). Never index those under the managed-product name.
 */
function shouldIndexValuationMetricsByFundName(
  fundName: string,
  productCode: string | null,
): boolean {
  const override =
    resolveManagedProductBeian(fundName)
    ?? resolveManagedProductBeianIgnoringShareClass(fundName)
  if (!override) return true
  return valuationMetricsCodeBelongsToBeian(productCode, override)
}

export async function loadEmailFundMetricsLookup(): Promise<{
  byProductCode: Map<string, EmailFundMetricsRow>
  byFundName: Map<string, EmailFundMetricsRow>
}> {
  await ensureEmailValuationMetricsTables()
  // Latest 估值表 per product_code from records. metrics_latest is keyed by
  // fund_name, so SBKM53 (fund_name=金舆锡泰一号) can hide SCQ403.
  const rows = await query<{
    product_code: string | null
    fund_name: string
    custody_balance: string | null
    net_asset_value: string | null
    net_asset: string | null
    total_asset: string | null
    total_liability: string | null
    paid_in_capital: string | null
    unit_nav: string | null
    valuation_date: string | null
    summary_nav: string | null
  }>(`SELECT DISTINCT ON (UPPER(BTRIM(product_code)))
            product_code, fund_name,
            custody_balance::text, net_asset_value::text, net_asset::text,
            total_asset::text, total_liability::text, paid_in_capital::text,
            unit_nav::text, valuation_date::text,
            summary->>'nav' AS summary_nav
      FROM ops_email_valuation_records
      WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
      ORDER BY UPPER(BTRIM(product_code)), valuation_date DESC, id DESC`)

  const byProductCode = new Map<string, EmailFundMetricsRow>()
  const byFundName = new Map<string, EmailFundMetricsRow>()

  for (const row of rows) {
    const unitNav = parseAmount(row.unit_nav)
    const productCode = row.product_code?.trim() || null
    const custody = parseAmount(row.custody_balance)
    const metrics: EmailFundMetricsRow = {
      product_code: productCode,
      custody_balance: custody != null && custody > 0 ? custody : null,
      net_asset_value: deriveNetAssetValue(row),
      unit_nav: unitNav != null && unitNav > 0 ? unitNav : null,
      valuation_date: row.valuation_date?.slice(0, 10) ?? null,
    }
    if (productCode) {
      byProductCode.set(productCode.toUpperCase(), metrics)
    }
    if (shouldIndexValuationMetricsByFundName(row.fund_name, productCode)) {
      byFundName.set(row.fund_name.trim(), metrics)
      byFundName.set(normalizeFundKey(row.fund_name), metrics)
    }
  }

  return { byProductCode, byFundName }
}

export function resolveEmailFundMetrics(
  productName: string,
  beianHao: string | null,
  lookup: Awaited<ReturnType<typeof loadEmailFundMetricsLookup>>,
): EmailFundMetricsRow {
  const empty = emptyMetrics()
  const resolved =
    resolveManagedProductBeian(productName, beianHao)?.trim()
    || beianHao?.trim()
    || ""
  const resolvedKey = resolved.toUpperCase()
  if (resolvedKey && lookup.byProductCode.has(resolvedKey)) {
    return lookup.byProductCode.get(resolvedKey)!
  }
  const beian = beianHao?.trim()
  const beianKey = beian?.toUpperCase() ?? ""
  // Only follow known aliases (SBVC25→SCN504). Auto-resolved underlying codes
  // like SBKM53 for 金舆锡泰一号 must not supply 资产净值.
  if (
    beianKey
    && resolvedKey
    && beianKey !== resolvedKey
    && valuationMetricsCodeBelongsToBeian(beian, resolved)
    && lookup.byProductCode.has(beianKey)
  ) {
    return lookup.byProductCode.get(beianKey)!
  }
  const exact = lookup.byFundName.get(productName.trim())
  if (exact && (!resolved || valuationMetricsCodeBelongsToBeian(exact.product_code, resolved))) {
    return exact
  }
  const normalized = lookup.byFundName.get(normalizeFundKey(productName))
  if (
    normalized
    && (!resolved || valuationMetricsCodeBelongsToBeian(normalized.product_code, resolved))
  ) {
    return normalized
  }
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
