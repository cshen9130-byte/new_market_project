export type MarketEventImpact = "high" | "medium" | "low" | "holiday"
export type MarketEventRegion = "CN" | "US" | "EU" | "JP" | "GLOBAL"
export type MarketEventCategory = "央行" | "通胀" | "就业" | "增长" | "政策" | "休市" | "政治" | "商品"
export type MarketEventSeries =
  | "fomc"
  | "ecb"
  | "boj"
  | "lpr"
  | "mlf"
  | "nfp"
  | "cpi"
  | "ppi"
  | "pmi-nbs"
  | "pmi-caixin"
  | "cn-gdp"
  | "us-gdp"
  | "us-midterm"
  | "cn-cewc"
  | "holiday"
  | "us-import-px"
  | "other"

export type MarketEvent = {
  id: string
  /** Beijing calendar date YYYY-MM-DD */
  date: string
  /** Beijing clock HH:mm, empty = all-day */
  time: string
  timeNote?: string
  region: MarketEventRegion
  category: MarketEventCategory
  series: MarketEventSeries
  /** Official local announcement date YYYY-MM-DD */
  officialDate: string
  title: string
  summary: string
  markets: string[]
  impact: MarketEventImpact
  tentative?: boolean
  outcome?: string
  actual?: string
  forecast?: string
  previous?: string
  source?: string
}

export const SERIES_DETAIL: Record<
  MarketEventSeries,
  { label: string; watchPoints: string[]; whyItMatters: string; source: string; sourceUrl?: string }
> = {
  fomc: {
    label: "美联储 FOMC",
    watchPoints: [
      "联邦基金利率是否变动，以及点阵图对年内路径的修正",
      "声明对通胀、就业与“价格稳定”措辞的松紧",
      "主席发布会是否强调数据依赖、还是打开加息/降息窗口",
    ],
    whyItMatters:
      "全球利率锚。决议与点阵图会立刻重定价美债、美元、黄金与风险资产，并传导到 A 股风险偏好和国内利率预期。",
    source: "美联储官网",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  },
  ecb: {
    label: "欧洲央行",
    watchPoints: ["三大政策利率是否同步调整", "员工预测中的通胀与增长路径", "拉加德对后续路径是否“不预设”"],
    whyItMatters: "欧元区利率决议影响欧元、欧债，并与美联储政策差一起驱动美元和全球债券。",
    source: "欧洲央行",
    sourceUrl: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
  },
  boj: {
    label: "日本央行",
    watchPoints: ["政策利率与国债购买节奏", "展望报告对物价、工资的判断", "是否暗示退出宽松或干预日元"],
    whyItMatters: "日元与全球套息交易的核心节点，决议常带动美债、黄金和亚洲风险资产联动。",
    source: "日本银行",
    sourceUrl: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm",
  },
  lpr: {
    label: "中国 LPR",
    watchPoints: ["1年期与5年期以上 LPR 是否下调", "是否与当月 MLF 利率同向", "对房贷与信贷需求的指向"],
    whyItMatters: "国内信贷定价锚，变动会直接影响利率债、银行股和房地产链，并影响人民币预期。",
    source: "全国银行间同业拆借中心",
  },
  mlf: {
    label: "中国 MLF",
    watchPoints: ["操作量和中标利率", "是否在 LPR 报价前释放宽松/收紧信号"],
    whyItMatters: "银行中期负债成本的观察窗口，常领先或确认当月 LPR，扰动债市情绪。",
    source: "中国人民银行",
  },
  nfp: {
    label: "美国非农",
    watchPoints: ["新增非农是否显著偏离预期", "失业率与劳动参与率", "平均时薪同比/环比"],
    whyItMatters: "美联储双使命中的就业一侧。超预期强（弱）会推升（压低）加息概率，冲击美债和美元。",
    source: "美国劳工统计局",
    sourceUrl: "https://www.bls.gov/schedule/news_release/empsit.htm",
  },
  cpi: {
    label: "美国 CPI",
    watchPoints: ["季调环比与同比", "核心 CPI（除食品能源）", "房租、能源对抬头的贡献"],
    whyItMatters: "最受交易关注的通胀读数，直接牵引实际利率、降息/加息赔率和黄金定价。",
    source: "美国劳工统计局",
    sourceUrl: "https://www.bls.gov/schedule/news_release/cpi.htm",
  },
  ppi: {
    label: "美国 PPI",
    watchPoints: ["最终需求 PPI 环比", "核心 PPI 与可传导至 PCE 的分项"],
    whyItMatters: "生产者价格常领先 CPI/PCE。超预期时会提前移动利率定价，尤其在 FOMC 前一周。",
    source: "美国劳工统计局",
    sourceUrl: "https://www.bls.gov/schedule/news_release/ppi.htm",
  },
  "pmi-nbs": {
    label: "中国官方 PMI",
    watchPoints: ["制造业 PMI 是否站上/跌破 50", "新订单、生产与价格指数分项", "与财新 PMI 是否背离"],
    whyItMatters: "国内月度景气的第一枪，影响周期股、黑色/有色和国债避险需求。",
    source: "国家统计局",
  },
  "pmi-caixin": {
    label: "财新 PMI",
    watchPoints: ["是否与官方 PMI 方向一致", "中小企业与出口相关分项"],
    whyItMatters: "更贴近沿海出口与中小企业，常用来交叉验证官方景气读数。",
    source: "财新/S&P Global",
  },
  "cn-gdp": {
    label: "中国 GDP / 经济数据",
    watchPoints: ["当季 GDP 同比", "工业增加值、社零、固投是否同步走弱/走强", "是否打开增量政策窗口"],
    whyItMatters: "国内增长的阶段性定调，影响 A 股风险偏好、人民币和工业品需求预期。",
    source: "国家统计局",
  },
  "us-gdp": {
    label: "美国 GDP",
    watchPoints: ["实际 GDP 年化环比", "消费与投资分项", "是否改变软着陆叙事"],
    whyItMatters: "增长一侧的官方读数，与通胀一起决定美联储反应函数。",
    source: "美国经济分析局",
    sourceUrl: "https://www.bea.gov/data/gdp/gross-domestic-product",
  },
  "us-midterm": {
    label: "美国中期选举",
    watchPoints: ["国会两院控制权", "财政、关税与监管预期是否切换", "选举夜风险资产波动"],
    whyItMatters: "政策不确定性事件。结果会重塑财政路径、关税和监管溢价。",
    source: "美国选举日程",
  },
  "cn-cewc": {
    label: "中央经济工作会议",
    watchPoints: ["来年增长目标措辞", "财政与货币政策取向", "是否强调内需、地产或科技"],
    whyItMatters: "年末政策总纲，对次年股债风格和人民币预期有中期影响。",
    source: "新华社通稿",
  },
  other: {
    label: "宏观事件",
    watchPoints: ["今值是否偏离预期与前值", "是否改变利率或增长叙事", "公布后股债汇是否同步定价"],
    whyItMatters: "财经日历中的宏观或政策事件，可能扰动利率、汇率与风险资产定价。",
    source: "华尔街见闻财经日历",
    sourceUrl: "https://wallstreetcn.com/calendar",
  },
  holiday: {
    label: "市场休市",
    watchPoints: ["休市时长与外盘是否仍交易", "开盘后缺口与流动性", "假期前后仓位与对冲安排"],
    whyItMatters: "无法在本地日盘对冲隔夜波动。长假后常出现跳空，商品和股指期货波动放大。",
    source: "交易所休市安排",
  },
  "us-import-px": {
    label: "美国进出口价格",
    watchPoints: ["进口价格环比", "燃料与非燃料分项", "关税是否已体现在价格中"],
    whyItMatters: "商品与关税通胀的高频窗口，影响力弱于 CPI，但在贸易摩擦阶段会被放大交易。",
    source: "美国劳工统计局",
  },
}

export const REGION_LABEL: Record<MarketEventRegion, string> = {
  CN: "中国",
  US: "美国",
  EU: "欧元区",
  JP: "日本",
  GLOBAL: "全球",
}

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"]

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return { y, m, d }
}

function isoFromParts(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
}

export function addIsoDays(iso: string, days: number): string {
  const { y, m, d } = parseIso(iso)
  return isoFromParts(y, m, d + days)
}

export function weekdayUtc(iso: string): number {
  const { y, m, d } = parseIso(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function formatWeekdayCn(iso: string): string {
  return `周${WEEKDAY_CN[weekdayUtc(iso)]}`
}

export function formatDateCn(iso: string): string {
  const { m, d } = parseIso(iso)
  return `${m}月${d}日`
}

export function groupEventsByDate(events: MarketEvent[]): { date: string; events: MarketEvent[] }[] {
  const map = new Map<string, MarketEvent[]>()
  for (const item of events) {
    const list = map.get(item.date) ?? []
    list.push(item)
    map.set(item.date, list)
  }
  return [...map.entries()].map(([date, items]) => ({ date, events: items }))
}

export function formatEventPrints(event: MarketEvent): string | null {
  const parts: string[] = []
  if (event.actual) parts.push(`今值 ${event.actual}`)
  if (event.forecast) parts.push(`预期 ${event.forecast}`)
  if (event.previous) parts.push(`前值 ${event.previous}`)
  if (parts.length) return parts.join(" · ")
  return event.outcome || null
}

export function listRelatedEvents(event: MarketEvent, all: MarketEvent[], limit = 6): MarketEvent[] {
  if (event.series === "other") return []
  return all
    .filter((item) => item.series === event.series && item.id !== event.id)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return (b.time || "").localeCompare(a.time || "")
    })
    .slice(0, limit)
}

export function isPastEvent(event: MarketEvent, today: string): boolean {
  return event.date < today
}
