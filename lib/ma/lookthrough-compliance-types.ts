export const PRODUCT_CATEGORIES = ["权益类", "固定收益类", "混合类", "期货和衍生品类"] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = "混合类"

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

export type LookthroughHolding = {
  name: string
  symbol: string | null
  bucket: AssetBucket
  market_value: number
  pct_nav: number
  source_fund: string | null
  concentration_exempt: boolean
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
  top_holdings: LookthroughHolding[]
  checks_by_category: Record<ProductCategory, ComplianceCheck[]>
}

export type LookthroughComplianceResult = {
  as_of: string
  products: LookthroughComplianceProduct[]
}

export type LookthroughConclusion = "pass" | "fail" | "incomplete" | "na"

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
