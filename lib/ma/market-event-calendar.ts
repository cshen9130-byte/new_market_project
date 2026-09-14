import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  addIsoDays,
  formatDateCn,
  type MarketEvent,
  type MarketEventRegion,
} from "@/lib/ma/market-event-calendar-shared"

export type {
  MarketEvent,
  MarketEventCategory,
  MarketEventImpact,
  MarketEventRegion,
} from "@/lib/ma/market-event-calendar-shared"
export {
  REGION_LABEL,
  addIsoDays,
  formatDateCn,
  formatWeekdayCn,
  groupEventsByDate,
} from "@/lib/ma/market-event-calendar-shared"

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return { y, m, d }
}

function isoFromParts(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
}

function weekdayUtc(iso: string): number {
  const { y, m, d } = parseIso(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const first = isoFromParts(year, month, 1)
  const offset = (weekday - weekdayUtc(first) + 7) % 7
  return isoFromParts(year, month, 1 + offset + (n - 1) * 7)
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = isoFromParts(year, month + 1, 0)
  const back = (weekdayUtc(last) - weekday + 7) % 7
  return addIsoDays(last, -back)
}

function lastDayOfMonth(year: number, month: number): string {
  return isoFromParts(year, month + 1, 0)
}

function isUsEasternDst(iso: string): boolean {
  const { y } = parseIso(iso)
  const start = nthWeekdayOfMonth(y, 3, 0, 2)
  const end = nthWeekdayOfMonth(y, 11, 0, 1)
  return iso >= start && iso < end
}

function isEuropeSummerTime(iso: string): boolean {
  const { y } = parseIso(iso)
  const start = lastWeekdayOfMonth(y, 3, 0)
  const end = lastWeekdayOfMonth(y, 10, 0)
  return iso >= start && iso < end
}

function shiftClock(date: string, time: string, hours: number): { date: string; time: string } {
  const { y, m, d } = parseIso(date)
  const [hh, mm] = time.split(":").map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d, hh + hours, mm || 0))
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  }
}

function etToBeijing(etDate: string, etTime: string): { date: string; time: string } {
  return shiftClock(etDate, etTime, isUsEasternDst(etDate) ? 12 : 13)
}

function cetToBeijing(cetDate: string, cetTime: string): { date: string; time: string } {
  return shiftClock(cetDate, cetTime, isEuropeSummerTime(cetDate) ? 6 : 7)
}

function nextChinaTradingDay(iso: string): string {
  let cursor = iso
  for (let i = 0; i < 10; i++) {
    if (isChinaTradingDay(cursor)) return cursor
    cursor = addIsoDays(cursor, 1)
  }
  return iso
}

function previousChinaTradingDay(iso: string): string {
  let cursor = iso
  for (let i = 0; i < 10; i++) {
    if (isChinaTradingDay(cursor)) return cursor
    cursor = addIsoDays(cursor, -1)
  }
  return iso
}

const EVENT_OUTCOMES: Record<string, string> = {
  "fomc:2026-07-29":
    "维持联邦基金利率 3.50%–3.75%，表决 9–3。克利夫兰、明尼阿波利斯、达拉斯三位地区联储主席主张加息 25bp。声明称通胀仍高于 2% 目标。",
  "nfp:2026-09-04":
    "8月非农新增 16.2 万人，失业率持平 4.1%。薪资同比约 3.1%。读数明显强于市场预期，加息赔率上升。",
  "cpi:2026-09-11":
    "8月 CPI 环比 +0.4%、同比 +3.4%；核心环比 +0.3%、同比 +2.4%。为 9月 FOMC 前最后一份关键通胀。",
  "ecb:2026-09-10":
    "三大政策利率上调 25bp：存款便利 2.50%、主要再融资 2.65%、边际贷款 2.90%，9月16日起生效。强调中东冲突仍带来通胀压力，不预设后续路径。",
}

function event(
  partial: Omit<MarketEvent, "id" | "outcome"> & { id?: string },
): MarketEvent {
  const id =
    partial.id ??
    `${partial.date}-${partial.region}-${partial.title}`.replace(/\s+/g, "")
  const outcome = EVENT_OUTCOMES[`${partial.series}:${partial.officialDate}`]
  return { ...partial, id, outcome }
}

/** Official FOMC decision day (US local). Statement 14:00 ET, presser 14:30 ET. */
const FOMC_DECISION_DAYS: { date: string; sep: boolean }[] = [
  { date: "2026-01-28", sep: false },
  { date: "2026-03-18", sep: true },
  { date: "2026-04-29", sep: false },
  { date: "2026-06-17", sep: true },
  { date: "2026-07-29", sep: false },
  { date: "2026-09-16", sep: true },
  { date: "2026-10-28", sep: false },
  { date: "2026-12-09", sep: true },
  { date: "2027-01-27", sep: false },
]

/** ECB rate decision day (Thursday, 14:15 CET). */
const ECB_DECISION_DAYS = [
  "2026-02-05",
  "2026-03-19",
  "2026-04-30",
  "2026-06-11",
  "2026-07-23",
  "2026-09-10",
  "2026-10-29",
  "2026-12-17",
  "2027-02-04",
]

/** BoJ statement day, ~11:00 JST. */
const BOJ_DECISION_DAYS: { date: string; outlook: boolean }[] = [
  { date: "2026-01-23", outlook: true },
  { date: "2026-03-19", outlook: false },
  { date: "2026-04-28", outlook: true },
  { date: "2026-06-16", outlook: false },
  { date: "2026-07-31", outlook: true },
  { date: "2026-09-18", outlook: false },
  { date: "2026-10-30", outlook: true },
  { date: "2026-12-18", outlook: false },
]

type BlsRow = { date: string; ref: string }

const NFP_RELEASES: BlsRow[] = [
  { date: "2026-06-05", ref: "5月" },
  { date: "2026-07-02", ref: "6月" },
  { date: "2026-08-07", ref: "7月" },
  { date: "2026-09-04", ref: "8月" },
  { date: "2026-10-02", ref: "9月" },
  { date: "2026-11-06", ref: "10月" },
  { date: "2026-12-04", ref: "11月" },
]

const CPI_RELEASES: BlsRow[] = [
  { date: "2026-06-10", ref: "5月" },
  { date: "2026-07-14", ref: "6月" },
  { date: "2026-08-12", ref: "7月" },
  { date: "2026-09-11", ref: "8月" },
  { date: "2026-10-14", ref: "9月" },
  { date: "2026-11-10", ref: "10月" },
  { date: "2026-12-10", ref: "11月" },
]

const PPI_RELEASES: BlsRow[] = [
  { date: "2026-08-13", ref: "7月" },
  { date: "2026-09-10", ref: "8月" },
  { date: "2026-10-15", ref: "9月" },
  { date: "2026-11-13", ref: "10月" },
  { date: "2026-12-15", ref: "11月" },
]

const HOLIDAY_RANGES: { start: string; end: string; title: string; region: MarketEventRegion; summary: string; markets: string[] }[] = [
  {
    start: "2026-06-19",
    end: "2026-06-21",
    title: "A股/国内期货休市：端午节",
    region: "CN",
    summary: "沪深北交易所与国内商品/金融期货休市。",
    markets: ["A股", "国内期货"],
  },
  {
    start: "2026-09-07",
    end: "2026-09-07",
    title: "美国劳工节休市",
    region: "US",
    summary: "美股全日休市，美债与部分商品期货缩短或休市。",
    markets: ["美股", "美债"],
  },
  {
    start: "2026-09-25",
    end: "2026-09-27",
    title: "A股/国内期货休市：中秋节",
    region: "CN",
    summary: "沪深北交易所与国内商品/金融期货休市，隔夜外盘波动无法在日盘对冲。",
    markets: ["A股", "国内期货", "商品"],
  },
  {
    start: "2026-10-01",
    end: "2026-10-07",
    title: "A股/国内期货休市：国庆节",
    region: "CN",
    summary: "长假期间外盘与商品波动常在开盘后集中释放，注意缺口与流动性。",
    markets: ["A股", "国内期货", "商品"],
  },
  {
    start: "2026-11-26",
    end: "2026-11-26",
    title: "美国感恩节休市",
    region: "US",
    summary: "美股全日休市，美债与部分商品期货缩短交易时段。",
    markets: ["美股", "美债", "美元"],
  },
  {
    start: "2026-11-27",
    end: "2026-11-27",
    title: "美国感恩节次日缩短交易",
    region: "US",
    summary: "美股提前收盘，流动性偏薄，价格更容易被少量成交带动。",
    markets: ["美股", "美债"],
  },
  {
    start: "2026-12-25",
    end: "2026-12-25",
    title: "圣诞节：欧美主要市场休市",
    region: "GLOBAL",
    summary: "欧美股市休市，跨市场定价减弱，商品与汇率波动可能失真。",
    markets: ["美股", "欧股", "商品"],
  },
  {
    start: "2027-01-01",
    end: "2027-01-01",
    title: "元旦休市",
    region: "GLOBAL",
    summary: "中美等多地市场休市或缩短交易。",
    markets: ["A股", "美股", "国内期货"],
  },
]

function buildFixedEvents(): MarketEvent[] {
  const out: MarketEvent[] = []

  for (const row of FOMC_DECISION_DAYS) {
    const bj = etToBeijing(row.date, "14:00")
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: `美东 ${row.date.slice(5).replace("-", "/")} 14:00`,
        region: "US",
        category: "央行",
        series: "fomc",
        officialDate: row.date,
        title: row.sep ? "FOMC 利率决议 + 经济预测/点阵图" : "FOMC 利率决议",
        summary: row.sep
          ? "公布联邦基金利率、经济预测与点阵图，主席随后召开新闻发布会，常引发美债、美元与全球风险资产重定价。"
          : "公布联邦基金利率并召开新闻发布会，指引美债收益率、美元与全球风险偏好。",
        markets: ["美债", "美元", "黄金", "美股", "全球风险资产"],
        impact: "high",
      }),
    )
  }

  for (const date of ECB_DECISION_DAYS) {
    const bj = cetToBeijing(date, "14:15")
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: `欧洲 ${date.slice(5).replace("-", "/")} 14:15`,
        region: "EU",
        category: "央行",
        series: "ecb",
        officialDate: date,
        title: "欧洲央行利率决议",
        summary: "公布主要再融资利率，拉加德随后召开新闻发布会，影响欧元、欧债与全球利率预期。",
        markets: ["欧元", "欧债", "美债", "欧股"],
        impact: "high",
      }),
    )
  }

  for (const row of BOJ_DECISION_DAYS) {
    const bj = shiftClock(row.date, "11:00", -1)
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: "东京 11:00",
        region: "JP",
        category: "央行",
        series: "boj",
        officialDate: row.date,
        title: row.outlook ? "日本央行利率决议 + 展望报告" : "日本央行利率决议",
        summary: row.outlook
          ? "公布政策利率并发布《经济物价展望》，对日元、日债与全球套息交易敏感。"
          : "公布政策利率与购债指引，日元与日债常出现跳价。",
        markets: ["日元", "日债", "美债", "黄金"],
        impact: "high",
      }),
    )
  }

  for (const row of NFP_RELEASES) {
    const bj = etToBeijing(row.date, "08:30")
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: "美东 08:30",
        region: "US",
        category: "就业",
        series: "nfp",
        officialDate: row.date,
        title: `美国非农就业（${row.ref}）`,
        summary: "新增非农、失业率与薪资增速，是美联储政策路径的核心高频信号。",
        markets: ["美债", "美元", "黄金", "美股"],
        impact: "high",
      }),
    )
  }

  for (const row of CPI_RELEASES) {
    const bj = etToBeijing(row.date, "08:30")
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: "美东 08:30",
        region: "US",
        category: "通胀",
        series: "cpi",
        officialDate: row.date,
        title: `美国 CPI（${row.ref}）`,
        summary: "整体与核心 CPI 同比/环比，直接牵引降息预期和实际利率。",
        markets: ["美债", "美元", "黄金", "美股"],
        impact: "high",
      }),
    )
  }

  for (const row of PPI_RELEASES) {
    const bj = etToBeijing(row.date, "08:30")
    out.push(
      event({
        date: bj.date,
        time: bj.time,
        timeNote: "美东 08:30",
        region: "US",
        category: "通胀",
        series: "ppi",
        officialDate: row.date,
        title: `美国 PPI（${row.ref}）`,
        summary: "生产者价格常领先 CPI，超预期时会提前扰动利率定价。",
        markets: ["美债", "美元"],
        impact: "medium",
      }),
    )
  }

  const gdpQ3 = etToBeijing("2026-10-29", "08:30")
  out.push(
    event({
      date: gdpQ3.date,
      time: gdpQ3.time,
      timeNote: "美东 08:30",
      region: "US",
      category: "增长",
      series: "us-gdp",
      officialDate: "2026-10-29",
      title: "美国三季度 GDP（初值）",
      summary: "三季度实际 GDP 初值，影响增长预期与美联储反应函数。",
      markets: ["美股", "美债", "美元"],
      impact: "high",
    }),
  )

  out.push(
    event({
      date: "2026-11-03",
      time: "",
      region: "US",
      category: "政治",
      series: "us-midterm",
      officialDate: "2026-11-03",
      title: "美国中期选举",
      summary: "国会控制权将影响财政、关税与监管预期，选举夜常出现跨资产波动。",
      markets: ["美股", "美元", "美债", "黄金"],
      impact: "high",
    }),
  )

  const importPx = etToBeijing("2026-09-16", "08:30")
  out.push(
    event({
      date: importPx.date,
      time: importPx.time,
      timeNote: "美东 08:30",
      region: "US",
      category: "通胀",
      series: "us-import-px",
      officialDate: "2026-09-16",
      title: "美国进出口价格指数（8月）",
      summary: "进口价格是关税与商品通胀的高频观察窗口，通常弱于 CPI/非农。",
      markets: ["美债", "美元"],
      impact: "medium",
    }),
  )

  out.push(
    event({
      date: "2026-10-20",
      time: "10:00",
      region: "CN",
      category: "增长",
      series: "cn-gdp",
      officialDate: "2026-10-20",
      title: "中国三季度 GDP / 9月经济数据",
      summary: "GDP、工业增加值、社零与固投通常同日发布，定调国内增长与政策力度。",
      markets: ["A股", "人民币", "商品", "国债"],
      impact: "high",
      tentative: true,
    }),
  )

  out.push(
    event({
      date: "2026-12-11",
      time: "",
      region: "CN",
      category: "政策",
      series: "cn-cewc",
      officialDate: "2026-12-11",
      title: "中央经济工作会议（窗口）",
      summary: "年末定调来年增长目标、财政与货币取向，对股债与风险偏好影响大。具体开会日以新华社通稿为准。",
      markets: ["A股", "国债", "人民币"],
      impact: "high",
      tentative: true,
    }),
  )

  return out
}

function buildRecurringChinaEvents(from: string, to: string): MarketEvent[] {
  const start = parseIso(from)
  const end = parseIso(to)
  const out: MarketEvent[] = []
  let y = start.y
  let m = start.m
  while (y < end.y || (y === end.y && m <= end.m + 1)) {
    const lprRaw = isoFromParts(y, m, 20)
    const lprDate = nextChinaTradingDay(lprRaw)
    out.push(
      event({
        date: lprDate,
        time: "09:15",
        region: "CN",
        category: "央行",
        series: "lpr",
        officialDate: lprDate,
        title: `${m}月 LPR 报价`,
        summary: "1年期与5年期以上贷款市场报价利率，是国内信贷定价与债市的政策锚。",
        markets: ["国债", "利率债", "人民币", "A股"],
        impact: "medium",
      }),
    )

    const mlfRaw = isoFromParts(y, m, 15)
    const mlfDate = previousChinaTradingDay(mlfRaw)
    out.push(
      event({
        date: mlfDate,
        time: "09:15",
        region: "CN",
        category: "央行",
        series: "mlf",
        officialDate: mlfDate,
        title: `${m}月 MLF 操作`,
        summary: "中期借贷便利量价常与当月 LPR 联动，影响银行负债成本与债市情绪。",
        markets: ["国债", "利率债"],
        impact: "medium",
      }),
    )

    const pmiDate = previousChinaTradingDay(lastDayOfMonth(y, m))
    out.push(
      event({
        date: pmiDate,
        time: "09:30",
        region: "CN",
        category: "增长",
        series: "pmi-nbs",
        officialDate: pmiDate,
        title: `官方制造业 PMI（${m}月）`,
        summary: "荣枯线上下的方向比读数更重要，影响周期品、工业金属与A股风险偏好。",
        markets: ["A股", "黑色", "有色", "国债"],
        impact: "high",
      }),
    )

    const caixinDate = isoFromParts(y, m + 1, 1)
    out.push(
      event({
        date: caixinDate,
        time: "09:45",
        region: "CN",
        category: "增长",
        series: "pmi-caixin",
        officialDate: caixinDate,
        title: `财新制造业 PMI（${m}月）`,
        summary: "更侧重中小企业与沿海出口部门，常与官方 PMI 形成对照。",
        markets: ["A股", "人民币", "商品"],
        impact: "medium",
      }),
    )

    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function buildHolidayEvents(from: string, to: string): MarketEvent[] {
  return HOLIDAY_RANGES.flatMap((row) => {
    if (row.end < from || row.start > to) return []
    const visibleDate = row.start < from ? from : row.start
    return [
      event({
        date: visibleDate,
        time: "",
        timeNote: row.start === row.end ? undefined : `${formatDateCn(row.start)}–${formatDateCn(row.end)}`,
        region: row.region,
        category: "休市",
        series: "holiday",
        officialDate: row.start,
        title: row.title,
        summary: row.summary,
        markets: row.markets,
        impact: "holiday",
      }),
    ]
  })
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

export function listMarketEvents(opts: { from: string; to: string }): MarketEvent[] {
  const from = opts.from.slice(0, 10)
  const to = opts.to.slice(0, 10)
  const seen = new Set<string>()
  const all = [
    ...buildFixedEvents(),
    ...buildRecurringChinaEvents(from, to),
    ...buildHolidayEvents(from, to),
  ]
  const filtered = all.filter((item) => inRange(item.date, from, to))
  filtered.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return (a.time || "99:99").localeCompare(b.time || "99:99")
  })
  return filtered.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
