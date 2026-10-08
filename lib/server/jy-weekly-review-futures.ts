/**
 * JY 跟踪池周度回顾（期货）Excel.
 * Universe: CTA / 量化期货 / 主观期货 / 期权 / 期货套利 / 期权套利 / 股票期货复合.
 * Sheets: 目录 + 口径说明 + 期货市场回顾 + one absolute-return sheet per strategy bucket.
 */

import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fmtIso, n, query } from "@/lib/db"
import { parseStrategyLevel3 } from "@/lib/ma/strategy-level3"
import {
  collapseWeeklyReviewFunds,
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

/** Sheet order. Unlisted buckets follow, sorted by Chinese name. */
const FUTURES_BUCKET_ORDER = [
  "量化时序",
  "量化截面",
  "量化混合",
  "量化股指",
  "量化中高频",
  "量化高频",
  "量化基本面",
  "量化量价",
  "量化商品",
  "量化机器学习",
  "量化期货",
  "主观多板块",
  "主观交易",
  "主观宏观",
  "主观黑色",
  "主观能化",
  "主观农产",
  "主观有色",
  "主观股指",
  "主观产业",
  "主观期货",
  "商品波动率",
  "金融卖波",
  "期权套利",
  "雪球",
  "场外期权",
  "场内期权",
  "期权策略",
  "股指套利",
  "商品套利",
  "跨期套利",
  "跨品种套利",
  "跨市场套利",
  "高频套利",
  "期现套利",
  "期货套利",
  "股票期货复合",
]

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

export function bucketForFuturesFund(
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

function futuresGroupSortKey(bucket: string): string {
  const idx = FUTURES_BUCKET_ORDER.indexOf(bucket)
  return idx >= 0 ? `${String(idx).padStart(3, "0")}_${bucket}` : `999_${bucket}`
}

export function previewFuturesWeeklyReview(funds: WeeklyReviewFund[]) {
  const counts = new Map<string, number>()
  for (const fund of funds) {
    const bucket = bucketForFuturesFund(fund)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return [...counts.keys()]
    .sort((a, b) => futuresGroupSortKey(a).localeCompare(futuresGroupSortKey(b), "zh"))
    .map((bucket) => ({
      bucket,
      mode: "absolute" as const,
      count: counts.get(bucket) ?? 0,
    }))
}

async function loadFuturesWeeklyFunds(asOf: string): Promise<WeeklyReviewFund[]> {
  const pool = (await loadJyTrackingPoolFunds()).filter(isFuturesWeeklyFund)
  const coverage = await loadWeeklyReviewNavCoverage(pool, asOf)
  return collapseWeeklyReviewFunds(pool, coverage)
}

export async function buildFuturesWeeklyReviewPreview(weekEnd: string): Promise<WeeklyReviewPreview> {
  const { weekStart, weekEnd: end, asOf } = resolveWeekWindow(weekEnd)
  const funds = await loadFuturesWeeklyFunds(asOf)
  return {
    week_start: weekStart,
    week_end: end,
    as_of: asOf,
    fund_count: funds.length,
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

function buildFuturesMethodologyRows(weekStart: string, weekEnd: string): MethodologyRow[] {
  return [
    { kind: "title", text: `口径说明（统计区间 ${fmtSlashDate(weekStart)} ~ ${fmtSlashDate(weekEnd)}，截止日 ${weekEnd}）` },
    {
      kind: "pair",
      label: "样本范围",
      text: "只含 JY 跟踪池里的期货与期权相关产品：一级策略为期货策略、管理期货或期权策略；套利策略里的期货套利、期权套利；多资产策略里的股票期货复合。股票多头、股票对冲、债券、可转债套利、ETF 套利不进入本表。同一备案号只保留最新一条跟踪记录。",
    },
    {
      kind: "pair",
      label: "策略分组",
      text: "量化期货按三级标签拆成时序、截面、混合、股指、中高频、高频等；主观期货按多板块、交易型、宏观和产业板块拆分；期权按商品波动率、金融卖波、期权套利、场外期权拆分；期货套利按股指、商品、跨期、跨品种等拆分。一只产品有多个三级标签时，采用标签顺序里第一个能对应到上述分组的标签。没有三级标签时归入量化期货、主观期货、场内期权或期货套利。",
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
      text: "期货、CTA 和期权产品按绝对收益展示，不减股票指数或南华商品指数。每一组列出近一周、近一月、近三月、近六月、近一年收益，以及近一年夏普比率和近一年卡玛比率。",
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
      label: "期货市场回顾",
      text: "南华商品板块和股指期货的涨跌幅，是截止日收盘相对约 7 个自然日前收盘的涨跌幅，两端都取当日或之前最近收盘。商品板块来自南华指数日行情，股指期货来自 IH、IF、IC、IM 主力连续行情。",
    },
    {
      kind: "pair",
      label: "排序与颜色",
      text: "各策略表按近一周收益从高到低排列。正收益为红色，负收益为绿色。夏普、卡玛不按涨跌着色。百分比单元格存的是小数（1% 为 0.01）。",
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

function sheetName(seq: number, title: string): string {
  return `${String(seq).padStart(2, "0")}_${title}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)
}

function methodologySheet(weekStart: string, weekEnd: string) {
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
  for (const row of buildFuturesMethodologyRows(weekStart, weekEnd)) {
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

export async function generateJyFuturesWeeklyReviewWorkbook(weekEndRaw: string): Promise<{
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const funds = await loadFuturesWeeklyFunds(asOf)
  if (funds.length === 0) {
    throw new Error("JY跟踪池中没有可导出的期货、CTA 或期权策略产品")
  }

  const [metrics, market] = await Promise.all([
    computeFundMetrics(funds, asOf, undefined, {
      bucketFor: bucketForFuturesFund,
      modeFor: () => "absolute",
    }),
    buildFuturesMarketRows(weekStart, weekEnd),
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
  const groups = new Map<string, FundMetrics[]>()
  for (const row of metrics) {
    const list = groups.get(row.bucket) ?? []
    list.push(row)
    groups.set(row.bucket, list)
  }
  const orderedBuckets = [...groups.keys()].sort((a, b) => futuresGroupSortKey(a).localeCompare(futuresGroupSortKey(b), "zh"))

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
    const note = methodologySheet(weekStart, weekEnd)
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
    const commentRow = 2 + nRows + 1
    set(commentRow, 0, "原文评述", undefined)
    set(commentRow + 1, 0, "", undefined)
    const name = sheetName(3, "期货市场回顾")
    sheets.push({ name, title: "期货市场回顾", rows: nRows, cols: 6, aoa, styles })
    tocRows.push([3, name, "期货市场回顾", nRows, 6])
  }

  let seq = 4
  for (const bucket of orderedBuckets) {
    const rows = groups.get(bucket) ?? []
    if (rows.length === 0) continue
    const headers = ["产品名称", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const sorted = [...rows].sort((a, b) => (b.ret.ret_1w ?? -Infinity) - (a.ret.ret_1w ?? -Infinity))
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, v: unknown, s?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = v ?? null
      if (s) styles.set(`${r},${c}`, s)
    }
    headers.forEach((h, c) => set(0, c, h, headerStyle()))
    sorted.forEach((row, i) => {
      const alt = i % 2 === 0
      set(i + 1, 0, row.name, bodyStyle(alt))
      const pcts = [row.ret.ret_1w, row.ret.ret_1m, row.ret.ret_3m, row.ret.ret_6m, row.ret.ret_1y]
      pcts.forEach((v, ci) => set(i + 1, ci + 1, v, bodyStyle(alt, signedColor(v), "0.00%")))
      set(i + 1, 6, row.sharpe_1y, bodyStyle(alt, undefined, "0.0000"))
      set(i + 1, 7, row.calmar_1y, bodyStyle(alt, undefined, "0.0000"))
    })
    const name = sheetName(seq, bucket)
    sheets.push({ name, title: bucket, rows: sorted.length, cols: 8, aoa, styles })
    tocRows.push([seq, name, bucket, sorted.length, 8])
    seq += 1
  }

  const tocWs = XLSX.utils.aoa_to_sheet(tocRows)
  styleAoaSheet(tocWs, tocRows.length, 5, (r) => (r === 0 ? headerStyle() : undefined), XLSX)
  tocWs["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 22 }, { wch: 10 }, { wch: 10 }]
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
    } else {
      ws["!cols"] = [{ wch: 22 }, ...Array.from({ length: Math.max(0, maxCol - 1) }, () => ({ wch: 14 }))]
      ws["!rows"] = Array.from({ length: sheet.aoa.length }, () => ({ hpt: 27 }))
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }) as unknown as Buffer
  const yy = weekEnd.slice(2, 4)
  const mm = weekEnd.slice(5, 7)
  const dd = weekEnd.slice(8, 10)
  const fileName = `JY跟踪池周度回顾（期货） - ${yy}.${mm}.${dd}.xlsx`
  return { buffer, fileName, fundCount: funds.length, groupCount: orderedBuckets.length }
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

export async function runFuturesWeeklyReviewJob(jobId: string, weekEnd: string): Promise<void> {
  await writeJobStatus({
    status: "running",
    jobId,
    updatedAt: new Date().toISOString(),
  })
  try {
    console.time("[jy-weekly-review-futures] generate workbook")
    const result = await generateJyFuturesWeeklyReviewWorkbook(weekEnd)
    console.timeEnd("[jy-weekly-review-futures] generate workbook")
    await mkdir(jobDir(jobId), { recursive: true })
    await writeFile(jobFilePath(jobId), result.buffer)
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