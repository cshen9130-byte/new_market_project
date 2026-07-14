/**
 * Per-fund NAV correction rules — manually configured when upstream data has
 * wrong history that should be discarded without affecting other funds.
 */
export type FundNavCorrectionRule = {
  /** Primary 备案号 for this rule file */
  beian_hao: string
  /** Extra product name aliases that should resolve to this rule */
  product_names?: string[]
  /**
   * Keep NAV rows on or after this date only (ISO YYYY-MM-DD).
   * Rows strictly before this date are discarded.
   */
  series_start_date: string
  /**
   * When true, skip return-index spike/tail sanitization (~4 NAV is correct).
   * Use when the fund genuinely rebased to a cumulative-return scale.
   */
  preserve_high_nav_scale?: boolean
  note?: string
  updated_at?: string
}

export const EMPTY_FUND_NAV_CORRECTION_RULE: FundNavCorrectionRule = {
  beian_hao: "",
  product_names: [],
  series_start_date: "",
  preserve_high_nav_scale: false,
  note: "",
}
