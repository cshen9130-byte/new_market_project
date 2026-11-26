/** Benchmarks shown on the product page and 基金对比. Keys match `/ma/api/private-funds/benchmark`. */
export const PRIVATE_FUND_BENCHMARK_GROUP_ORDER = [
  "宽基指数",
  "风格指数",
  "大类指数",
  "债券指数",
  "其他",
] as const

export type PrivateFundBenchmarkGroup = (typeof PRIVATE_FUND_BENCHMARK_GROUP_ORDER)[number]

export const PRIVATE_FUND_BENCHMARK_OPTIONS = [
  { key: "", label: "不显示" },

  // 宽基指数 — Excel order first, then existing 宽基 not on that sheet.
  { key: "IH", label: "上证50", source: "spot", symbol: "IH", group: "宽基指数" },
  { key: "IF", label: "沪深300", source: "spot", symbol: "IF", group: "宽基指数" },
  { key: "IC", label: "中证500", source: "spot", symbol: "IC", group: "宽基指数" },
  { key: "IM", label: "中证1000", source: "spot", symbol: "IM", group: "宽基指数" },
  { key: "932000.CSI", label: "中证2000", source: "ashare", tsCode: "932000.CSI", group: "宽基指数" },
  { key: "399006.SZ", label: "创业板指", source: "ashare", tsCode: "399006.SZ", group: "宽基指数" },
  // Excel / 周度回顾 map 万得全A to 000985.SH, which is officially 中证全指.
  { key: "WIND_ALLA", label: "万得全A", source: "ashare", tsCode: "000985.SH", group: "宽基指数" },
  { key: "EQW.CN", label: "全A等权", source: "ashare", tsCode: "EQW.CN", group: "宽基指数" },
  { key: "000001.SH", label: "上证指数", source: "ashare", tsCode: "000001.SH", group: "宽基指数" },
  { key: "HSI.HI", label: "恒生指数", source: "ashare", tsCode: "HSI.HI", group: "宽基指数" },
  { key: "HSTECH.HI", label: "恒生科技", source: "ashare", tsCode: "HSTECH.HI", group: "宽基指数" },
  { key: "000510.SH", label: "中证A500", source: "ashare", tsCode: "000510.SH", group: "宽基指数" },
  { key: "000906.SH", label: "中证800", source: "ashare", tsCode: "000906.SH", group: "宽基指数" },
  { key: "000903.SH", label: "中证100", source: "ashare", tsCode: "000903.SH", group: "宽基指数" },
  { key: "000985.SH", label: "中证全指", source: "ashare", tsCode: "000985.SH", group: "宽基指数" },

  // 风格指数 — Excel 茅指数 listed BK9999.EM; East Money / 周度回顾 code is BK0999.EM.
  { key: "399372.SZ", label: "大盘成长", source: "ashare", tsCode: "399372.SZ", group: "风格指数" },
  { key: "399373.SZ", label: "大盘价值", source: "ashare", tsCode: "399373.SZ", group: "风格指数" },
  { key: "399374.SZ", label: "中盘成长", source: "ashare", tsCode: "399374.SZ", group: "风格指数" },
  { key: "399375.SZ", label: "中盘价值", source: "ashare", tsCode: "399375.SZ", group: "风格指数" },
  { key: "399376.SZ", label: "小盘成长", source: "ashare", tsCode: "399376.SZ", group: "风格指数" },
  { key: "399377.SZ", label: "小盘价值", source: "ashare", tsCode: "399377.SZ", group: "风格指数" },
  { key: "BK0999.EM", label: "茅指数", source: "ashare", tsCode: "BK0999.EM", group: "风格指数" },
  { key: "BK1000.EM", label: "宁组合", source: "ashare", tsCode: "BK1000.EM", group: "风格指数" },
  { key: "BK1158.EM", label: "微盘股指数", source: "ashare", tsCode: "BK1158.EM", group: "风格指数" },
  { key: "000015.SH", label: "红利指数", source: "ashare", tsCode: "000015.SH", group: "风格指数" },
  { key: "899050.BJ", label: "北证50", source: "ashare", tsCode: "899050.BJ", group: "风格指数" },
  { key: "000688.SH", label: "科创50", source: "ashare", tsCode: "000688.SH", group: "风格指数" },

  // 大类指数 — stored as equal-weight 申万一级 composites (same 口径 as 周度回顾).
  { key: "801271.SI", label: "周期", source: "ashare", tsCode: "801271.SI", group: "大类指数" },
  { key: "801272.SI", label: "先进制造", source: "ashare", tsCode: "801272.SI", group: "大类指数" },
  { key: "801273.SI", label: "消费", source: "ashare", tsCode: "801273.SI", group: "大类指数" },
  { key: "801275.SI", label: "科技TMT", source: "ashare", tsCode: "801275.SI", group: "大类指数" },
  { key: "801276.SI", label: "金融地产", source: "ashare", tsCode: "801276.SI", group: "大类指数" },
  { key: "801274.SI", label: "医药医疗", source: "ashare", tsCode: "801274.SI", group: "大类指数" },

  // 债券指数. ChinaBond wealth closes are CBA00xxx.CS; CSI / SSE bond indexes use their exchange codes.
  { key: "CBA00201.CS", label: "中债综合财富", source: "ashare", tsCode: "CBA00201.CS", group: "债券指数" },
  { key: "CBA00601.CS", label: "中债国债财富", source: "ashare", tsCode: "CBA00601.CS", group: "债券指数" },
  { key: "CBA02701.CS", label: "中债信用债财富", source: "ashare", tsCode: "CBA02701.CS", group: "债券指数" },
  { key: "H11001.CSI", label: "中证全债", source: "ashare", tsCode: "H11001.CSI", group: "债券指数" },
  { key: "H11006.CSI", label: "中证国债", source: "ashare", tsCode: "H11006.CSI", group: "债券指数" },
  { key: "000012.SH", label: "上证国债", source: "ashare", tsCode: "000012.SH", group: "债券指数" },
  { key: "000013.SH", label: "上证企债", source: "ashare", tsCode: "000013.SH", group: "债券指数" },
  { key: "000832.SH", label: "中证转债", source: "ashare", tsCode: "000832.SH", group: "债券指数" },
  { key: "511010.SH", label: "国债ETF", source: "etf", ticker: "511010.SH", group: "债券指数" },
  { key: "511260.SH", label: "十年国债ETF", source: "etf", ticker: "511260.SH", group: "债券指数" },

  // Existing options not on the Excel sheet.
  { key: "000902.SH", label: "中证流通", source: "ashare", tsCode: "000902.SH", group: "其他" },
  { key: "399303.SZ", label: "国证2000", source: "ashare", tsCode: "399303.SZ", group: "其他" },
  { key: "000922.SH", label: "中证红利", source: "ashare", tsCode: "000922.SH", group: "其他" },
  { key: "H00300.CSI", label: "沪深300全收益", source: "ashare", tsCode: "H00300.CSI", group: "其他" },
  { key: "NHCI.NH", label: "南华商品指数", source: "nanhua", code: "NHCI.NH", group: "其他" },
  { key: "100001.CCI", label: "中证商品指数", source: "ccidx", group: "其他" },
  { key: "CI011001.REBUILD", label: "全天候指数", source: "ci011001_rebuild", group: "其他" },
  { key: "518880.SH", label: "黄金ETF", source: "etf", ticker: "518880.SH", group: "其他" },
] as const

export type PrivateFundBenchmarkOption = (typeof PRIVATE_FUND_BENCHMARK_OPTIONS)[number]
export type PrivateFundBenchmarkKey = Exclude<PrivateFundBenchmarkOption["key"], "">
type LoadableBenchmarkOption = Exclude<PrivateFundBenchmarkOption, { key: "" }>

export function privateFundBenchmarkLabel(key: string, fallback = "业绩基准"): string {
  return PRIVATE_FUND_BENCHMARK_OPTIONS.find((option) => option.key === key)?.label ?? fallback
}

export function groupedPrivateFundBenchmarkOptions(): {
  group: PrivateFundBenchmarkGroup
  options: LoadableBenchmarkOption[]
}[] {
  return PRIVATE_FUND_BENCHMARK_GROUP_ORDER.map((group) => ({
    group,
    options: PRIVATE_FUND_BENCHMARK_OPTIONS.filter(
      (option): option is LoadableBenchmarkOption => option.key !== "" && "group" in option && option.group === group,
    ),
  })).filter((entry) => entry.options.length > 0)
}
