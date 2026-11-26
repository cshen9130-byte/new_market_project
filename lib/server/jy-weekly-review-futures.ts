/**
 * JY 跟踪池周度回顾（期货）Excel.
 * 量化期货 8 sheets + 主观期货 6 sheets.
 * 目录 + 口径说明 + 期货市场回顾 stay in front.
 */

import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fmtIso, n, query } from "@/lib/db"
import { formatWeekReturnTopShare, mergeWeeklyReviewInvestedRows, weekReturnTopShare } from "@/lib/ma/weekly-review-invested-median"
import { takeBestByWeek } from "@/lib/ma/weekly-review-public-rows"
import { joinWeeklyRowSources, WEEKLY_ROW_SOURCE, xiaoheNameKey, type WeeklyRowSource } from "@/lib/ma/xiaohe-weekly-rows"
import { parseStrategyLevel3 } from "@/lib/ma/strategy-level3"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import { loadFuturesExternalRows, type FuturesExternalRow } from "@/lib/server/futures-weekly-external-rows"
import {
  normalizeWeeklyReviewPools,
  weeklyReviewPoolFileLabel,
  weeklyReviewPoolScopePhrase,
} from "@/lib/ma/weekly-review-pools"
import {
  aggregateMetrics,
  buildSourceStatSheet,
  collapseWeeklyReviewFunds,
  collectSourceMedianMemberships,
  computeFundMetrics,
  isValidWeeklyReviewJobId,
  loadJyTrackingPoolFunds,
  loadSpotCloses,
  loadWeeklyReviewNavCoverage,
  periodReturnFromSeries,
  resolveWeekWindow,
  type FundMetrics,
  type WeeklyReviewFund,
  type WeeklyReviewJobStatus,
  type WeeklyReviewPreview,
} from "@/lib/server/jy-weekly-review"
import {
  buildWeeklyReviewMarketChartTables,
  embedWeeklyReviewMarketCharts,
  freezeWorksheetHeaderRows,
  SOURCE_MEDIAN_SERIES,
  sourceMedianRows,
  sourceWeekStatRows,
} from "@/lib/server/weekly-review-excel-charts"

const HEADER_FILL = "1F4E79"
const ALT_FILL = "F2F2F2"
const RED = "C00000"
const GREEN = "006600"
const FONT_NAME = "宋体"

const EQUITY_L1 = new Set(["股票多头", "股票对冲", "股票策略"])
const BOND_L1 = new Set(["债券策略", "固定收益", "固收策略"])
const FUTURES_L1 = new Set(["期货策略", "管理期货", "CTA", "期权策略"])

const QUANT_TAG_LABEL: Record<string, string> = {
  高频: "量化高频",
  中高频: "量化中高频",
  股指: "量化股指",
  时序: "量化时序",
  截面: "量化截面",
  混合: "量化混合",
  基本面: "量化基本面",
  量价: "量化量价",
  商品: "量化商品",
  机器学习: "量化机器学习",
}

const SUBJECTIVE_TAG_LABEL: Record<string, string> = {
  宏观多策略: "主观宏观",
  多板块: "主观多板块",
  交易型: "主观交易",
  股指期货: "主观股指",
  黑色: "主观黑色",
  能化: "主观能化",
  农产: "主观农产",
  有色: "主观有色",
  产业对冲: "主观产业",
}

const OPTION_TAG_LABEL: Record<string, string> = {
  商品波动率: "商品波动率",
  金融卖波: "金融卖波",
  期权套利: "期权套利",
  雪球: "雪球",
  其他场外期权: "场外期权",
}

const ARB_TAG_LABEL: Record<string, string> = {
  股指套利: "股指套利",
  商品套利: "商品套利",
  跨期套利: "跨期套利",
  跨品种套利: "跨品种套利",
  跨市场套利: "跨市场套利",
  高频套利: "高频套利",
  期现套利: "期现套利",
  月差: "跨期套利",
}

/**
 * 期货策略 / 量化期货 sheet titles.
 * Text inside （） is display/hint only — never parsed as a membership filter.
 * Membership = 三级策略 tag match via QUANT_CATEGORY_BY_TAG.
 * 量价、商品不进入周度回顾.
 */
export const QUANT_WEEKLY_CATEGORIES = [
  "时序（时序占比超过50%）",
  "截面（截面占比超过50%）",
  "混合",
  "中高频（按交易频率）",
  "大厂（按规模）",
  "股指（按品种）",
  "基本面（按因子类型）",
  "机器学习（按方法论）",
] as const

/**
 * 期货策略 / 主观期货 sheet titles.
 * （包含MOM） is a label hint; MOM→多板块 is an explicit methodology rule below, not parsed from （）.
 */
export const SUBJECTIVE_WEEKLY_CATEGORIES = [
  "黑色",
  "有色",
  "能化",
  "农产",
  "多板块（包含MOM）",
  "MOM",
] as const

/** Excel sheet names and the 近三周数据状态 rows, in this order. */
export const FUTURES_WEEKLY_CATEGORIES = [
  ...QUANT_WEEKLY_CATEGORIES,
  ...SUBJECTIVE_WEEKLY_CATEGORIES,
] as const

export type FuturesWeeklyCategory = (typeof FUTURES_WEEKLY_CATEGORIES)[number]

/** Base 三级 tag → weekly sheet. One map for all quant sheets; no ratio / 按xxx heuristics. */
const QUANT_CATEGORY_BY_TAG: Record<string, FuturesWeeklyCategory> = {
  时序: QUANT_WEEKLY_CATEGORIES[0],
  截面: QUANT_WEEKLY_CATEGORIES[1],
  混合: QUANT_WEEKLY_CATEGORIES[2],
  中高频: QUANT_WEEKLY_CATEGORIES[3],
  大厂: QUANT_WEEKLY_CATEGORIES[4],
  股指: QUANT_WEEKLY_CATEGORIES[5],
  基本面: QUANT_WEEKLY_CATEGORIES[6],
  机器学习: QUANT_WEEKLY_CATEGORIES[7],
}

/** These 量化三级标签不进入周度回顾，带上它们的产品整只不进表. */
const QUANT_EXCLUDED_TAGS = new Set(["量价", "商品"])

const SUBJECTIVE_SECTOR_TAGS = ["黑色", "有色", "能化", "农产"] as const

const COMMODITY_INDICES: Array<{ name: string; code: string }> = [
  { name: "南华商品", code: "NHCI.NH" },
  { name: "南华工业品", code: "NHII.NH" },
  { name: "南华农产品", code: "NHAI.NH" },
  { name: "南华金属", code: "NHMI.NH" },
  { name: "南华能化", code: "NHECI.NH" },
  { name: "南华黑色", code: "NHFI.NH" },
  { name: "南华有色金属", code: "NHNFI.NH" },
  { name: "南华贵金属", code: "NHPMI.NH" },
  { name: "南华能源", code: "NHEI.NH" },
  { name: "南华新能源", code: "NHNEI.NH" },
  { name: "南华油脂油料", code: "NHOOI.NH" },
  { name: "南华石油化工", code: "NHPCI.NH" },
  { name: "南华建材", code: "NHBMI.NH" },
  { name: "南华经济作物", code: "NHAECI.NH" },
]

const INDEX_FUTURES: Array<{ name: string; code: string }> = [
  { name: "上证50", code: "IH" },
  { name: "沪深300", code: "IF" },
  { name: "中证500", code: "IC" },
  { name: "中证1000", code: "IM" },
]

function firstMapped(tags: string[], map: Record<string, string>): string | null {
  for (const tag of tags) {
    const label = map[tag]
    if (label) return label
  }
  return null
}

/** CTA、期权、期货/期权套利、股票期货复合。股票和债券策略留在股票周报。 */
export function isFuturesWeeklyFund(fund: WeeklyReviewFund): boolean {
  const l1 = (fund.l1 || "").trim()
  const l2 = (fund.l2 || "").trim()
  const l3 = fund.l3 || ""
  if (EQUITY_L1.has(l1) || BOND_L1.has(l1)) return false
  if (FUTURES_L1.has(l1)) return true
  if (l1 === "套利策略" && (l2 === "期货套利" || l2 === "期权套利")) return true
  if (l1 === "多资产策略" && l2 === "股票期货复合") return true
  if (!l1) {
    if (["量化期货", "主观期货", "场内期权", "场外期权", "期货套利", "期权套利", "股票期货复合"].includes(l2)) {
      return true
    }
    const name = `${fund.product_name} ${l2} ${l3}`
    if (/量化CTA|主观CTA|\bCTA\b|量化期货|主观期货|管理期货/.test(name)) return true
    if (/期权/.test(name) && !/转债|股票/.test(name)) return true
  }
  return false
}

/**
 * Quant sheets: plain 三级 tag membership (same idea as JY跟踪池 strategy_l3 filter).
 * Sheet-title （…） notes are never read. 量价/商品 exclude the whole product from all quant sheets.
 */
function quantWeeklyCategories(tags: readonly string[]): FuturesWeeklyCategory[] {
  if (tags.some((tag) => QUANT_EXCLUDED_TAGS.has(tag))) return []
  const out: FuturesWeeklyCategory[] = []
  for (const tag of tags) {
    const category = QUANT_CATEGORY_BY_TAG[tag]
    if (category && !out.includes(category)) out.push(category)
  }
  return QUANT_WEEKLY_CATEGORIES.filter((category) => out.includes(category))
}

/**
 * Subjective sheets: plain 三级 tag membership.
 * Methodology (kept): MOM also counts into 多板块, and has its own MOM sheet.
 */
function subjectiveWeeklyCategories(tags: readonly string[]): FuturesWeeklyCategory[] {
  const out: FuturesWeeklyCategory[] = []
  for (const tag of SUBJECTIVE_SECTOR_TAGS) {
    if (tags.includes(tag)) out.push(tag)
  }
  const mom = tags.includes("MOM")
  if (tags.includes("多板块") || mom) out.push(SUBJECTIVE_WEEKLY_CATEGORIES[4])
  if (mom) out.push(SUBJECTIVE_WEEKLY_CATEGORIES[5])
  return SUBJECTIVE_WEEKLY_CATEGORIES.filter((category) => out.includes(category))
}

/** Categories this product belongs to. A product can hit more than one sheet. */
export function futuresWeeklyCategories(
  fund: Pick<WeeklyReviewFund, "l2" | "l3">,
): FuturesWeeklyCategory[] {
  const l2 = (fund.l2 || "").trim()
  const tags = parseStrategyLevel3(fund.l3 || "")
  if (l2 === "量化期货") return quantWeeklyCategories(tags)
  if (l2 === "主观期货") return subjectiveWeeklyCategories(tags)
  return []
}

export function bucketForFuturesFund(
  fund: Pick<WeeklyReviewFund, "l1" | "l2" | "l3" | "product_name">,
): string {
  return futuresWeeklyCategories(fund)[0] ?? legacyBucketForFuturesFund(fund)
}

function legacyBucketForFuturesFund(
  fund: Pick<WeeklyReviewFund, "l1" | "l2" | "l3" | "product_name">,
): string {
  const l1 = (fund.l1 || "").trim()
  const l2 = (fund.l2 || "").trim()
  const tags = parseStrategyLevel3(fund.l3 || "")

  if (l2 === "股票期货复合") return "股票期货复合"

  const optionFamily = l1 === "期权策略" || l2 === "场内期权" || l2 === "场外期权" || l2 === "期权套利"
  if (optionFamily) {
    return firstMapped(tags, OPTION_TAG_LABEL)
      ?? (l2 === "场外期权" ? "场外期权" : l2 === "期权套利" ? "期权套利" : l2 === "场内期权" ? "场内期权" : "期权策略")
  }

  if (l1 === "套利策略" || l2 === "期货套利") {
    return firstMapped(tags, ARB_TAG_LABEL) ?? (l2 || "期货套利")
  }

  if (l2 === "主观期货" || /主观/.test(l2)) {
    return firstMapped(tags, SUBJECTIVE_TAG_LABEL) ?? "主观期货"
  }

  return firstMapped(tags, QUANT_TAG_LABEL) ?? "量化期货"
}

export function previewFuturesWeeklyReview(funds: WeeklyReviewFund[]) {
  const counts = new Map<string, number>()
  for (const fund of funds) {
    for (const bucket of futuresWeeklyCategories(fund)) {
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }
  return FUTURES_WEEKLY_CATEGORIES.map((bucket) => ({
    bucket,
    mode: "absolute" as const,
    count: counts.get(bucket) ?? 0,
  }))
}

export function countClassifiedFuturesFunds(funds: readonly Pick<WeeklyReviewFund, "l2" | "l3">[]): number {
  return funds.filter((fund) => futuresWeeklyCategories(fund).length > 0).length
}

async function loadFuturesWeeklyFunds(asOf: string, poolsInput?: unknown): Promise<WeeklyReviewFund[]> {
  const pool = (await loadJyTrackingPoolFunds(poolsInput)).filter(isFuturesWeeklyFund)
  const coverage = await loadWeeklyReviewNavCoverage(pool, asOf)
  return collapseWeeklyReviewFunds(pool, coverage)
}

export async function buildFuturesWeeklyReviewPreview(weekEnd: string, poolsInput?: unknown): Promise<WeeklyReviewPreview> {
  const { weekStart, weekEnd: end, asOf } = resolveWeekWindow(weekEnd)
  const funds = await loadFuturesWeeklyFunds(asOf, poolsInput)
  return {
    week_start: weekStart,
    week_end: end,
    as_of: asOf,
    fund_count: countClassifiedFuturesFunds(funds),
    groups: previewFuturesWeeklyReview(funds),
  }
}

async function loadNanhuaCloses(
  codes: string[],
  from: string,
  to: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (codes.length === 0) return out
  const rows = await query<{ code: string; trade_date: Date | string; close: string | number | null }>(
    `SELECT code, trade_date, close
     FROM raw_nanhua_indices_daily
     WHERE code = ANY($1::text[])
       AND trade_date >= $2::date
       AND trade_date <= $3::date
       AND close IS NOT NULL AND close > 0
     ORDER BY code, trade_date ASC`,
    [codes, from, to],
  ).catch(() => [])
  for (const row of rows) {
    const value = n(row.close)
    if (value == null) continue
    const code = String(row.code)
    if (!out.has(code)) out.set(code, new Map())
    out.get(code)!.set(fmtIso(row.trade_date), value)
  }
  return out
}

function fmtSlashDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${y}/${Number(m)}/${Number(d)}`
}

function addLookback(iso: string, days: number): string {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

type FuturesMarket = {
  rangeLabel: string
  commodity: Array<{ name: string; code: string; ret: number | null }>
  indexFutures: Array<{ name: string; code: string; ret: number | null }>
}

async function buildFuturesMarketRows(weekStart: string, weekEnd: string): Promise<FuturesMarket> {
  const from = addLookback(weekEnd, 20)
  const [nanhua, spot] = await Promise.all([
    loadNanhuaCloses(COMMODITY_INDICES.map((x) => x.code), from, weekEnd),
    loadSpotCloses(INDEX_FUTURES.map((x) => x.code), from, weekEnd),
  ])
  return {
    rangeLabel: `${fmtSlashDate(weekStart)} ~ ${fmtSlashDate(weekEnd)}`,
    commodity: COMMODITY_INDICES.map((idx) => ({
      name: idx.name,
      code: idx.code,
      ret: periodReturnFromSeries(nanhua.get(idx.code) ?? new Map(), weekEnd, 7),
    })),
    indexFutures: INDEX_FUTURES.map((idx) => ({
      name: idx.name,
      code: idx.code,
      ret: periodReturnFromSeries(spot.get(idx.code) ?? new Map(), weekEnd, 7),
    })),
  }
}

type CellStyle = {
  font?: { name?: string; sz?: number; bold?: boolean; color?: { rgb: string } }
  fill?: { patternType: "solid"; fgColor: { rgb: string } }
  alignment?: { wrapText?: boolean; vertical?: string; horizontal?: string }
  numFmt?: string
}

type MethodologyRow =
  | { kind: "title"; text: string }
  | { kind: "pair"; label: string; text: string }

function buildFuturesMethodologyRows(weekStart: string, weekEnd: string, poolsInput?: unknown): MethodologyRow[] {
  const scope = weeklyReviewPoolScopePhrase(normalizeWeeklyReviewPools(poolsInput))
  return [
    { kind: "title", text: `口径说明（统计区间 ${fmtSlashDate(weekStart)} ~ ${fmtSlashDate(weekEnd)}，截止日 ${weekEnd}）` },
    {
      kind: "pair",
      label: "样本范围",
      text: `业绩表只收 ${scope}里的量化期货和主观期货。量化期货三级里写了量价或商品的产品不进入周度回顾。主观期货只收黑色、有色、能化、农产、多板块和 MOM。期权、期货套利、交易型、宏观多策略、股指期货、产业对冲不进入这些表。同一备案号只保留最新一条跟踪记录。产品同时在多个所选池中时只保留一行。`,
    },
    {
      kind: "pair",
      label: "策略分组",
      text: "量化期货 8 张与主观期货 6 张一律按三级策略标签命中分组；表名里（时序占比超过50%）、（按交易频率）、（按规模）、（按品种）、（按因子类型）、（按方法论）、（包含MOM）等括号文字只作展示说明，一律不参与过滤。时序/截面/混合/中高频/大厂/股指/基本面/机器学习：标签命中即进对应表，可同时进多张。三级含量价或商品的量化期货整只不进表。主观：黑色、有色、能化、农产、多板块、MOM 按标签；MOM 另计入多板块（与表名提示一致的既有口径）。一只产品可以同时出现在多张表。",
    },
    {
      kind: "pair",
      label: "份额合并",
      text: "同一策略分组内，同一产品的母份额与 A/B/C 份额合并为一行。优先采用截止日前净值点数更多的份额；点数相同则 A 优先于 B、C，S 开头的备案号优先。",
    },
    {
      kind: "pair",
      label: "统计截止",
      text: "收益、回撤和风险比率都不用截止日之后的数据。近一周收益的期末净值必须落在统计区间内（该周周一至截止日）。区间内没有净值时这一格留空，不用上一周的涨跌代替本周。近一月及更长区间截止到截止日当日或之前最近一条已公布净值。",
    },
    {
      kind: "pair",
      label: "净值取值",
      text: "收益用复权净值：累计净值或复权净值相对单位净值处于 0.85–2.5 倍、且不低于单位净值时采用该值，否则用单位净值。只保留 A 股交易日。净值来自邮件净值、历史净值表和产品详情缓存。回看约 400 个自然日。",
    },
    {
      kind: "pair",
      label: "指标选择",
      text: "量化期货和主观期货这两套表都按绝对收益展示，不减股票指数或南华商品指数。每一张表列出近一周、近一月、近三月、近六月、近一年收益，以及近一年夏普比率和近一年卡玛比率。",
    },
    {
      kind: "pair",
      label: "绝对收益",
      text: "近一周 / 近一月 / 近三月 / 近六月 / 近一年分别对应期末净值日前 7 / 30 / 90 / 180 / 365 个自然日。收益 = 期末复权净值 / 期初复权净值 − 1。近一周的期末必须落在统计区间内，否则留空。",
    },
    {
      kind: "pair",
      label: "夏普与卡玛",
      text: "取截止日前 365 个自然日内的复权净值，至少 20 个点。年化收益按日历跨度复利（一年按 365.25 天）。年化波动为相邻净值收益率的样本标准差（分母 n−1）乘以 √年化期数。夏普 =（年化收益 − 2% 无风险利率）/ 年化波动。卡玛 = 年化收益 / 最大回撤。绝对值超过 50、回撤不足 0.01% 或样本不足时留空。",
    },
    {
      kind: "pair",
      label: "排序与颜色",
      text: "各策略表按近一周收益从高到低排列。正收益为红色，负收益为绿色。夏普、卡玛不按涨跌着色。百分比单元格存的是小数（1% 为 0.01）。浅黄、浅紫、浅绿、浅蓝底从产品名称铺到「来源」。「是否在跟踪池」为是或否。「来源」把该产品出现过的地方都写上，用斜杠隔开，例如跟踪池/小荷公众号。顺序是跟踪池、公募指增、小荷公众号、ima点睛。",
    },
    {
      kind: "pair",
      label: "近一周分位数",
      text: "近一周分位数是该行近一周收益在本表跟踪池产品中从高到低的名次占比，1/20 记为前 5%；同分并列取最好名次。前 25% 为红色，后 25% 为绿色。小荷公众号、ima点睛和公募指增补进的行不计入这个分母。",
    },
    {
      kind: "pair",
      label: "小荷公众号",
      text: "同一周小荷公众号业绩榜里，策略写成量化CTA或主观CTA、并且能在库里对上量化期货或主观期货产品的，按该产品的三级标签写入对应策略表。已经在这张表里的不另起一行，只在「来源」里加上小荷公众号。优先用库内净值，缺的列用榜上同一窗口的绝对收益补上。对不上三级标签的不写入这些表。宏观、债券、套利和股票策略不写入期货周报。一只产品可以出现在多张表。",
    },
    {
      kind: "pair",
      label: "ima点睛",
      text: "同一周 ima点睛 的量化CTA、主观CTA 管理人，在库里对上其量化期货或主观期货产品后，按该产品的三级标签写入对应表。已经在表里的不另起一行。优先用库内净值，近一周没有数时用榜上的近一周收益率。今年以来不当作近一年。",
    },
    {
      kind: "pair",
      label: "公募指增",
      text: "公募指增产品只有策略分组和某张期货表相同才写入该表，浅蓝色底。另有该组全部公募产品的中位数和平均数。这些公募行按近一周绝对收益和跟踪池产品排在一起。公募指增是股票指数增强，对不上期货三级标签时这一列留空。",
    },
    {
      kind: "pair",
      label: "期货市场回顾",
      text: "南华商品板块和股指期货的涨跌幅，是截止日收盘相对约 7 个自然日前收盘的涨跌幅，两端都取当日或之前最近收盘。商品板块来自南华指数日行情，股指期货来自 IH、IF、IC、IM 主力连续行情。另有两张图：跟踪池近一周绝对收益中位数对照这些市场涨跌；各策略来源近一周中位数，按跟踪池、小荷公众号、公募指增、ima点睛、已投分列。同一产品出现在多个来源时，每一个来源都算它。没有近一周数的不计入。「来源统计」用同一批产品列出每个来源的中位数、平均数、最大值、最小值、产品数和分化程度。分化程度是该策略该来源下各产品本周收益的标准差，产品数少于 2 时不计算。",
    },
    {
      kind: "pair",
      label: "空值",
      text: "净值点数不足、窗口被公布空档打断，或风险比率超出合理范围时，对应单元格留空，不填 0。绝对收益、夏普、卡玛与投资分析列表使用同一套净值算法。",
    },
  ]
}

function headerStyle(): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: HEADER_FILL } },
    alignment: { wrapText: true, vertical: "center" },
  }
}

function bodyStyle(alt: boolean, color?: string, numFmt?: string): CellStyle {
  const s: CellStyle = {
    font: { name: FONT_NAME, sz: 11, color: color ? { rgb: color } : undefined },
    alignment: { wrapText: true, vertical: "center" },
  }
  if (alt) s.fill = { patternType: "solid", fgColor: { rgb: ALT_FILL } }
  if (numFmt) s.numFmt = numFmt
  return s
}

function signedColor(v: number | null): string | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined
  return v > 0 ? RED : GREEN
}

function markerStyle(color?: string, numFmt?: string): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 11, bold: true, color: color ? { rgb: color } : undefined },
    fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } },
    alignment: { wrapText: true, vertical: "center" },
    numFmt,
  }
}

const PUBLIC_FILL = "DDEBF7"
const PUBLIC_SUMMARY_FILL = "BDD7EE"
const XIAOHE_FILL = "F3E8FF"
const IMA_FILL = "E2EFDA"

function filledStyle(fill: string, bold: boolean, color?: string, numFmt?: string): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 11, bold, color: color ? { rgb: color } : undefined },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    alignment: { wrapText: true, vertical: "center" },
    numFmt,
  }
}

function percentileColor(share: number | null): string | undefined {
  if (share == null || !Number.isFinite(share)) return undefined
  if (share <= 0.25) return RED
  if (share > 0.75) return GREEN
  return undefined
}

function sheetName(seq: number, title: string): string {
  return `${String(seq).padStart(2, "0")}_${title}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)
}

function methodologySheet(weekStart: string, weekEnd: string, poolsInput?: unknown) {
  const aoa: unknown[][] = []
  const styles = new Map<string, CellStyle>()
  const rowHeights: number[] = []
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []
  const title: CellStyle = {
    ...headerStyle(),
    alignment: { wrapText: true, vertical: "center", horizontal: "left" },
  }
  const label: CellStyle = {
    font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: HEADER_FILL } },
    alignment: { wrapText: true, vertical: "top", horizontal: "left" },
  }
  const body: CellStyle = {
    font: { name: FONT_NAME, sz: 11 },
    alignment: { wrapText: true, vertical: "top", horizontal: "left" },
  }
  for (const row of buildFuturesMethodologyRows(weekStart, weekEnd, poolsInput)) {
    const r = aoa.length
    if (row.kind === "title") {
      aoa.push([row.text, " "])
      styles.set(`${r},0`, title)
      styles.set(`${r},1`, title)
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } })
      rowHeights.push(24)
      continue
    }
    aoa.push([row.label, row.text])
    styles.set(`${r},0`, label)
    styles.set(`${r},1`, body)
    rowHeights.push(Math.min(120, Math.max(22, Math.ceil(row.text.length / 40) * 18)))
  }
  return { aoa, styles, rowHeights, merges }
}

export async function generateJyFuturesWeeklyReviewWorkbook(weekEndRaw: string, poolsInput?: unknown): Promise<{
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}> {
  const pools = normalizeWeeklyReviewPools(poolsInput)
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const funds = await loadFuturesWeeklyFunds(asOf, pools)
  const classified = funds.filter((fund) => futuresWeeklyCategories(fund).length > 0)
  if (classified.length === 0) {
    throw new Error(`${weeklyReviewPoolScopePhrase(pools)}中没有可归入量化期货 8 类或主观期货 6 类的产品`)
  }
  const categoriesByCode = new Map(classified.map((fund) => [fund.beian_hao, futuresWeeklyCategories(fund)]))

  const poolFamilies = new Set<string>()
  for (const fund of classified) {
    const family = beianFamilyKey(fund.beian_hao)
    if (family) poolFamilies.add(family)
  }

  const [metrics, market, invested, publicMetrics, externalRows] = await Promise.all([
    computeFundMetrics(classified, asOf, undefined, {
      bucketFor: () => FUTURES_WEEKLY_CATEGORIES[0],
      modeFor: () => "absolute",
    }),
    buildFuturesMarketRows(weekStart, weekEnd),
    import("@/lib/server/weekly-review-invested-median")
      .then((mod) => mod.buildWeeklyReviewInvestedMedian("futures", weekEnd))
      .catch((err: unknown) => {
        console.error("[jy-weekly-review-futures] invested median skipped:", err)
        return null
      }),
    import("@/lib/server/public-enhanced-weekly-review")
      .then((mod) => mod.loadPublicEnhancedFundMetrics(weekEnd))
      .catch((err: unknown) => {
        console.error("[jy-weekly-review-futures] public rows skipped:", err)
        return [] as FundMetrics[]
      }),
    loadFuturesExternalRows(weekEnd, poolFamilies).catch((err: unknown) => {
      console.error("[jy-weekly-review-futures] external rows skipped:", err)
      return [] as FuturesExternalRow[]
    }),
  ])
  const xlsxMod = await import("xlsx-js-style") as {
    default?: typeof import("xlsx")
    utils?: typeof import("xlsx")["utils"]
    write?: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }
  const XLSX = (xlsxMod.utils ? xlsxMod : xlsxMod.default) as typeof import("xlsx") & {
    write: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }

  const wb = XLSX.utils.book_new()
  const groups = new Map<FuturesWeeklyCategory, FundMetrics[]>()
  for (const category of FUTURES_WEEKLY_CATEGORIES) groups.set(category, [])
  for (const row of metrics) {
    for (const category of categoriesByCode.get(row.beian_hao) ?? []) {
      groups.get(category)!.push(row)
    }
  }

  const externalByBucket = new Map<string, Array<{ source: "xiaohe" | "ima"; nameKey: string; metrics: FundMetrics }>>()
  for (const row of externalRows) {
    for (const category of futuresWeeklyCategories({ l2: row.l2, l3: row.l3 ?? "" })) {
      const list = externalByBucket.get(category) ?? []
      list.push({ source: row.source, nameKey: row.nameKey, metrics: { ...row.metrics, bucket: category } })
      externalByBucket.set(category, list)
    }
  }
  const publicByBucket = new Map<string, FundMetrics[]>()
  for (const row of publicMetrics) {
    if (!FUTURES_WEEKLY_CATEGORIES.includes(row.bucket as FuturesWeeklyCategory)) continue
    const list = publicByBucket.get(row.bucket) ?? []
    list.push(row)
    publicByBucket.set(row.bucket, list)
  }

  let marketChartTables: ReturnType<typeof buildWeeklyReviewMarketChartTables> | null = null
  let marketSheetName = ""
  const tocRows: unknown[][] = [["页码", "工作表", "标题", "行数", "列数"]]
  const sheets: Array<{
    name: string
    title: string
    rows: number
    cols: number
    aoa: unknown[][]
    styles: Map<string, CellStyle>
    rowHeights?: number[]
    merges?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>
  }> = []

  {
    const note = methodologySheet(weekStart, weekEnd, pools)
    sheets.push({
      name: "口径说明",
      title: "口径说明",
      rows: note.aoa.length,
      cols: 2,
      aoa: note.aoa,
      styles: note.styles,
      rowHeights: note.rowHeights,
      merges: note.merges,
    })
    tocRows.push(["—", "口径说明", "口径说明", note.aoa.filter((row) => row.some((cell) => String(cell ?? "").trim())).length, 2])
  }

  {
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, v: unknown, s?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = v
      if (s) styles.set(`${r},${c}`, s)
    }
    const dateHeader: CellStyle = {
      ...headerStyle(),
      alignment: { wrapText: false, vertical: "center" },
    }
    set(0, 0, "起止日期", dateHeader)
    set(0, 1, market.rangeLabel, dateHeader)
    const headers = ["商品指数", "代码", "涨跌幅", "股指期货", "代码", "涨跌幅"]
    headers.forEach((h, c) => set(1, c, h, bodyStyle(true)))
    const nRows = Math.max(market.commodity.length, market.indexFutures.length)
    for (let i = 0; i < nRows; i++) {
      const alt = i % 2 === 1
      const commodity = market.commodity[i]
      const fut = market.indexFutures[i]
      if (commodity) {
        set(2 + i, 0, commodity.name, bodyStyle(alt))
        set(2 + i, 1, commodity.code, bodyStyle(alt))
        set(2 + i, 2, commodity.ret, bodyStyle(alt, signedColor(commodity.ret), "0.00%"))
      }
      if (fut) {
        set(2 + i, 3, fut.name, bodyStyle(alt))
        set(2 + i, 4, fut.code, bodyStyle(alt))
        set(2 + i, 5, fut.ret, bodyStyle(alt, signedColor(fut.ret), "0.00%"))
      }
    }
    const heldCodesByBucket = new Map<string, Set<string>>()
    const poolCodes = new Set<string>()
    for (const [bucket, rows] of groups) {
      for (const row of rows) poolCodes.add(`${bucket}\0${row.beian_hao}`)
    }
    for (const group of invested?.groups ?? []) {
      heldCodesByBucket.set(group.bucket, new Set(group.products.map((product) => product.code)))
    }
    const heldOnly = (invested?.metrics ?? []).filter((row) => !poolCodes.has(`${row.bucket}\0${row.beian_hao}`))
    const xiaoheRows = [...externalByBucket.entries()].flatMap(([bucket, rows]) =>
      rows.filter((row) => row.source === "xiaohe").map((row) => ({ bucket, nameKey: row.nameKey, metrics: row.metrics })),
    )
    const imaRows = [...externalByBucket.entries()].flatMap(([bucket, rows]) =>
      rows.filter((row) => row.source === "ima").map((row) => ({ bucket, nameKey: row.nameKey, metrics: row.metrics })),
    )
    const memberships = collectSourceMedianMemberships({
      pool: groups,
      heldCodes: heldCodesByBucket,
      heldOnly,
      xiaohe: xiaoheRows,
      ima: imaRows,
      publicRows: [...publicByBucket.values()].flat(),
    })
    const order = new Map<string, number>(FUTURES_WEEKLY_CATEGORIES.map((category, index) => [category, index]))
    memberships.sort((a, b) => (order.get(a.bucket) ?? 99) - (order.get(b.bucket) ?? 99))
    const chartTables = buildWeeklyReviewMarketChartTables(
      [...market.commodity, ...market.indexFutures].map((row) => ({ name: row.name, ret: row.ret })),
      metrics.map((row) => ({
        beian_hao: row.beian_hao,
        name: row.name,
        bucket: categoriesByCode.get(row.beian_hao)?.[0] ?? row.bucket,
        ret_1w: row.ret.ret_1w,
      })),
      sourceMedianRows(memberships),
      2 + nRows,
      {
        chart1Title: "跟踪池 vs 商品与股指期货（近一周）",
        benchSeriesLabel: "市场涨跌",
        note: "上一图近一周是绝对收益，与上方商品指数、股指期货涨跌幅同一口径。下一图每个策略用近一周绝对收益。同一产品出现在多个来源时，计入每一个来源的中位数。没有近一周数的产品不计入。各来源的中位数、平均数、最大值、最小值、产品数和分化程度见「来源统计」。分化程度是该策略该来源下各产品本周收益的标准差，产品数少于 2 时不计算。",
      },
    )
    marketChartTables = chartTables
    const noteStyle: CellStyle = {
      font: { name: FONT_NAME, sz: 9, color: { rgb: "666666" } },
      alignment: { wrapText: true, vertical: "center", horizontal: "left" },
    }
    const noteRow = chartTables.chart1StartRow - 2
    set(noteRow, 0, chartTables.note, noteStyle)
    const commentRow = chartTables.commentRow - 1
    set(commentRow, 0, "原文评述", undefined)
    set(commentRow + 1, 0, "", undefined)
    const name = sheetName(3, "期货市场回顾")
    marketSheetName = name
    sheets.push({
      name,
      title: "期货市场回顾",
      rows: commentRow + 2,
      cols: 6,
      aoa,
      styles,
      merges: [{ s: { r: noteRow, c: 0 }, e: { r: noteRow, c: 5 } }],
    })
    tocRows.push([3, name, "期货市场回顾", nRows, 6])
    const statSheet = buildSourceStatSheet(sourceWeekStatRows(memberships))
    sheets.push(statSheet)
    tocRows.push(["—", statSheet.name, statSheet.title, Math.max(0, statSheet.aoa.length - 3), statSheet.cols])
    const dataStyles = new Map<string, CellStyle>()
    chartTables.dataAoa.forEach((row, r) => {
      (row ?? []).forEach((value, c) => {
        dataStyles.set(`${r},${c}`, r === 0
          ? { font: { name: FONT_NAME, sz: 10, bold: true } }
          : typeof value === "number"
            ? { font: { name: FONT_NAME, sz: 10 }, numFmt: "0.00%" }
            : { font: { name: FONT_NAME, sz: 10 } })
      })
    })
    sheets.push({
      name: chartTables.dataSheetName,
      title: chartTables.dataSheetName,
      rows: chartTables.dataAoa.length,
      cols: 10,
      aoa: chartTables.dataAoa,
      styles: dataStyles,
    })
  }

  let seq = 4
  const strategySheetNames: string[] = []
  for (const bucket of FUTURES_WEEKLY_CATEGORIES) {
    const merged = mergeWeeklyReviewInvestedRows(
      groups.get(bucket) ?? [],
      (invested?.groups.find((group) => group.bucket === bucket)?.products ?? []).map((product) => product.code),
      invested?.metrics ?? [],
    )
    const headers = ["产品名称", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率", "近一周分位数", "是否在跟踪池", "来源"]
    const sorted = [...merged].sort((a, b) => (b.row.ret.ret_1w ?? -Infinity) - (a.row.ret.ret_1w ?? -Infinity))
    const weekValues = sorted.map((line) => line.row.ret.ret_1w)
    const poolSource = groups.get(bucket) ?? []
    const bucketFamilies = new Set<string>()
    const presentNames = new Set<string>()
    for (const row of poolSource) {
      const family = beianFamilyKey(row.beian_hao)
      if (family) bucketFamilies.add(family)
    }
    for (const line of merged) {
      const family = beianFamilyKey(line.row.beian_hao)
      if (family) bucketFamilies.add(family)
      presentNames.add(xiaoheNameKey(line.row.name))
    }
    const externalHere = externalByBucket.get(bucket) ?? []
    const namesFor = (source: "xiaohe" | "ima") => {
      const names = new Set<string>()
      const families = new Set<string>()
      for (const row of externalHere) {
        if (row.source !== source) continue
        if (row.nameKey) names.add(row.nameKey)
        const family = beianFamilyKey(row.metrics.beian_hao)
        if (family) families.add(family)
      }
      return { names, families }
    }
    const xiaoheListed = namesFor("xiaohe")
    const imaListed = namesFor("ima")
    const listed = (row: FundMetrics, book: { names: Set<string>; families: Set<string> }) => {
      const family = beianFamilyKey(row.beian_hao)
      if (family && book.families.has(family)) return true
      const key = xiaoheNameKey(row.name)
      return key.length > 0 && book.names.has(key)
    }
    const fresh = (source: "xiaohe" | "ima") => externalHere.filter((row) => {
      if (row.source !== source) return false
      const family = beianFamilyKey(row.metrics.beian_hao)
      if (family && bucketFamilies.has(family)) return false
      return !presentNames.has(row.nameKey)
    })
    const allPublic = publicByBucket.get(bucket) ?? []
    const featuredPublic = takeBestByWeek(allPublic, (row) => row.ret.ret_1w)
    type LineKind = "pool" | "invested" | "xiaohe" | "ima" | "public" | "summary"
    const lines: Array<{ kind: LineKind; row: FundMetrics; share: number | null }> = sorted.map((line) => ({
      kind: line.invested ? "invested" : "pool",
      row: line.row,
      share: weekReturnTopShare(line.row.ret.ret_1w, weekValues),
    }))
    for (const row of fresh("xiaohe")) {
      lines.push({ kind: "xiaohe", row: row.metrics, share: weekReturnTopShare(row.metrics.ret.ret_1w, weekValues) })
    }
    for (const row of fresh("ima")) {
      lines.push({ kind: "ima", row: row.metrics, share: weekReturnTopShare(row.metrics.ret.ret_1w, weekValues) })
    }
    for (const row of featuredPublic) {
      lines.push({ kind: "public", row, share: weekReturnTopShare(row.ret.ret_1w, allPublic.map((item) => item.ret.ret_1w)) })
    }
    if (allPublic.length > 0) {
      lines.push(
        { kind: "summary", row: aggregateMetrics(allPublic, bucket, "absolute", "median"), share: null },
        { kind: "summary", row: aggregateMetrics(allPublic, bucket, "absolute", "mean"), share: null },
      )
    }
    const kindRank: Record<LineKind, number> = { pool: 0, invested: 0, xiaohe: 0, ima: 0, public: 2, summary: 3 }
    lines.sort((a, b) => {
      const diff = (b.row.ret.ret_1w ?? -Infinity) - (a.row.ret.ret_1w ?? -Infinity)
      if (diff !== 0) return diff
      return kindRank[a.kind] - kindRank[b.kind]
    })
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, v: unknown, s?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = v ?? null
      if (s) styles.set(`${r},${c}`, s)
    }
    const paint = (kind: LineKind, alt: boolean, color?: string, numFmt?: string): CellStyle => {
      if (kind === "invested") return markerStyle(color, numFmt)
      if (kind === "xiaohe") return filledStyle(XIAOHE_FILL, false, color, numFmt)
      if (kind === "ima") return filledStyle(IMA_FILL, false, color, numFmt)
      if (kind === "public") return filledStyle(PUBLIC_FILL, false, color, numFmt)
      if (kind === "summary") return filledStyle(PUBLIC_SUMMARY_FILL, true, color, numFmt)
      return bodyStyle(alt, color, numFmt)
    }
    const originOf = (kind: LineKind, row: FundMetrics): { inPool: string; source: string } => {
      if (kind === "summary") return { inPool: "", source: "" }
      const sources: WeeklyRowSource[] = []
      const family = beianFamilyKey(row.beian_hao)
      const inPool = kind === "pool" || (family != null && bucketFamilies.has(family))
      if (inPool) sources.push(WEEKLY_ROW_SOURCE.pool)
      if (kind === "public") sources.push(WEEKLY_ROW_SOURCE.public)
      if (kind === "xiaohe" || listed(row, xiaoheListed)) sources.push(WEEKLY_ROW_SOURCE.xiaohe)
      if (kind === "ima" || listed(row, imaListed)) sources.push(WEEKLY_ROW_SOURCE.ima)
      const source = joinWeeklyRowSources(sources)
      return inPool ? { inPool: "是", source } : { inPool: "否", source }
    }
    headers.forEach((h, c) => set(0, c, h, headerStyle()))
    lines.forEach((line, i) => {
      const row = line.row
      const alt = i % 2 === 0
      set(i + 1, 0, row.name, paint(line.kind, alt))
      const pcts = [row.ret.ret_1w, row.ret.ret_1m, row.ret.ret_3m, row.ret.ret_6m, row.ret.ret_1y]
      pcts.forEach((v, ci) => set(i + 1, ci + 1, v, paint(line.kind, alt, signedColor(v), "0.00%")))
      set(i + 1, 6, row.sharpe_1y, paint(line.kind, alt, undefined, "0.0000"))
      set(i + 1, 7, row.calmar_1y, paint(line.kind, alt, undefined, "0.0000"))
      set(i + 1, 8, formatWeekReturnTopShare(line.share), paint(line.kind, alt, percentileColor(line.share)))
      const origin = originOf(line.kind, row)
      set(i + 1, 9, origin.inPool, paint(line.kind, alt))
      set(i + 1, 10, origin.source, paint(line.kind, alt))
    })
    const name = bucket.slice(0, 31)
    strategySheetNames.push(name)
    sheets.push({ name, title: bucket, rows: lines.length, cols: headers.length, aoa, styles })
    tocRows.push([seq, name, bucket, lines.length, headers.length])
    seq += 1
  }

  const tocWs = XLSX.utils.aoa_to_sheet(tocRows)
  styleAoaSheet(tocWs, tocRows.length, 5, (r) => (r === 0 ? headerStyle() : undefined), XLSX)
  tocWs["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 36 }, { wch: 10 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, tocWs, "目录")

  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa)
    const maxCol = Math.max(0, ...sheet.aoa.map((r) => r.length))
    styleAoaSheet(ws, sheet.aoa.length, maxCol, (r, c) => sheet.styles.get(`${r},${c}`), XLSX)
    if (sheet.merges?.length) ws["!merges"] = sheet.merges
    if (sheet.title === "口径说明") {
      ws["!cols"] = [{ wch: 16 }, { wch: 92 }]
      ws["!rows"] = sheet.rowHeights?.map((hpt) => ({ hpt }))
    } else if (sheet.title === "期货市场回顾") {
      ws["!cols"] = [
        { wch: 16 }, { wch: 14 }, { wch: 10 },
        { wch: 14 }, { wch: 10 }, { wch: 10 },
      ]
      ws["!rows"] = Array.from({ length: sheet.aoa.length }, (_, i) => ({ hpt: i === 0 ? 20 : 22 }))
    } else if (sheet.title === "来源统计") {
      const widths: Array<{ wch: number }> = [{ wch: 28 }]
      for (let i = 0; i < SOURCE_MEDIAN_SERIES.length; i++) {
        widths.push({ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 })
      }
      ws["!cols"] = widths
      ws["!rows"] = (sheet.rowHeights ?? sheet.aoa.map(() => 22)).map((hpt) => ({ hpt }))
    } else {
      const cols = [{ wch: 36 }, ...Array.from({ length: Math.max(0, maxCol - 1) }, () => ({ wch: 14 }))]
      if (sheet.aoa[0]?.[maxCol - 1] === "来源" && cols.length > 0) cols[cols.length - 1] = { wch: 28 }
      ws["!cols"] = cols
      ws["!rows"] = Array.from({ length: sheet.aoa.length }, () => ({ hpt: 27 }))
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  let buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }) as unknown as Buffer
  if (marketChartTables && marketSheetName) {
    buffer = await embedWeeklyReviewMarketCharts(buffer, marketChartTables, marketSheetName)
  }
  buffer = await freezeWorksheetHeaderRows(buffer, strategySheetNames)
  buffer = await freezeWorksheetHeaderRows(buffer, ["来源统计"], 3)
  const yy = weekEnd.slice(2, 4)
  const mm = weekEnd.slice(5, 7)
  const dd = weekEnd.slice(8, 10)
  const fileName = `${weeklyReviewPoolFileLabel(pools)}周度回顾（期货） - ${yy}.${mm}.${dd}.xlsx`
  return { buffer, fileName, fundCount: classified.length, groupCount: FUTURES_WEEKLY_CATEGORIES.length }
}

function styleAoaSheet(
  ws: Record<string, unknown>,
  rows: number,
  cols: number,
  styleAt: (r: number, c: number) => CellStyle | undefined,
  XLSX: typeof import("xlsx"),
) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr] as { t?: string; v?: unknown; s?: CellStyle; z?: string } | undefined
      if (!cell) continue
      const style = styleAt(r, c)
      if (style) {
        cell.s = style
        if (style.numFmt) cell.z = style.numFmt
      }
    }
  }
}

const JOB_ROOT = path.join(process.cwd(), ".tmp", "jy-weekly-review-futures")

function jobDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

function jobStatusPath(jobId: string): string {
  return path.join(jobDir(jobId), "status.json")
}

function jobFilePath(jobId: string): string {
  return path.join(jobDir(jobId), "report.xlsx")
}

async function writeJobStatus(status: WeeklyReviewJobStatus): Promise<void> {
  await mkdir(jobDir(status.jobId), { recursive: true })
  await writeFile(jobStatusPath(status.jobId), JSON.stringify(status), "utf8")
}

export async function prepareFuturesWeeklyReviewJob(): Promise<string> {
  const jobId = randomUUID()
  await writeJobStatus({
    status: "pending",
    jobId,
    updatedAt: new Date().toISOString(),
  })
  return jobId
}

export async function getFuturesWeeklyReviewJobStatus(jobId: string): Promise<WeeklyReviewJobStatus> {
  if (!isValidWeeklyReviewJobId(jobId)) throw new Error("无效的任务 ID")
  const raw = await readFile(jobStatusPath(jobId), "utf8").catch(() => null)
  if (!raw) throw new Error("任务不存在")
  return JSON.parse(raw) as WeeklyReviewJobStatus
}

export async function readFuturesWeeklyReviewJobFile(jobId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const status = await getFuturesWeeklyReviewJobStatus(jobId)
  if (status.status !== "done" || !status.fileName) throw new Error("文件尚未生成")
  const buffer = await readFile(jobFilePath(jobId))
  return { buffer, fileName: status.fileName }
}

export async function runFuturesWeeklyReviewJob(jobId: string, weekEnd: string, poolsInput?: unknown): Promise<void> {
  await writeJobStatus({
    status: "running",
    jobId,
    updatedAt: new Date().toISOString(),
  })
  try {
    console.time("[jy-weekly-review-futures] generate workbook")
    const result = await generateJyFuturesWeeklyReviewWorkbook(weekEnd, poolsInput)
    console.timeEnd("[jy-weekly-review-futures] generate workbook")
    await mkdir(jobDir(jobId), { recursive: true })
    await writeFile(jobFilePath(jobId), result.buffer)
    try {
      const { saveWeeklyReviewExcelCache } = await import("@/lib/server/weekly-review-excel-cache")
      await saveWeeklyReviewExcelCache("futures", weekEnd, poolsInput, result)
    } catch (cacheErr) {
      console.error("[jy-weekly-review-futures] cache save failed:", cacheErr)
    }
    await writeJobStatus({
      status: "done",
      jobId,
      updatedAt: new Date().toISOString(),
      fileName: result.fileName,
      fundCount: result.fundCount,
      groupCount: result.groupCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[jy-weekly-review-futures] job failed:", message)
    await writeJobStatus({
      status: "error",
      jobId,
      updatedAt: new Date().toISOString(),
      error: message,
    })
  }
}