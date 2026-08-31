export const TEAM_BENCHMARK_OPTIONS = [
  "沪深300",
  "中证500",
  "上证指数",
  "创业板指",
  "中证1000",
  "南华商品指数",
  "中证商品指数",
  "上证50",
  "中证2000",
] as const

/** Map a stored 团队基准 / 业绩基准 label to the product-page dropdown key. */
export function normalizeBenchmarkKey(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, "")
  if (!text) return ""
  if (text.includes("中证1000")) return "IM"
  if (text.includes("中证2000")) return "IM"
  if (text.includes("中证500")) return "IC"
  if (text.includes("沪深300")) return "IF"
  if (text.includes("上证50")) return "IH"
  if (text.includes("中证商品")) return "100001.CCI"
  if (text.includes("南华商品")) return "NHCI.NH"
  if (text.includes("国债")) return "511010.SH"
  if (text.includes("黄金")) return "518880.SH"
  return ""
}

function strategyDefaultBenchmarkKey(parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join("").replace(/\s+/g, "")
  if (!text) return ""
  if (/商品|期货|CTA|cta|管理期货/.test(text)) return "NHCI.NH"
  if (/股票|多头|指增|指数增强/.test(text)) return "IF"
  return ""
}

/** Prefer 团队基准; else 股票→沪深300, 商品/期货/CTA→南华商品指数. */
export function resolveDefaultBenchmarkKey(opts: {
  teamBenchmark?: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
  extraHints?: Array<string | null | undefined>
}): string {
  const teamKey = normalizeBenchmarkKey(opts.teamBenchmark)
  if (teamKey) return teamKey
  return strategyDefaultBenchmarkKey([
    opts.strategyL1,
    opts.strategyL2,
    opts.strategyL3,
    ...(opts.extraHints ?? []),
  ])
}
