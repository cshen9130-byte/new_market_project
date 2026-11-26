/**
 * Place 小荷公众号 ranking rows onto a 周度回顾(股票) strategy sheet.
 * The ranking publishes absolute returns (收益). Index-enhancement sheets
 * use excess returns (超额), so a published week return is not a substitute
 * for excess.
 */

export const WEEKLY_ROW_SOURCE = {
  pool: "跟踪池",
  held: "已投",
  public: "公募指增",
  xiaohe: "小荷公众号",
  ima: "ima点睛",
  yingmi: "盈米",
} as const

export type WeeklyRowSource = (typeof WEEKLY_ROW_SOURCE)[keyof typeof WEEKLY_ROW_SOURCE]

const WEEKLY_ROW_SOURCE_ORDER: WeeklyRowSource[] = [
  WEEKLY_ROW_SOURCE.pool,
  WEEKLY_ROW_SOURCE.public,
  WEEKLY_ROW_SOURCE.xiaohe,
  WEEKLY_ROW_SOURCE.ima,
  WEEKLY_ROW_SOURCE.yingmi,
]

/** One cell lists every place the product appears, in a stable order. */
export function joinWeeklyRowSources(sources: Iterable<WeeklyRowSource>): string {
  const present = new Set(sources)
  return WEEKLY_ROW_SOURCE_ORDER.filter((source) => present.has(source)).join("/")
}

export type XiaoheReturnMode = "excess" | "absolute"

export type XiaohePeriods = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
}

export type XiaoheComparable = {
  ret: XiaohePeriods
  excess: XiaohePeriods
  excess_dd_6m: number | null
  excess_dd_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

export type XiaoheCatalogHit = {
  beian: string
  name: string
  manager: string
  key: string
}

const LEGAL_PHRASES = [
  "私募证券投资基金",
  "证券投资私募基金",
  "私募投资基金",
  "证券投资基金",
  "私募基金",
  "投资基金",
  "集合资金信托计划",
]

const CN: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

const INDEX_KEYS = new Set([
  "沪深300指数",
  "沪深300",
  "中证500指数",
  "中证500",
  "中证1000指数",
  "中证1000",
  "中证2000指数",
  "中证2000",
  "中证A500指数",
  "中证A500",
  "中证红利",
  "中证红利指数",
  "万得小市值",
  "万得全A",
  "中证全指",
])

/** Longer labels first so A500 / 1000 / 2000 win over 500. */
const STRATEGY_BUCKETS: Array<[RegExp, string]> = [
  [/A500指增/u, "A500指增"],
  [/300指增/u, "300指增"],
  [/1000指增/u, "1000指增"],
  [/2000指增/u, "2000指增"],
  [/(?<![12A])500指增/u, "500指增"],
  [/全指指增/u, "中证全指指增"],
  [/红利指增/u, "红利指增"],
  [/小市值指增/u, "小市值指增"],
  [/市场中性/u, "量化中性"],
  [/量化择时/u, "择时择股"],
  [/股票多空/u, "股票多空"],
  [/主观多头/u, "主观多头"],
  [/量化股票|量化选股/u, "量化选股"],
]

function cnToInt(token: string): number | null {
  if (!token) return null
  if (token === "十") return 10
  if (token.includes("十")) {
    const [left, right] = token.split("十")
    if (left && !(left in CN)) return null
    if (right && !(right in CN)) return null
    const tens = left ? CN[left]! : 1
    const ones = right ? CN[right]! : 0
    return tens * 10 + ones
  }
  if (token.length === 1 && token in CN) return CN[token]!
  return null
}

function arabicHao(text: string): string {
  return text.replace(/([零〇一二两三四五六七八九十]+)号/gu, (full, token: string) => {
    const n = cnToInt(token)
    return n == null ? full : `${n}号`
  })
}

/** Same product under 玉数涵瑞二号 and 玉数涵瑞2号私募证券投资基金. */
export function xiaoheNameKey(name: string): string {
  let s = (name || "").trim()
  s = s.replace(/[—–]/g, "一").replace(/－/g, "")
  s = s.replace(/[（(][^）)]*[）)]/g, "")
  s = s.replace(/[-·•．.]/g, "")
  s = s.replace(/基金[ABC]$/u, "基金")
  s = s.replace(/[ABC]类(?:份额)?$/u, "")
  if (s.length > 4 && /[\u4e00-\u9fff][ABC]$/u.test(s) && !s.endsWith("全A")) s = s.slice(0, -1)
  for (const phrase of LEGAL_PHRASES) s = s.replaceAll(phrase, "")
  s = s.replace(/基金/g, "")
  s = s.replace(/号量化$/u, "号")
  s = s.replace(/\s+/g, "")
  s = s.replace(/号号/g, "号")
  s = s.replace(/(?<![0-9一二三四五六七八九十])号/gu, "一号")
  return arabicHao(s)
}

export function isXiaoheIndexName(name: string): boolean {
  const key = xiaoheNameKey(name)
  return !key || INDEX_KEYS.has(key) || (key.endsWith("指数") && !key.includes("增强") && key.length <= 8)
}

/**
 * Strategy cell from the 小荷 sheet, turned into a 周度回顾 bucket.
 * A cell that glued two products together (two decimals jammed on the label) is skipped.
 * 量化CTA、债券、套利、宏观 are not stock-weekly strategies.
 */
export function xiaoheStrategyBucket(strategy: string): string | null {
  const compact = strategy.replace(/\s+/g, "")
  if (!compact || compact === "未分类") return null
  if (/\d+\.\d+\d+\.\d+/.test(compact)) return null
  const cleaned = compact.replace(/(?:\d+\.\d+)+%?$/u, "")
  if (!cleaned) return null
  for (const [pattern, bucket] of STRATEGY_BUCKETS) {
    if (pattern.test(cleaned)) return bucket
  }
  return null
}

function finite(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value)
}

export function hasXiaoheComparable(mode: XiaoheReturnMode, row: XiaoheComparable): boolean {
  if (mode === "excess") {
    return [
      row.excess.ret_1w, row.excess.ret_1m, row.excess.ret_3m, row.excess.ret_6m, row.excess.ret_1y,
      row.excess_dd_6m, row.excess_dd_1y,
    ].some(finite)
  }
  return [
    row.ret.ret_1w, row.ret.ret_1m, row.ret.ret_3m, row.ret.ret_6m, row.ret.ret_1y,
    row.sharpe_1y, row.calmar_1y,
  ].some(finite)
}

/**
 * Prefer a full row computed from our NAV on this sheet's 口径.
 * The published 小荷 number is an absolute week return. It can fill an
 * absolute-return sheet, and it is not written into an excess column.
 * 今年以来 is not 近一年, so it is never copied.
 */
function pickMetric(primary: number | null | undefined, fallback: number | null | undefined): number | null {
  if (primary != null && Number.isFinite(primary)) return primary
  if (fallback != null && Number.isFinite(fallback)) return fallback
  return null
}

/**
 * NAV wins on each column. A column the NAV cannot fill takes the published
 * number of that same window and the same 口径.
 */
export function mergeXiaoheComparable(
  mode: XiaoheReturnMode,
  database: XiaoheComparable | null,
  published: XiaoheComparable | null,
): XiaoheComparable | null {
  const out: XiaoheComparable = {
    ret: emptyXiaohePeriods(),
    excess: emptyXiaohePeriods(),
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
  if (mode === "excess") {
    out.excess = {
      ret_1w: pickMetric(database?.excess.ret_1w, published?.excess.ret_1w),
      ret_1m: pickMetric(database?.excess.ret_1m, published?.excess.ret_1m),
      ret_3m: pickMetric(database?.excess.ret_3m, published?.excess.ret_3m),
      ret_6m: pickMetric(database?.excess.ret_6m, published?.excess.ret_6m),
      ret_1y: pickMetric(database?.excess.ret_1y, published?.excess.ret_1y),
    }
    out.excess_dd_6m = pickMetric(database?.excess_dd_6m, published?.excess_dd_6m)
    out.excess_dd_1y = pickMetric(database?.excess_dd_1y, published?.excess_dd_1y)
  } else {
    out.ret = {
      ret_1w: pickMetric(database?.ret.ret_1w, published?.ret.ret_1w),
      ret_1m: pickMetric(database?.ret.ret_1m, published?.ret.ret_1m),
      ret_3m: pickMetric(database?.ret.ret_3m, published?.ret.ret_3m),
      ret_6m: pickMetric(database?.ret.ret_6m, published?.ret.ret_6m),
      ret_1y: pickMetric(database?.ret.ret_1y, published?.ret.ret_1y),
    }
    out.sharpe_1y = pickMetric(database?.sharpe_1y, published?.sharpe_1y)
    out.calmar_1y = pickMetric(database?.calmar_1y, published?.calmar_1y)
  }
  return hasXiaoheComparable(mode, out) ? out : null
}

export function chooseXiaoheMetrics(
  mode: XiaoheReturnMode,
  database: XiaoheComparable | null,
  published: XiaoheComparable | null,
): "database" | "published" | null {
  if (database && hasXiaoheComparable(mode, database)) return "database"
  if (published && hasXiaoheComparable(mode, published)) return "published"
  return null
}

export function emptyXiaohePeriods(): XiaohePeriods {
  return { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }
}

export function publishedWeekMetrics(ret1w: number): XiaoheComparable {
  return {
    ret: { ...emptyXiaohePeriods(), ret_1w: ret1w },
    excess: emptyXiaohePeriods(),
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

export type XiaoheOcrRow = {
  product: string
  manager: string
  strategy: string
  ret: XiaohePeriods
  /** 本周超额. 今年超额 is not 近一年超额, so it is not stored. */
  excess1w: number | null
  /**
   * Longer excess windows: the same absolute window minus that strategy's index.
   * 近一周超额 stays in excess1w, taken from the printed 本周超额.
   */
  excessWindows?: XiaohePeriods
}

export type XiaoheOcrSheet = {
  kind: "absolute" | "excess" | "none"
  rows: XiaoheOcrRow[]
}

function cellText(value: unknown): string {
  if (value == null) return ""
  return String(value).trim()
}

function compactCell(value: unknown): string {
  return cellText(value).replace(/\s+/g, "")
}

function repairPercent(raw: string): number | null {
  let text = raw
  text = text.replace(/^(-?)\.(\d+)%$/, "$10.$2%")
  const leadingZero = text.match(/^(-?)0(\d+)%$/)
  if (leadingZero) text = `${leadingZero[1]}0.${leadingZero[2]}%`
  // OCR drops the decimal in a cell like -990%, which is -9.90%.
  const missingDot = text.match(/^(-?)(\d{3,})%$/)
  if (missingDot) text = `${missingDot[1]}${missingDot[2].slice(0, -2)}.${missingDot[2].slice(-2)}%`
  const n = Number(text.slice(0, -1))
  if (!Number.isFinite(n)) return null
  return n / 100
}

function percentTokens(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(/-?(?:\d+\.\d+|\.\d+|\d+)%/g)) {
    const n = repairPercent(match[0])
    if (n != null) out.push(n)
  }
  return out
}

function saneWeek(value: number | null): value is number {
  return value != null && Math.abs(value) <= 0.4
}

function preferWeek(current: number | null, incoming: number | null): number | null {
  if (saneWeek(current)) return current
  if (saneWeek(incoming)) return incoming
  return null
}

function columnIndex(row: unknown[], pattern: RegExp): number {
  for (let i = 0; i < row.length; i++) {
    if (pattern.test(compactCell(row[i]))) return i
  }
  return -1
}

function findOcrHeader(grid: unknown[][]): { headerAt: number; subAt: number | null } | null {
  const limit = Math.min(grid.length, 12)
  for (let i = 0; i < limit; i++) {
    const texts = (grid[i] ?? []).map(compactCell)
    const hasStrategy = texts.some((text) => text === "策略" || text === "策略类型")
    const hasName = texts.some((text) => text === "基金简称" || text === "产品名称" || text === "产品简称")
    if (!hasStrategy || !hasName) continue
    const nextText = (grid[i + 1] ?? []).map(compactCell).join("")
    const sub = /本周收益|本周超额|存续时间|成立以来|近3月|近三月/.test(nextText)
    return { headerAt: i, subAt: sub ? i + 1 : null }
  }
  return null
}

function weekFromAbsoluteCell(value: unknown, subheader: string): number | null {
  const tokens = percentTokens(cellText(value))
  if (tokens.length === 1) return tokens[0] ?? null
  if (tokens.length >= 3 && /成立以来|回撤/.test(subheader)) return tokens[tokens.length - 1] ?? null
  return null
}

function periodsFromMonthCell(value: unknown, subheader: string): XiaohePeriods {
  const periods = emptyXiaohePeriods()
  const slots: Array<keyof XiaohePeriods | "ret_2y" | "ret_3y"> = ["ret_1m"]
  if (/近3月|近三月/.test(subheader)) slots.push("ret_3m")
  if (/近6月|近六月/.test(subheader)) slots.push("ret_6m")
  if (/近1年|近一年/.test(subheader)) slots.push("ret_1y")
  if (/近2年/.test(subheader)) slots.push("ret_2y")
  if (/近3年/.test(subheader)) slots.push("ret_3y")
  const tokens = percentTokens(cellText(value))
  // A short history omits 近2年 / 近3年. Extra tokens mean two products were glued together.
  if (tokens.length === 0 || tokens.length > slots.length) return periods
  for (let i = 0; i < tokens.length; i++) {
    const slot = slots[i]
    const value = tokens[i]
    if (slot === "ret_2y" || slot === "ret_3y" || slot == null || value == null) continue
    if (Math.abs(value) > 1.5) continue
    periods[slot] = value
  }
  return periods
}

function labeledPercent(tokens: number[], subheader: string, weekLabel: string, laterLabel: string): number | null {
  if (tokens.length === 0 || !subheader.includes(weekLabel)) return null
  const weekAt = subheader.indexOf(weekLabel)
  const laterAt = subheader.indexOf(laterLabel)
  const weekIsFirst = laterAt < 0 || weekAt < laterAt
  if (weekIsFirst) return tokens[0] ?? null
  return tokens[1] ?? null
}

/**
 * Read one OCR sheet from a 小荷公众号 workbook.
 * The strategy cell's trailing number is years since inception, not a return.
 * On the absolute sheet the week return is the last percent in the cell under 近1周
 * (成立以来, 最大回撤, 本周收益). 今年以来 is left unread.
 * On the excess sheet the first percent under 本周超额 is the week excess.
 * 今年超额 is not 近一年超额, so it is left unread.
 */
export function parseXiaoheOcrGrid(grid: unknown[][]): XiaoheOcrSheet {
  const found = findOcrHeader(grid)
  if (!found) return { kind: "none", rows: [] }
  const header = grid[found.headerAt] ?? []
  const sub = found.subAt == null ? null : (grid[found.subAt] ?? [])
  const subJoined = (sub ?? []).map(compactCell).join("")
  const kind: "absolute" | "excess" = /本周超额/.test(subJoined) ? "excess" : "absolute"
  const productCol = columnIndex(header, /基金简称|产品名称|产品简称/)
  const managerCol = columnIndex(header, /^管理人$/)
  const strategyCol = columnIndex(header, /^策略$/)
  const weekCol = columnIndex(header, /^近1周$|^近一周$|近一周收益率|近1周收益率/)
  const monthCol = columnIndex(header, /^近1月$|^近一月$|近一月收益率|近1月收益率/)
  let excessCol = -1
  if (sub) {
    for (let i = 0; i < sub.length; i++) {
      if (/本周超额/.test(compactCell(sub[i]))) {
        excessCol = i
        break
      }
    }
  }
  const start = (found.subAt ?? found.headerAt) + 1
  const rows: XiaoheOcrRow[] = []
  for (let i = start; i < grid.length; i++) {
    const line = grid[i] ?? []
    const product = productCol < 0 ? "" : cellText(line[productCol])
    if (!product) continue
    const strategy = strategyCol < 0 ? "" : cellText(line[strategyCol])
    const manager = managerCol < 0 ? "" : cellText(line[managerCol])
    if (kind === "excess") {
      const strategySub = strategyCol < 0 || !sub ? "" : compactCell(sub[strategyCol])
      const excessSub = excessCol < 0 || !sub ? "" : compactCell(sub[excessCol])
      rows.push({
        product,
        manager,
        strategy,
        ret: {
          ...emptyXiaohePeriods(),
          ret_1w: labeledPercent(percentTokens(strategy), strategySub, "本周收益", "今年收益"),
        },
        excess1w: labeledPercent(percentTokens(excessCol < 0 ? "" : cellText(line[excessCol])), excessSub, "本周超额", "今年超额"),
      })
      continue
    }
    const periods = monthCol < 0 || !sub
      ? emptyXiaohePeriods()
      : periodsFromMonthCell(line[monthCol], compactCell(sub[monthCol]))
    const weekSub = weekCol < 0 || !sub ? "" : compactCell(sub[weekCol])
    periods.ret_1w = weekCol < 0 ? null : weekFromAbsoluteCell(line[weekCol], weekSub)
    rows.push({ product, manager, strategy, ret: periods, excess1w: null })
  }
  return { kind, rows }
}

function benchmarkBucket(product: string): string | null {
  const name = product.replace(/\s+/g, "")
  if (/A500/.test(name)) return "A500指增"
  if (/沪深300/.test(name)) return "300指增"
  if (/1000/.test(name)) return "1000指增"
  if (/2000/.test(name)) return "2000指增"
  if (/中证500/.test(name)) return "500指增"
  if (/红利/.test(name)) return "红利指增"
  if (/全指/.test(name)) return "中证全指指增"
  if (/万得全A|全A/.test(name)) return "量化选股"
  return null
}

function indexWeekByBucket(rows: XiaoheOcrRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!isXiaoheIndexName(row.product) || !saneWeek(row.ret.ret_1w)) continue
    const bucket = benchmarkBucket(row.product)
    if (!bucket || out.has(bucket)) continue
    out.set(bucket, row.ret.ret_1w)
  }
  return out
}

function indexPeriodsByBucket(rows: XiaoheOcrRow[]): Map<string, XiaohePeriods> {
  const out = new Map<string, XiaohePeriods>()
  for (const row of rows) {
    if (!isXiaoheIndexName(row.product)) continue
    const bucket = benchmarkBucket(row.product)
    if (!bucket || out.has(bucket)) continue
    out.set(bucket, row.ret)
  }
  return out
}

/** 小荷 prints 超额 as 收益 minus the index for that same window. */
function excessFromIndex(product: XiaohePeriods, index: XiaohePeriods | undefined): XiaohePeriods {
  const out = emptyXiaohePeriods()
  if (!index) return out
  for (const key of ["ret_1m", "ret_3m", "ret_6m", "ret_1y"] as const) {
    const left = product[key]
    const right = index[key]
    if (left == null || right == null) continue
    out[key] = left - right
  }
  return out
}

/**
 * Pick 本周超额. Two OCR readings of the same product are judged against
 * 本周收益 minus the benchmark week. A single reading is kept as printed.
 */
function preferExcess(
  current: number | null,
  incoming: number | null,
  absoluteWeek: number | null,
  indexWeek: number | null,
): number | null {
  const candidates = [current, incoming].filter(saneWeek)
  if (candidates.length === 0) return null
  if (absoluteWeek != null && indexWeek != null && candidates.length > 1) {
    const expected = absoluteWeek - indexWeek
    candidates.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))
  }
  return candidates[0] ?? null
}

/** Absolute windows keep the first sane value. Week excess is checked against 收益减基准. */
export function mergeXiaoheOcrRows(rows: XiaoheOcrRow[]): XiaoheOcrRow[] {
  const indexWeek = indexWeekByBucket(rows)
  const indexPeriods = indexPeriodsByBucket(rows)
  const byKey = new Map<string, XiaoheOcrRow>()
  for (const row of rows) {
    if (!row.product || isXiaoheIndexName(row.product)) continue
    const bucket = xiaoheStrategyBucket(row.strategy)
    if (!bucket) continue
    const nameKey = xiaoheNameKey(row.product)
    if (!nameKey) continue
    const key = `${bucket}\0${nameKey}`
    const prev = byKey.get(key)
    if (!prev) {
      const ret = { ...row.ret, ret_1w: preferWeek(null, row.ret.ret_1w) }
      byKey.set(key, {
        ...row,
        ret,
        excess1w: preferExcess(null, row.excess1w, ret.ret_1w, indexWeek.get(bucket) ?? null),
      })
      continue
    }
    prev.ret = {
      ret_1w: preferWeek(prev.ret.ret_1w, row.ret.ret_1w),
      ret_1m: prev.ret.ret_1m ?? row.ret.ret_1m,
      ret_3m: prev.ret.ret_3m ?? row.ret.ret_3m,
      ret_6m: prev.ret.ret_6m ?? row.ret.ret_6m,
      ret_1y: prev.ret.ret_1y ?? row.ret.ret_1y,
    }
    prev.excess1w = preferExcess(prev.excess1w, row.excess1w, prev.ret.ret_1w, indexWeek.get(bucket) ?? null)
    if (!prev.manager && row.manager) prev.manager = row.manager
  }
  for (const [key, row] of byKey) {
    const bucket = key.split("\0")[0] ?? ""
    row.excessWindows = excessFromIndex(row.ret, indexPeriods.get(bucket))
  }
  return [...byKey.values()]
}

export function xiaoheOcrComparable(row: XiaoheOcrRow): XiaoheComparable {
  return {
    ret: { ...row.ret },
    excess: { ...(row.excessWindows ?? emptyXiaohePeriods()), ret_1w: row.excess1w },
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

function managerToken(manager: string): string {
  return manager.split(/[-－/]/u)[0]?.replace(/FOF$/u, "").trim() ?? ""
}

function managerHit(manager: string, hit: XiaoheCatalogHit): boolean {
  const token = managerToken(manager)
  if (token.length < 2) return false
  return hit.manager.includes(token) || hit.name.includes(token)
}

function prefer(manager: string, hits: XiaoheCatalogHit[], requireManager: boolean): XiaoheCatalogHit | null {
  if (hits.length === 0) return null
  const confirmed = hits.filter((hit) => managerHit(manager, hit))
  if (confirmed.length > 0) {
    return [...confirmed].sort((a, b) => a.key.length - b.key.length || a.beian.localeCompare(b.beian))[0] ?? null
  }
  if (requireManager) return null
  return hits[0] ?? null
}

export function indexXiaoheCatalog(hits: XiaoheCatalogHit[]): {
  byKey: Map<string, XiaoheCatalogHit[]>
  suffixIndex: Map<string, XiaoheCatalogHit[]>
} {
  const byKey = new Map<string, XiaoheCatalogHit[]>()
  const suffixIndex = new Map<string, XiaoheCatalogHit[]>()
  for (const hit of hits) {
    if (!hit.key) continue
    const list = byKey.get(hit.key) ?? []
    if (!list.some((row) => row.beian === hit.beian)) list.push(hit)
    byKey.set(hit.key, list)
    for (let n = 1; n <= 6; n++) {
      if (hit.key.length - n < 6) continue
      const suffix = hit.key.slice(n)
      const bucket = suffixIndex.get(suffix) ?? []
      bucket.push(hit)
      suffixIndex.set(suffix, bucket)
    }
  }
  return { byKey, suffixIndex }
}

export function matchXiaoheCatalog(
  product: string,
  manager: string,
  byKey: Map<string, XiaoheCatalogHit[]>,
  suffixIndex: Map<string, XiaoheCatalogHit[]>,
): XiaoheCatalogHit | null {
  const key = xiaoheNameKey(product)
  if (key.length < 4 || isXiaoheIndexName(product)) return null
  const exact = byKey.get(key)
  if (exact?.length) return prefer(manager, exact, false)

  const stemmed = byKey.get(`${key}指数增强`) ?? byKey.get(`${key}指增`)
  if (stemmed?.length) {
    const hit = prefer(manager, stemmed, true)
    if (hit) return hit
  }
  if (!key.endsWith("号") && !key.endsWith("期")) {
    const one = byKey.get(`${key}1号`) ?? []
    const two = byKey.get(`${key}2号`) ?? []
    if (one.length > 0 && two.length === 0) {
      const hit = prefer(manager, one, true)
      if (hit) return hit
    }
  }
  if (key.length >= 6) {
    const prefixed = suffixIndex.get(key) ?? []
    const hit = prefer(manager, prefixed, true)
    if (hit) return hit
  }
  return null
}

export type ImaRankRow = {
  manager: string
  /** 基金经理 when the board has that column. Empty otherwise. */
  pm: string
  strategy: string
  /** 近一周收益率, absolute. Null when the cell is empty. */
  ret1w: number | null
  /** 近一周超额. Null on boards that only publish absolute returns. */
  excess1w: number | null
}

function imaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = cellText(value).replace(/,/g, "")
  if (!text || text === "-" || text === "—" || text === "–") return null
  const percent = text.endsWith("%")
  const n = Number(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(n)) return null
  return percent ? n / 100 : n
}

function scaleIfPercent(values: Array<number | null>): number {
  const abs = values.map((value) => (value == null ? null : Math.abs(value))).filter((value): value is number => value != null && value > 0)
  abs.sort((a, b) => a - b)
  if (abs.length === 0) return 1
  return abs[Math.floor(abs.length / 2)]! > 3 ? 0.01 : 1
}

/**
 * One ima点睛 manager board. Rows are managers, not products.
 * 近一周收益率 is absolute. 近一周超额 is excess. 今年以来 is not 近一年.
 */
export function parseImaRankGrid(grid: unknown[][]): ImaRankRow[] {
  const limit = Math.min(grid.length, 8)
  let headerAt = -1
  for (let i = 0; i < limit; i++) {
    const texts = (grid[i] ?? []).map(compactCell)
    if (texts.includes("基金管理人") && texts.some((text) => text === "近一周收益率" || text === "近一周超额" || text === "近一周收益")) {
      headerAt = i
      break
    }
  }
  if (headerAt < 0) return []
  const header = grid[headerAt] ?? []
  const managerCol = columnIndex(header, /^基金管理人$/)
  const pmCol = columnIndex(header, /^基金经理$/)
  const strategyCol = columnIndex(header, /^策略类型$|^策略$/)
  const weekCol = columnIndex(header, /^近一周收益率$|^近1周收益率$|^近一周收益$/)
  const excessCol = columnIndex(header, /^近一周超额$/)
  const pending: ImaRankRow[] = []
  for (let i = headerAt + 1; i < grid.length; i++) {
    const line = grid[i] ?? []
    const manager = managerCol < 0 ? "" : cellText(line[managerCol])
    if (!manager || manager === "基金管理人") continue
    pending.push({
      manager,
      pm: pmCol < 0 ? "" : cellText(line[pmCol]),
      strategy: strategyCol < 0 ? "" : cellText(line[strategyCol]),
      ret1w: weekCol < 0 ? null : imaNumber(line[weekCol]),
      excess1w: excessCol < 0 ? null : imaNumber(line[excessCol]),
    })
  }
  const weekScale = scaleIfPercent(pending.map((row) => row.ret1w))
  const excessScale = scaleIfPercent(pending.map((row) => row.excess1w))
  return pending.map((row) => ({
    ...row,
    ret1w: row.ret1w == null ? null : row.ret1w * weekScale,
    excess1w: row.excess1w == null ? null : row.excess1w * excessScale,
  }))
}

export function imaDisplayName(row: Pick<ImaRankRow, "manager" | "pm">): string {
  const manager = row.manager.trim()
  const pm = row.pm.trim()
  if (!pm || pm === manager) return manager
  return `${manager}-${pm}`
}
