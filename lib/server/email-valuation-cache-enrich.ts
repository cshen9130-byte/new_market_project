/**
 * Load email 估值表 metrics for list-cache enrichment during ETL refresh.
 */

import { query, queryUnbounded } from "@/lib/db"
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

/**
 * True when latest 资产净值 looks like 期货合约名义本金 got folded in
 * (e.g. SCQ403 52M → 240M) rather than a real subscription.
 */
export function isImplausibleAumJump(
  latest: number | null | undefined,
  prior: number | null | undefined,
): boolean {
  if (latest == null || prior == null) return false
  if (!(prior >= 1000) || !(latest >= 1000)) return false
  return latest > prior * 2.5 && latest > prior + 80_000_000
}

export function sqlImplausibleAumJump(latestExpr: string, priorExpr: string): string {
  return `(
    ${priorExpr} > 1000
    AND ${latestExpr} > ${priorExpr} * 2.5
    AND ${latestExpr} > ${priorExpr} + 80000000
  )`
}

export function deriveNetAssetValue(
  row: {
    net_asset_value?: string | null
    net_asset?: string | null
    total_asset?: string | null
    total_liability?: string | null
    paid_in_capital?: string | null
    unit_nav?: string | null
    summary_nav?: string | null
  },
  priorAum?: number | null,
): number | null {
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

  let aum = fromColumns
  if (implied != null && implied >= 1000) {
    if (fromColumns == null || fromColumns > implied * 2.5) aum = implied
  }
  if (isImplausibleAumJump(aum, priorAum)) return priorAum ?? null
  return aum
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

/** Prefer 托管行估值表 over TA虚拟净值 when several rows share a 备案号. */
export function sqlCustodyValuationPreference(alias = ""): string {
  const p = alias ? `${alias}.` : ""
  return `CASE
    WHEN COALESCE(${p}subject, '') ILIKE '%虚拟净值%'
      OR COALESCE(${p}subject, '') ILIKE '%TA虚拟%'
      OR COALESCE(${p}attachment_filename, '') ILIKE '%虚拟净值%'
    THEN 2
    WHEN COALESCE(${p}sender_email, '') ILIKE '%htsc%'
      OR COALESCE(${p}subject, '') ILIKE '%产品估值表%'
      OR COALESCE(${p}attachment_filename, '') ILIKE '%产品估值表%'
      OR COALESCE(${p}attachment_filename, '') ILIKE '%估值表_日报%'
    THEN 0
    ELSE 1
  END`
}

export async function loadEmailFundMetricsLookup(
  productCodes?: string[],
): Promise<{
  byProductCode: Map<string, EmailFundMetricsRow>
  byFundName: Map<string, EmailFundMetricsRow>
}> {
  await ensureEmailValuationMetricsTables()
  // Latest 托管估值表 per product_code from records. metrics_latest is keyed by
  // fund_name, so SBKM53 (fund_name=金舆锡泰一号) can hide SCQ403.
  const codes = [...new Set(
    (productCodes ?? [])
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  )]
  const params: unknown[] = []
  let codeFilter = "NULLIF(BTRIM(product_code), '') IS NOT NULL"
  if (codes.length > 0) {
    params.push(codes)
    codeFilter = `UPPER(BTRIM(product_code)) = ANY($1::text[])`
  }
  const rows = await queryUnbounded<{
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
    prior_nav: string | null
  }>(`WITH ranked AS (
        SELECT
          product_code, fund_name, custody_balance, net_asset_value, net_asset,
          total_asset, total_liability, paid_in_capital, unit_nav, valuation_date,
          summary->>'nav' AS summary_nav,
          ROW_NUMBER() OVER (
            PARTITION BY UPPER(BTRIM(product_code))
            ORDER BY ${sqlCustodyValuationPreference()}, valuation_date DESC, id DESC
          ) AS rn
        FROM ops_email_valuation_records
        WHERE ${codeFilter}
      ),
      latest AS (
        SELECT * FROM ranked WHERE rn = 1
      ),
      prior AS (
        SELECT DISTINCT ON (UPPER(BTRIM(r.product_code)))
          UPPER(BTRIM(r.product_code)) AS product_code_key,
          r.net_asset_value AS prior_nav
        FROM ops_email_valuation_records r
        INNER JOIN latest l
          ON UPPER(BTRIM(r.product_code)) = UPPER(BTRIM(l.product_code))
         AND r.valuation_date < l.valuation_date
        ORDER BY UPPER(BTRIM(r.product_code)),
                 ${sqlCustodyValuationPreference("r")},
                 r.valuation_date DESC, r.id DESC
      )
      SELECT l.product_code, l.fund_name,
             l.custody_balance::text, l.net_asset_value::text, l.net_asset::text,
             l.total_asset::text, l.total_liability::text, l.paid_in_capital::text,
             l.unit_nav::text, l.valuation_date::text, l.summary_nav,
             p.prior_nav::text
      FROM latest l
      LEFT JOIN prior p ON UPPER(BTRIM(l.product_code)) = p.product_code_key`, params)

  const byProductCode = new Map<string, EmailFundMetricsRow>()
  const byFundName = new Map<string, EmailFundMetricsRow>()

  for (const row of rows) {
    const unitNav = parseAmount(row.unit_nav)
    const productCode = row.product_code?.trim() || null
    const custody = parseAmount(row.custody_balance)
    const metrics: EmailFundMetricsRow = {
      product_code: productCode,
      custody_balance: custody != null && custody > 0 ? custody : null,
      net_asset_value: deriveNetAssetValue(row, parseFundNavAmount(row.prior_nav)),
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
