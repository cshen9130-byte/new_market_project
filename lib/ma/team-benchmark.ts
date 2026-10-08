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
  if (text.includes("沪深300全收益")) return "H00300.CSI"
  if (text.includes("中证1000") || text.includes("1000指增")) return "IM"
  if (text.includes("中证2000")) return "IM"
  if (text.includes("中证800")) return "000906.SH"
  if (text.includes("中证A500") || text.includes("中证a500") || text.includes("A500指增")) return "000510.SH"
  if (text.includes("中证500") || text.includes("500指增")) return "IC"
  if (text.includes("中证100") || text.includes("中证A100")) return "000903.SH"
  if (text.includes("中证全指")) return "000985.SH"
  if (text.includes("中证流通")) return "000902.SH"
  if (text.includes("中证转债") || text.includes("中证可转债")) return "000832.SH"
  if (text.includes("中证国债")) return "H11006.CSI"
  if (text.includes("国证2000")) return "399303.SZ"
  if (text.includes("中证红利")) return "000922.SH"
  if (text.includes("科创50")) return "000688.SH"
  if (text.includes("北证50")) return "899050.BJ"
  if (text.includes("恒生指数")) return "HSI.HI"
  if (text.includes("沪深300") || text.includes("300指增")) return "IF"
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
  // Match the index in the strategy label before the generic equity fallback.
  // Otherwise 1000指增 / 500指增 all resolve to 沪深300.
  // A500指增 contains "500指增", so the longer label is checked first.
  if (/1000指增|中证1000/.test(text)) return "IM"
  if (/A500指增|中证A500/i.test(text)) return "000510.SH"
  if (/500指增|中证500/.test(text)) return "IC"
  if (/300指增|沪深300/.test(text)) return "IF"
  if (/股票|多头|指增|指数增强/.test(text)) return "IF"
  return ""
}

/** Prefer 团队基准; else index-specific 指增, else 股票→沪深300, 商品/期货/CTA→南华商品指数. */
export function resolveDefaultBenchmarkKey(opts: {
  teamBenchmark?: string | null
  benchmark?: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
  productName?: string | null
  extraHints?: Array<string | null | undefined>
}): string {
  const teamKey = normalizeBenchmarkKey(opts.teamBenchmark)
  if (teamKey) return teamKey
  const inferred = strategyDefaultBenchmarkKey([
    opts.strategyL1,
    opts.strategyL2,
    opts.strategyL3,
    opts.productName,
    ...(opts.extraHints ?? []),
  ])
  if (inferred) return inferred
  return normalizeBenchmarkKey(opts.benchmark)
}
