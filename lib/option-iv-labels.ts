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
