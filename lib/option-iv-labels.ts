/** Chinese display labels for financial option underlyings (key → name). */
export const UNDERLYING_CN_LABELS: Record<string, string> = {
  "50etf": "50ETF (510050)",
  "50index": "50股指 (HO)",
  "300etf": "300ETF (510300)",
  "300etf_sz": "300ETF (159919)",
  "300index": "300股指 (IO)",
  "500etf": "500ETF (510500)",
  "500etf_sz": "500ETF (159922)",
  "1000index": "1000股指 (MO)",
  cyb: "创业板ETF",
  kcb: "科创50 (588000)",
  kcb_efund: "科创50 (588080)",
  "100etf": "深证100ETF",
}

export function underlyingCnLabel(key: string, fallback?: string): string {
  return UNDERLYING_CN_LABELS[key] ?? fallback ?? key
}

/** Short Chinese name for chart titles (e.g. "上证50 ETF"). */
export const UNDERLYING_CHART_LABELS: Record<string, string> = {
  "50etf": "上证50 ETF",
  "50index": "上证50 股指",
  "300etf": "沪深300 ETF",
  "300etf_sz": "沪深300 ETF",
  "300index": "沪深300 股指",
  "500etf": "中证500 ETF",
  "500etf_sz": "中证500 ETF",
  "1000index": "中证1000 股指",
  cyb: "创业板 ETF",
  kcb: "科创50 ETF",
  kcb_efund: "科创50 ETF",
  "100etf": "深证100 ETF",
}

export function underlyingChartLabel(key: string, fallback?: string): string {
  return UNDERLYING_CHART_LABELS[key] ?? fallback ?? underlyingCnLabel(key, fallback)
}
