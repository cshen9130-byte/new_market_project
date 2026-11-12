/** Benchmarks shown on the product page and 基金对比. Keys match `/ma/api/private-funds/benchmark`. */
export const PRIVATE_FUND_BENCHMARK_OPTIONS = [
  { key: "", label: "不显示" },
  { key: "IM", label: "中证1000", source: "spot", symbol: "IM" },
  { key: "932000.CSI", label: "中证2000", source: "ashare", tsCode: "932000.CSI" },
  { key: "IC", label: "中证500", source: "spot", symbol: "IC" },
  { key: "IF", label: "沪深300", source: "spot", symbol: "IF" },
  { key: "IH", label: "上证50", source: "spot", symbol: "IH" },
  { key: "000001.SH", label: "上证指数", source: "ashare", tsCode: "000001.SH" },
  { key: "000906.SH", label: "中证800", source: "ashare", tsCode: "000906.SH" },
  { key: "000903.SH", label: "中证100", source: "ashare", tsCode: "000903.SH" },
  { key: "000688.SH", label: "科创50", source: "ashare", tsCode: "000688.SH" },
  { key: "000510.SH", label: "中证A500", source: "ashare", tsCode: "000510.SH" },
  { key: "000985.SH", label: "中证全指", source: "ashare", tsCode: "000985.SH" },
  { key: "000902.SH", label: "中证流通", source: "ashare", tsCode: "000902.SH" },
  { key: "000832.SH", label: "中证转债", source: "ashare", tsCode: "000832.SH" },
  { key: "H11006.CSI", label: "中证国债", source: "ashare", tsCode: "H11006.CSI" },
  { key: "399303.SZ", label: "国证2000", source: "ashare", tsCode: "399303.SZ" },
  { key: "000922.SH", label: "中证红利", source: "ashare", tsCode: "000922.SH" },
  { key: "899050.BJ", label: "北证50", source: "ashare", tsCode: "899050.BJ" },
  { key: "HSI.HI", label: "恒生指数", source: "ashare", tsCode: "HSI.HI" },
  { key: "H00300.CSI", label: "沪深300全收益", source: "ashare", tsCode: "H00300.CSI" },
  { key: "NHCI.NH", label: "南华商品指数", source: "nanhua", code: "NHCI.NH" },
  { key: "100001.CCI", label: "中证商品指数", source: "ccidx" },
  { key: "CI011001.REBUILD", label: "全天候指数", source: "ci011001_rebuild" },
  { key: "511010.SH", label: "国债ETF", source: "etf", ticker: "511010.SH" },
  { key: "518880.SH", label: "黄金ETF", source: "etf", ticker: "518880.SH" },
] as const

export type PrivateFundBenchmarkOption = (typeof PRIVATE_FUND_BENCHMARK_OPTIONS)[number]
export type PrivateFundBenchmarkKey = Exclude<PrivateFundBenchmarkOption["key"], "">

export function privateFundBenchmarkLabel(key: string, fallback = "业绩基准"): string {
  return PRIVATE_FUND_BENCHMARK_OPTIONS.find((option) => option.key === key)?.label ?? fallback
}
