export type NavGenRuleType = "splice" | "fixed_income" | "mom_long"

export const FUND_SPLICE_CATEGORIES = [
  "私募基金",
  "自建基金",
  "跟踪产品",
  "在管产品",
  "FOF底层",
] as const

export type FundSpliceCategory = (typeof FUND_SPLICE_CATEGORIES)[number]

export type FundSpliceEntry = {
  fund_category: string
  product_name: string
  nav_source: string
  /** Inclusive start of this fund's NAV segment */
  start_date: string
  /** Inclusive end of this fund's NAV segment (optional on last fund = use latest) */
  end_date: string
  /**
   * @deprecated Prefer end_date. Kept so older saved rules still load.
   */
  tail_nav_date?: string
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

export function normalizeFundSpliceEntry(
  row: Partial<FundSpliceEntry> | null | undefined,
  fallbackStart = "",
): FundSpliceEntry {
  const end = String(row?.end_date ?? row?.tail_nav_date ?? "").trim()
  const start = String(row?.start_date ?? fallbackStart).trim()
  return {
    fund_category: String(row?.fund_category ?? "私募基金"),
    product_name: String(row?.product_name ?? "").trim(),
    nav_source: String(row?.nav_source ?? "平台净值"),
    start_date: start,
    end_date: end,
    tail_nav_date: end,
  }
}

export function normalizeSpliceFunds(
  raw: unknown,
  ruleStartDate = "",
): FundSpliceEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_SPLICE_FUNDS.map((row) => ({ ...row }))
  }
  return raw.map((item, index) =>
    normalizeFundSpliceEntry(
      item as Partial<FundSpliceEntry>,
      index === 0 ? ruleStartDate : "",
    ),
  )
}

export const DEFAULT_SPLICE_FUNDS: FundSpliceEntry[] = [
  {
    fund_category: "私募基金",
    product_name: "",
    nav_source: "平台净值",
    start_date: "",
    end_date: "",
    tail_nav_date: "",
  },
  {
    fund_category: "私募基金",
    product_name: "",
    nav_source: "平台净值",
    start_date: "",
    end_date: "",
    tail_nav_date: "",
  },
]
