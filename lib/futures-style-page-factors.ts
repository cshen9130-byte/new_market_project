/**
 * Default factors on 私募基金 → 市场 → 期货风格因子.
 * Order matches the 国君 CTA 周报 six (基差…利润) plus 期限基差 / 基差动量 / 中期动量.
 * Names are the cumulative-chart labels (cumName), not the clipped single-day card names.
 */
export const FUTURES_STYLE_PAGE_FACTORS = [
  { key: "report_basis_spot", name: "基差" },
  { key: "report_cs_long", name: "长期截面" },
  { key: "report_inventory", name: "库存" },
  { key: "report_pv_corr", name: "量价相关性" },
  { key: "report_long_rule", name: "长期规则" },
  { key: "report_profit", name: "利润" },
  { key: "report_basis", name: "期限基差" },
  { key: "report_basis_mom", name: "基差动量" },
  { key: "report_mid_mom", name: "中期动量" },
] as const

export type FuturesStylePageFactorKey = (typeof FUTURES_STYLE_PAGE_FACTORS)[number]["key"]
