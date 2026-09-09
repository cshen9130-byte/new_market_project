export const PRODUCT_CATEGORIES = ["权益类", "固定收益类", "混合类", "期货和衍生品类"] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = "混合类"

export function isProductCategory(value: string | null | undefined): value is ProductCategory {
  return Boolean(value) && (PRODUCT_CATEGORIES as readonly string[]).includes(value as string)
}

export type ComplianceCheck = {
  id: string
  title: string
  article: string
  passed: boolean
  value: string
  threshold: string
  detail: string
}

export type LookthroughMissing = {
  name: string
  code: string | null
  market_value: number
}

export type AssetBucket =
  | "equity"
  | "fixed_income"
  | "derivatives"
  | "cash_tool"
  | "fund"
  | "other"
  | "margin"

export type LookthroughHolding = {
  name: string
  symbol: string | null
  bucket: AssetBucket
  market_value: number
  pct_nav: number
  source_fund: string | null
  concentration_exempt: boolean
}

export type LookthroughSubfundStructure = {
  name: string
  product_code: string | null
  is_parent_direct: boolean
  unpenetrated: boolean
  valuation_date: string | null
  fund_strategy: string | null
  buckets: {
    equity: number
    fixed_income: number
    derivatives_notional: number
    cash_tools: number
    funds_unpenetrated: number
    other: number
    invested_assets: number
  }
  ratios: {
    equity_pct: number | null
    fixed_income_pct: number | null
    derivatives_notional_pct: number | null
    funds_unpenetrated_pct: number | null
    cash_tools_pct: number | null
    other_pct: number | null
    share_of_parent_invested_pct: number | null
  }
}

export type LookthroughComplianceProduct = {
  id: number
  product_name: string
  beian_hao: string | null
  valuation_date: string | null
  unit_nav: number | null
  net_asset_value: number
  total_asset: number
  is_fof: boolean
  has_valuation: boolean
  lookthrough: {
    attempted: boolean
    complete: boolean
    underlying_count: number
    penetrated_count: number
    missing: LookthroughMissing[]
  }
  buckets: {
    equity: number
    fixed_income: number
    derivatives_notional: number
    derivatives_equity: number
    cash_tools: number
    funds_unpenetrated: number
    other: number
    invested_assets: number
  }
  ratios: {
    equity_pct: number | null
    fixed_income_pct: number | null
    derivatives_notional_pct: number | null
    derivatives_equity_pct: number | null
    leverage_pct: number | null
    leverage_limit_pct: number | null
    illiquid_restricted_pct: number | null
    max_single_asset_pct: number | null
    max_single_bond_pct: number | null
  }
  inferred_type: ProductCategory | "母基金" | "无法判定"
  assigned_category?: ProductCategory | null
  top_holdings: LookthroughHolding[]
  subfund_structures: LookthroughSubfundStructure[]
  checks_by_category: Record<ProductCategory, ComplianceCheck[]>
}

export type LookthroughComplianceResult = {
  as_of: string
  products: LookthroughComplianceProduct[]
}

export type LookthroughConclusion = "pass" | "fail" | "incomplete" | "na"

export type LookthroughAnomalyCell =
  | "equity"
  | "fixed_income"
  | "derivatives"
  | "single_asset"
  | "leverage"

export function lookthroughConclusion(
  product: LookthroughComplianceProduct,
  category: ProductCategory,
): LookthroughConclusion {
  if (!product.has_valuation) return "na"
  if (product.is_fof && !product.lookthrough.complete) return "incomplete"
  const checks = product.checks_by_category[category] ?? []
  if (checks.length === 0) return "na"
  return checks.every((c) => c.passed) ? "pass" : "fail"
}

/** Ratio / limit cells that caused a failed check. 无法判断 / 缺数据 do not blink. */
export function lookthroughAnomalyCells(
  product: LookthroughComplianceProduct,
  category: ProductCategory,
): Set<LookthroughAnomalyCell> {
  const out = new Set<LookthroughAnomalyCell>()
  if (lookthroughConclusion(product, category) !== "fail") return out
  const failed = (product.checks_by_category[category] ?? []).filter((c) => !c.passed)
  if (failed.length === 0) return out

  for (const check of failed) {
    if (check.id === "type-equity") out.add("equity")
    else if (check.id === "type-fi") out.add("fixed_income")
    else if (check.id === "type-deriv-notional") out.add("derivatives")
    else if (check.id === "type-mixed") {
      if ((product.ratios.equity_pct ?? 0) >= 80) out.add("equity")
      if ((product.ratios.fixed_income_pct ?? 0) >= 80) out.add("fixed_income")
      if ((product.ratios.derivatives_notional_pct ?? 0) >= 80) out.add("derivatives")
    } else if (check.id === "conc-25") out.add("single_asset")
    else if (check.id === "leverage") out.add("leverage")
  }
  return out
}
