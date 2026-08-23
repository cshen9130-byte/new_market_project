export const SCALE_INDEX_WINDOWS = [10, 20, 40, 60] as const
export type ScaleIndexWindow = (typeof SCALE_INDEX_WINDOWS)[number]

export const SCALE_INDEX_FREQS = [
  { id: "d", label: "日频", periods: 252 },
  { id: "w", label: "周频", periods: 52 },
  { id: "m", label: "月频", periods: 12 },
] as const
export type ScaleIndexFreq = (typeof SCALE_INDEX_FREQS)[number]["id"]

export const SCALE_INDICES = [
  { id: "hs300", name: "沪深300", color: "#2563eb", dbSymbol: "IF", sina: "sh000300", qq: "sh000300", tsCode: "000300.SH" },
  { id: "zz500", name: "中证500", color: "#f97316", dbSymbol: "IC", sina: "sh000905", qq: "sh000905", tsCode: "000905.SH" },
  { id: "zz1000", name: "中证1000", color: "#06b6d4", dbSymbol: "IM", sina: "sh000852", qq: "sh000852", tsCode: "000852.SH" },
  { id: "zz2000", name: "中证2000", color: "#8b5cf6", dbSymbol: null, sina: "sz399303", qq: "sz399303", tsCode: "399303.SZ" },
  { id: "sz50", name: "上证50", color: "#be123c", dbSymbol: "IH", sina: "sh000016", qq: "sh000016", tsCode: "000016.SH" },
  { id: "zzqz", name: "中证全指", color: "#84cc16", dbSymbol: null, sina: null, qq: "sh000985", tsCode: "000985.SH" },
] as const

export type ScaleIndexId = (typeof SCALE_INDICES)[number]["id"]

export type ScaleIndexPoint = { date: string; close: number }

export type ScaleIndexSeries = {
  id: ScaleIndexId
  name: string
  color: string
  points: ScaleIndexPoint[]
}

export type ScaleIndexValuePoint = { date: string; value: number }

export type ScaleIndexBeatSeries = {
  id: ScaleIndexId
  name: string
  color: string
  points: ScaleIndexValuePoint[]
}
