/**
 * Classify 泛国家队观察池 ETFs from official names.
 * Keep in sync with scripts/ma/national_team_universe.py
 */

export const NATIONAL_TEAM_POS_KEYWORDS = [
  "沪深300ETF",
  "上证50ETF",
  "中证500ETF",
  "中证1000ETF",
  "科创50ETF",
  "中证A500ETF",
  "A500ETF",
  "中证A50ETF",
  "A50ETF",
  "中国A50ETF",
] as const

export const NATIONAL_TEAM_NEG_KEYWORDS = [
  "增强",
  "成长",
  "价值",
  "红利",
  "ESG",
  "现金流",
  "低波",
  "低波动",
  "等权",
  "沪港深",
  "创业板",
  "民企",
  "港股",
  "AH",
  "债",
  "富时",
  "联接",
  "连接",
  "QDII",
  "货币",
  "黄金",
  "商品",
  "原油",
  "期货",
  "REIT",
  "REITs",
  "恒生",
  "纳斯达克",
  "标普",
  "日经",
  "国债",
  "可转债",
] as const

export function isNationalTeamEtf(...names: Array<string | null | undefined>): boolean {
  const text = names.filter(Boolean).join("")
  if (!text) return false
  const lower = text.toLowerCase()
  if (NATIONAL_TEAM_NEG_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return false
  return NATIONAL_TEAM_POS_KEYWORDS.some((k) => text.includes(k))
}

export const NATIONAL_TEAM_UNIVERSE_NOTE =
  "观察池为沪深300、上证50、中证500、中证1000、科创50、中证A500/中证A50 等宽基ETF（不含增强、风格、富时A50、沪港深及行业主题）。净申赎估算 = 份额变动 × 当日净值（无净值时用收盘价）。"

