/**
 * Parse an external manager/product ranking workbook (Dianjing performance boards)
 * and join those rows to pool products that already have returns attached.
 */

import * as XLSX from "xlsx"
import { fundMatchesObservationCategory, type StrategyObservationLabels } from "@/lib/ma/strategy-observation"

export const EXTERNAL_RANK_CLASSES = ["主观多头", "量化股票", "量化CTA", "主观CTA"] as const
export type ExternalRankClass = (typeof EXTERNAL_RANK_CLASSES)[number]

export type ExternalRankWindow = "ytd" | "1y"

export type ExternalRankRow = {
  rank: number
  strategy: string
  class_key: string
  manager: string
  product: string | null
  aum: string | null
  nav_date: string | null
  ytd: number | null
  ytd_drawdown: number | null
  ret_1w: number | null
  sheet: string
}

export type ParsedExternalRank = {
  title: string
  as_of: string
  window: ExternalRankWindow
  window_label: string
  classes: string[]
  rows: ExternalRankRow[]
}

export type PoolRankProduct = {
  beian_hao: string
  name: string
  manager: string | null
  bucket: string
  l1: string | null
  l2: string | null
  l3: string | null
  /** Decimal return, 0.12 = 12%. */
  ytd: number | null
  ret_1w: number | null
}

type ProductHit = {
  beian_hao: string
  name: string
  bucket: string
  ytd: number | null
  ret_1w: number | null
}

type BothRow = {
  external_rank: number
  manager: string
  product: string | null
  aum: string | null
  their_return: number | null
  their_drawdown: number | null
  their_1w: number | null
  our_rank: number | null
  rank_gap: number | null
  match_confidence: number
  our_manager: string | null
  our_return: number | null
  our_1w: number | null
  products: ProductHit[]
}

type ExternalOnlyRow = {
  external_rank: number
  manager: string
  product: string | null
  aum: string | null
  their_return: number | null
  their_drawdown: number | null
  their_1w: number | null
}

type PoolOnlyRow = {
  our_rank: number | null
  manager: string
  our_return: number | null
  our_1w: number | null
  products: ProductHit[]
}

type ReviewRow = {
  external_rank: number
  manager: string
  product: string | null
  their_return: number | null
  reason: string
  candidates: Array<{ manager: string; confidence: number }>
}

export type ExternalRankComparison = {
  class_key: string
  as_of: string
  window: ExternalRankWindow
  window_label: string
  returns_are_percent: true
  screened: number
  external_count: number
  both: BothRow[]
  external_only: ExternalOnlyRow[]
  pool_only: PoolOnlyRow[]
  needs_review: ReviewRow[]
}

const QUANT_EQUITY = ["量化选股", "量化精选", "量化多头", "1000指增", "500指增", "300指增", "A500指增", "2000指增", "股票市场中性"]

const LEGAL_SUFFIXES = [
  "私募基金管理合伙企业（有限合伙）",
  "私募基金管理合伙企业",
  "私募基金管理有限公司",
  "基金管理有限公司",
  "资产管理有限公司",
  "投资管理有限公司",
  "投资管理合伙企业",
  "私募证券投资基金",
  "证券投资基金",
  "私募基金",
  "私募证券",
  "私募",
]

type HeaderKind = "rank" | "strategy" | "manager" | "product" | "aum" | "nav_date" | "ytd" | "ytd_dd" | "ret_1w"

export function normalizeExternalRankClass(raw: string): ExternalRankClass | null {
  const s = raw.replace(/\s+/g, "")
  if (!s) return null
  if (/主观多头|主观精选|股票主观/.test(s)) return "主观多头"
  if (/量化股票|量化选股|量化多头|量化精选/.test(s)) return "量化股票"
  if (/主观(?:cta|期货)/i.test(s)) return "主观CTA"
  if (/量化(?:cta|期货)|管理期货|(?:^|[^主观])cta/i.test(s)) return "量化CTA"
  return null
}

/** User text or a sheet strategy cell, turned into the class key used on both sides. */
export function resolveRankClass(raw: string): string | null {
  const family = normalizeExternalRankClass(raw)
  if (family) return family
  const compact = raw.replace(/\s+/g, "")
  if (!compact) return null
  if (/^\d{3,4}指增$/.test(compact) || compact === "A500指增" || compact === "指数增强") return compact
  return null
}

export function managerMatchKey(name: string): string {
  let s = name.replace(/\s+/g, "").replace(/[（(][^）)]{0,20}[）)]/g, "")
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(suffix) && s.length - suffix.length >= 2) {
        s = s.slice(0, -suffix.length)
        changed = true
      }
    }
  }
  for (const suffix of ["投资", "资产", "资本", "基金"]) {
    if (s.endsWith(suffix) && s.length - suffix.length >= 2) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s
}

export function productMatchKey(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/[（(][^）)]{0,20}[）)]/g, "")
    .replace(/[ABC]类份额$/u, "")
    .replace(/份额$/u, "")
    .replace(/[ABC]类$/u, "")
    .replace(/私募证券投资基金$/u, "")
    .replace(/证券投资基金$/u, "")
}

function headerKind(cell: string): HeaderKind | null {
  const s = cell.replace(/\s+/g, "")
  if (!s) return null
  if (s === "序号" || s === "排名") return "rank"
  if (/策略类型|策略分类|策略名称|^策略$/.test(s)) return "strategy"
  if (/基金管理人|管理人名称|^管理人$/.test(s)) return "manager"
  if (/产品名称|产品简称|基金名称|基金简称/.test(s)) return "product"
  if (/管理规模|^规模$/.test(s)) return "aum"
  if (/净值日期|截止日期|统计截止/.test(s)) return "nav_date"
  if (/今年以来收益率|今年来收益率|今年以来收益|今年来收益|近一年收益率|过去一年收益率|^今年$|^20\d{2}年$/.test(s)) return "ytd"
  if (/今年以来最大回撤|今年来最大回撤|今年最大回撤/.test(s)) return "ytd_dd"
  if (/近一周收益率|近1周收益率|一周收益率|近一周收益|^近1周$|^近一周$/.test(s)) return "ret_1w"
  return null
}

function cellText(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatIsoDate(value)
  return String(value).trim()
}

function formatIsoDate(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, "0")
  const d = String(value.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function parseIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatIsoDate(value)
  const text = cellText(value).replace(/\//g, "-")
  const full = text.match(/(20\d{2})(?:[-年/.](\d{1,2})[-月/.](\d{1,2})|(\d{2})(\d{2}))/)
  if (!full) return null
  const year = Number(full[1])
  const month = Number(full[2] || full[4])
  const day = Number(full[3] || full[5])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const raw = cellText(value).replace(/,/g, "")
  if (!raw || raw === "-" || raw === "—" || raw === "–") return null
  const percent = raw.endsWith("%")
  const n = Number(percent ? raw.slice(0, -1) : raw)
  if (!Number.isFinite(n)) return null
  return percent ? n / 100 : n
}

function returnScale(values: Array<number | null>): number {
  const abs = values.map((v) => (v == null ? null : Math.abs(v))).filter((v): v is number => v != null && v > 0)
  abs.sort((a, b) => a - b)
  if (abs.length === 0) return 1
  const mid = abs[Math.floor(abs.length / 2)]
  return mid > 3 ? 0.01 : 1
}

function inferAsOf(sheetNames: string, fileName: string, title: string, dates: string[]): string | null {
  const counted = new Map<string, number>()
  for (const date of dates) counted.set(date, (counted.get(date) ?? 0) + 1)
  const mode = [...counted.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0]
  if (mode) return mode
  return parseIsoDate(`${sheetNames} ${fileName} ${title}`)
}

function inferWindow(title: string, headers: string[]): ExternalRankWindow {
  const blob = `${title} ${headers.join(" ")}`
  if (/近一年|过去一年/.test(blob) && !/今年以来|今年来/.test(blob)) return "1y"
  return "ytd"
}

function classKeyForStrategy(strategy: string): string {
  const compact = strategy.replace(/\s+/g, "")
  if (!compact || /^-?\d+(?:\.\d+)?%$/.test(compact) || /降序|升序/.test(compact)) return "未分类"
  return resolveRankClass(strategy) ?? compact
}

export function parseExternalRankWorkbook(data: Buffer | Uint8Array, fileName = ""): ParsedExternalRank {
  const workbook = XLSX.read(data, { type: "buffer", cellDates: true })
  const baseName = fileName.split(/[/\\]/).pop() ?? fileName
  const rows: ExternalRankRow[] = []
  const seenRows = new Set<string>()
  let title = ""
  const asOfCandidates: string[] = []
  let window: ExternalRankWindow = "ytd"
  let sawHeader = false

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const grid = XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    })
    let headerAt = -1
    let columns = new Map<number, HeaderKind>()
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
      const kinds = new Map<number, HeaderKind>()
      for (let c = 0; c < (grid[i]?.length ?? 0); c++) {
        const kind = headerKind(cellText(grid[i][c]))
        if (kind && ![...kinds.values()].includes(kind)) kinds.set(c, kind)
      }
      const values = [...kinds.values()]
      if ((values.includes("manager") || values.includes("product")) && (values.includes("ytd") || values.includes("ret_1w"))) {
        headerAt = i
        columns = kinds
        sawHeader = true
        break
      }
    }
    if (headerAt < 0) continue

    const headerTexts = (grid[headerAt] ?? []).map((cell) => cellText(cell)).filter(Boolean)
    for (let i = 0; i < headerAt; i++) {
      for (const cell of grid[i] ?? []) {
        const text = cellText(cell)
        if (text.length > title.length) title = text
      }
    }
    window = inferWindow(`${title} ${sheetName} ${baseName}`, headerTexts)

    const kindAt = (kind: HeaderKind) => [...columns.entries()].find(([, value]) => value === kind)?.[0]
    const rankCol = kindAt("rank")
    const strategyCol = kindAt("strategy")
    const managerCol = kindAt("manager")
    const productCol = kindAt("product")
    const aumCol = kindAt("aum")
    const dateCol = kindAt("nav_date")
    const ytdCol = kindAt("ytd")
    const ddCol = kindAt("ytd_dd")
    const weekCol = kindAt("ret_1w")

    const pending: ExternalRankRow[] = []
    let sequence = 0
    for (let i = headerAt + 1; i < grid.length; i++) {
      const line = grid[i] ?? []
      const manager = managerCol == null ? "" : cellText(line[managerCol])
      const product = productCol == null ? "" : cellText(line[productCol])
      if (!manager && !product) continue
      sequence += 1
      const strategy = strategyCol == null ? "" : cellText(line[strategyCol])
      const navDate = dateCol == null ? null : parseIsoDate(line[dateCol])
      if (navDate) asOfCandidates.push(navDate)
      const rankValue = rankCol == null ? null : parseNumber(line[rankCol])
      pending.push({
        rank: rankValue != null && rankValue > 0 ? Math.round(rankValue) : sequence,
        strategy,
        class_key: classKeyForStrategy(strategy || sheetName || baseName),
        manager,
        product: product || null,
        aum: aumCol == null ? null : cellText(line[aumCol]) || null,
        nav_date: navDate,
        ytd: ytdCol == null ? null : parseNumber(line[ytdCol]),
        ytd_drawdown: ddCol == null ? null : parseNumber(line[ddCol]),
        ret_1w: weekCol == null ? null : parseNumber(line[weekCol]),
        sheet: sheetName,
      })
    }

    const ytdScale = returnScale(pending.map((row) => row.ytd))
    const ddScale = returnScale(pending.map((row) => row.ytd_drawdown))
    const weekScale = returnScale(pending.map((row) => row.ret_1w))
    for (const row of pending) {
      const scaled = {
        ...row,
        ytd: row.ytd == null ? null : row.ytd * ytdScale,
        ytd_drawdown: row.ytd_drawdown == null ? null : Math.abs(row.ytd_drawdown * ddScale),
        ret_1w: row.ret_1w == null ? null : row.ret_1w * weekScale,
      }
      const key = `${scaled.manager}\0${scaled.product || ""}\0${scaled.class_key}`
      if (seenRows.has(key)) continue
      seenRows.add(key)
      rows.push(scaled)
    }
  }

  if (!sawHeader || rows.length === 0) {
    throw new Error("这份表格不是业绩榜：没有找到「基金管理人」或「产品名称」以及收益率列")
  }

  const asOf = inferAsOf(workbook.SheetNames.join(" "), baseName, title, asOfCandidates)
  if (!asOf) throw new Error("业绩榜里没有截止日期。文件名或表头需要带上如 20250930 的日期")

  const classes = [...new Set(rows.map((row) => row.class_key))]
  return {
    title,
    as_of: asOf,
    window,
    window_label: window === "ytd" ? "今年以来" : "近一年",
    classes,
    rows,
  }
}

export function fundInRankClass(
  fund: { l1: string | null; l2: string | null; l3: string | null; product_name: string },
  classKey: string,
): boolean {
  const labels: StrategyObservationLabels = {
    l1: fund.l1 ?? "",
    l2: fund.l2 ?? "",
    l3: fund.l3 ?? "",
    name: fund.product_name,
  }
  if (classKey === "量化股票") return QUANT_EQUITY.some((category) => fundMatchesObservationCategory(category, labels))
  if (classKey === "主观多头") return fundMatchesObservationCategory("主观多头", labels)
  if (classKey === "量化CTA") return fundMatchesObservationCategory("量化期货", labels)
  if (classKey === "主观CTA") return fundMatchesObservationCategory("主观期货", labels)
  return fundMatchesObservationCategory(classKey, labels)
}

const QUANT_EQUITY_ROW_KEYS = new Set<string>([...QUANT_EQUITY, "量化股票", "指数增强"])

export function rowMatchesRankClass(row: { class_key: string; strategy: string }, requested: string): boolean {
  const key = row.class_key || resolveRankClass(row.strategy) || ""
  if (key === requested || resolveRankClass(row.strategy) === requested) return true
  if (requested === "量化股票" && QUANT_EQUITY_ROW_KEYS.has(key)) return true
  if (requested === "量化CTA" && (key === "量化期货" || key === "管理期货")) return true
  if (requested === "主观CTA" && key === "主观期货") return true
  return false
}

export function selectParsedClass(parsed: ParsedExternalRank, requested: string | null): {
  classKey: string
  classKeys: string[]
  rows: ExternalRankRow[]
} {
  const classes = parsed.classes.filter((key) => key && key !== "未分类")
  if (requested) {
    const rows = parsed.rows.filter((row) => rowMatchesRankClass(row, requested))
    if (rows.length === 0) {
      throw new Error(`这份榜单的策略是${classes.join("、") || "未识别"}，里面没有「${requested}」`)
    }
    const classKeys = [...new Set(rows.map((row) => row.class_key))]
    return { classKey: classKeys.length === 1 ? classKeys[0] : requested, classKeys, rows }
  }
  if (classes.length === 1) {
    const rows = parsed.rows.filter((row) => row.class_key === classes[0])
    return { classKey: classes[0], classKeys: [classes[0]], rows }
  }
  throw new Error(`这份榜单里有多个策略（${classes.join("、")}），请指定 class`)
}

type ManagerGroup = {
  key: string
  manager: string
  products: PoolRankProduct[]
  ytd: number | null
  ret1w: number | null
  rank: number | null
}

function toPct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 10000) / 100
}

function productHit(product: PoolRankProduct): ProductHit {
  return {
    beian_hao: product.beian_hao,
    name: product.name,
    bucket: product.bucket,
    ytd: toPct(product.ytd),
    ret_1w: toPct(product.ret_1w),
  }
}

function bestReturn(products: PoolRankProduct[], field: "ytd" | "ret_1w"): number | null {
  let best: number | null = null
  for (const product of products) {
    const value = product[field]
    if (value == null) continue
    if (best == null || value > best) best = value
  }
  return best
}

function nameScore(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  if (shorter.length < 2 || !longer.includes(shorter)) return 0
  if (shorter.length >= 3 && shorter.length / longer.length >= 0.6) return 0.92
  return 0.8
}

function groupPool(products: PoolRankProduct[]): ManagerGroup[] {
  const groups = new Map<string, ManagerGroup>()
  for (const product of products) {
    const manager = (product.manager || "").trim()
    const key = manager ? managerMatchKey(manager) : ""
    const id = key || `unknown:${product.beian_hao}`
    const existing = groups.get(id)
    if (!existing) {
      groups.set(id, {
        key,
        manager: manager || "（管理人未登记）",
        products: [product],
        ytd: null,
        ret1w: null,
        rank: null,
      })
      continue
    }
    existing.products.push(product)
    if (manager.length > existing.manager.length && key) existing.manager = manager
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.products.sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
    group.ytd = bestReturn(group.products, "ytd")
    group.ret1w = bestReturn(group.products, "ret_1w")
  }
  list.sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
  let rank = 0
  for (const group of list) {
    if (group.ytd == null) {
      group.rank = null
      continue
    }
    rank += 1
    group.rank = rank
  }
  return list
}

function claimGroup(
  row: ExternalRankRow,
  groups: ManagerGroup[],
  claimed: Set<string>,
): { group: ManagerGroup; confidence: number } | { review: ReviewRow } | null {
  if (row.product) {
    const key = productMatchKey(row.product)
    let best: { group: ManagerGroup; confidence: number } | null = null
    for (const group of groups) {
      for (const product of group.products) {
        const confidence = nameScore(key, productMatchKey(product.name))
        if (!best || confidence > best.confidence) best = { group, confidence }
      }
    }
    if (best && best.confidence >= 0.9) {
      const id = best.group.key || best.group.manager
      if (!claimed.has(id)) return { group: best.group, confidence: best.confidence }
    }
  }

  const key = managerMatchKey(row.manager)
  const scored = groups
    .filter((group) => group.key)
    .map((group) => ({ group, confidence: nameScore(key, group.key) }))
    .filter((item) => item.confidence >= 0.8)
    .sort((a, b) => b.confidence - a.confidence)

  const top = scored[0]
  if (!top) return null
  const tied = scored.filter((item) => item.confidence === top.confidence && item.group.key !== top.group.key)
  if (top.confidence < 0.9 || tied.length > 0) {
    return {
      review: {
        external_rank: row.rank,
        manager: row.manager,
        product: row.product,
        their_return: toPct(row.ytd),
        reason: tied.length > 0 ? "多个管理人名称接近，没有自动匹配" : "名称只是部分相同，没有自动匹配",
        candidates: scored.slice(0, 3).map((item) => ({
          manager: item.group.manager,
          confidence: item.confidence,
        })),
      },
    }
  }
  if (claimed.has(top.group.key)) {
    return {
      review: {
        external_rank: row.rank,
        manager: row.manager,
        product: row.product,
        their_return: toPct(row.ytd),
        reason: "归一后的管理人已经对应榜单里更靠前的一行",
        candidates: [{ manager: top.group.manager, confidence: top.confidence }],
      },
    }
  }
  return { group: top.group, confidence: top.confidence }
}

export function buildExternalRankComparison(
  rows: ExternalRankRow[],
  classKey: string,
  pool: PoolRankProduct[],
  topN: number,
  window: ExternalRankWindow = "ytd",
  asOf = "",
): ExternalRankComparison {
  const ranked = [...rows].sort((a, b) => a.rank - b.rank)
  const screened = ranked.slice(0, Math.max(1, topN))
  const groups = groupPool(pool)
  const claimed = new Set<string>()
  const both: BothRow[] = []
  const externalOnly: ExternalOnlyRow[] = []
  const needsReview: ReviewRow[] = []

  for (const row of screened) {
    const hit = claimGroup(row, groups, claimed)
    if (!hit) {
      externalOnly.push({
        external_rank: row.rank,
        manager: row.manager,
        product: row.product,
        aum: row.aum,
        their_return: toPct(row.ytd),
        their_drawdown: toPct(row.ytd_drawdown),
        their_1w: toPct(row.ret_1w),
      })
      continue
    }
    if ("review" in hit) {
      needsReview.push(hit.review)
      continue
    }
    const claimId = hit.group.key || hit.group.manager
    claimed.add(claimId)
    const products = row.product
      ? hit.group.products.filter((product) => nameScore(productMatchKey(row.product || ""), productMatchKey(product.name)) >= 0.9)
      : hit.group.products
    const shown = (products.length > 0 ? products : hit.group.products).slice(0, 8)
    both.push({
      external_rank: row.rank,
      manager: row.manager,
      product: row.product,
      aum: row.aum,
      their_return: toPct(row.ytd),
      their_drawdown: toPct(row.ytd_drawdown),
      their_1w: toPct(row.ret_1w),
      our_rank: hit.group.rank,
      rank_gap: hit.group.rank == null ? null : hit.group.rank - row.rank,
      match_confidence: hit.confidence,
      our_manager: hit.group.manager,
      our_return: toPct(bestReturn(shown, "ytd")),
      our_1w: toPct(bestReturn(shown, "ret_1w")),
      products: shown.map(productHit),
    })
  }

  const poolOnly: PoolOnlyRow[] = groups
    .filter((group) => !claimed.has(group.key || group.manager))
    .map((group) => ({
      our_rank: group.rank,
      manager: group.manager,
      our_return: toPct(group.ytd),
      our_1w: toPct(group.ret1w),
      products: group.products.slice(0, 8).map(productHit),
    }))

  return {
    class_key: classKey,
    as_of: asOf,
    window,
    window_label: window === "ytd" ? "今年以来" : "近一年",
    returns_are_percent: true,
    screened: screened.length,
    external_count: ranked.length,
    both,
    external_only: externalOnly,
    pool_only: poolOnly,
    needs_review: needsReview,
  }
}
