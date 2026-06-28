export type NavGenRuleType = "splice" | "fixed_income" | "mom_long"

export type FundSpliceEntry = {
  fund_category: string
  product_name: string
  nav_source: string
  tail_nav_date: string
}

export type MomLongExtraDate = {
  date: string
  fixed_item: string
  non_fixed_item: string
}

export type CustomFundNavGenerationRule = {
  rule_type: NavGenRuleType
  start_date: string
  funds: FundSpliceEntry[]
  annual_return_rate: string
  mom_product_name: string
  mom_fixed_item: string
  mom_non_fixed_item: string
  mom_extra_dates: MomLongExtraDate[]
  updated_at: string
}

export const DEFAULT_SPLICE_FUNDS: FundSpliceEntry[] = [
  { fund_category: "私募基金", product_name: "", nav_source: "平台净值", tail_nav_date: "" },
  { fund_category: "私募基金", product_name: "", nav_source: "平台净值", tail_nav_date: "" },
]
