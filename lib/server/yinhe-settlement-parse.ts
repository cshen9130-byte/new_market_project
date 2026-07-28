/**
 * Parse 银河期货 settlement attachments:
 * - CTP/Sunguard "Daily Account Statement ByTrade" TXT
 * - XLS: 结算单 / 持仓 / 成交
 */

import * as XLSX from "xlsx"

export type YinheAccountSummary = {
  clientId: string
  clientName: string
  tradeDate: string // YYYY-MM-DD
  balanceBf: number | null
  depositWithdrawal: number | null
  realizedPl: number | null
  mtmPl: number | null
  commission: number | null
  balanceCf: number | null
  clientEquity: number | null
  fundAvail: number | null
  riskDegree: number | null
  marginOccupied: number | null
  sourceFile: string
}

export type YinheTradeRow = {
  tradeDate: string
  settlementDate: string
  product: string
  instrument: string
  bs: string
  oc: string
  lots: number
  price: number
  turnover: number
  fee: number
  realizedPl: number
  sourceFile: string
  rowNum: number
}

export type YinhePositionRow = {
  settlementDate: string
  product: string
  instrument: string
  longPos: number
  shortPos: number
  avgBuyPrice: number
  avgSellPrice: number
  prevSettl: number
  settlToday: number
  mtmPl: number
  marginOccupied: number
  sourceFile: string
  rowNum: number
}

export type YinheClosedRow = {
  settlementDate: string
  product: string
  instrument: string
  bs: string
  lots: number
  posOpenPrice: number
  prevSettl: number
  transPrice: number
  realizedPl: number
  sourceFile: string
  rowNum: number
}

export type YinheDayBundle = {
  tradeDate: string
  account: YinheAccountSummary | null
  trades: YinheTradeRow[]
  positions: YinhePositionRow[]
  closed: YinheClosedRow[]
  warnings: string[]
}

const PRODUCT_NAME_MAP: Record<string, string> = {
  AU: "黄金", AG: "白银", CU: "沪铜", AL: "沪铝", ZN: "沪锌", PB: "沪铅",
  NI: "沪镍", SN: "沪锡", AO: "氧化铝", I: "铁矿", RB: "螺纹钢", HC: "热卷",
  SS: "不锈钢", JM: "焦煤", J: "焦炭", FG: "玻璃", SF: "硅铁", SM: "锰硅",
  ZC: "动力煤", SC: "原油", FU: "燃料油", LU: "低硫燃油", PG: "液化气",
  BU: "沥青", TA: "PTA", EG: "乙二醇", MA: "甲醇", PP: "聚丙烯", L: "塑料",
  V: "PVC", RU: "橡胶", BR: "丁苯橡胶", NR: "20号胶", SA: "纯碱", UR: "尿素",
  PX: "PX", EB: "苯乙烯", LC: "碳酸锂", SI: "工业硅", IF: "沪深300",
  IH: "上证50", IC: "中证500", IM: "中证1000", TS: "2年国债", TF: "5年国债",
  T: "10年国债", TL: "30年国债", C: "玉米", CS: "淀粉", A: "豆一", B: "豆二",
  M: "豆粕", Y: "豆油", RM: "菜粕", OI: "菜油", P: "棕榈油", SR: "白糖",
  CF: "棉花", CY: "棉纱", AP: "苹果", CJ: "红枣", JD: "鸡蛋", LH: "生猪",
  EC: "集运指数",
}

const CN_NAME_TO_CODE: Record<string, string> = {
  黄金: "AU", 白银: "AG", 铜: "CU", 铝: "AL", 锌: "ZN", 铅: "PB", 镍: "NI", 锡: "SN",
  氧化铝: "AO", 铁矿石: "I", 铁矿: "I", 螺纹钢: "RB", 热轧卷板: "HC", 不锈钢: "SS",
  焦煤: "JM", 焦炭: "J", 玻璃: "FG", 硅铁: "SF", 锰硅: "SM", 动力煤: "ZC",
  原油: "SC", 燃料油: "FU", 低硫燃料油: "LU", 液化石油气: "PG", 沥青: "BU",
  PTA: "TA", 精对苯二甲酸: "TA", 乙二醇: "EG", 甲醇: "MA", 聚丙烯: "PP",
  聚乙烯: "L", 聚氯乙烯: "V", PVC: "V", 天然橡胶: "RU", 纯碱: "SA", 尿素: "UR",
  碳酸锂: "LC", 工业硅: "SI", 沪深300: "IF", 上证50: "IH", 中证500: "IC",
  中证1000: "IM", 玉米: "C", 淀粉: "CS", 豆粕: "M", 豆油: "Y", 菜粕: "RM",
  菜油: "OI", 棕榈油: "P", 白糖: "SR", 棉花: "CF", 苹果: "AP", 红枣: "CJ",
  鸡蛋: "JD", 鲜鸡蛋: "JD", 生猪: "LH", 集运指数: "EC",
}

function parseNum(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim().replace(/,/g, "").replace(/%/g, "").replace(/／/g, "/")
  if (!s || s === "-" || s === "--") return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function n0(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function normalizeDate(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.length >= 8) {
    const y = digits.slice(0, 4)
    const m = digits.slice(4, 6)
    const d = digits.slice(6, 8)
    return `${y}-${m}-${d}`
  }
  return null
}

function normalizeRisk(v: number | null): number | null {
  if (v == null) return null
  if (v > 1 && v <= 100) return v / 100
  if (v < 0) return null
  return v
}

export function productDisplayName(productOrInstrument: string, productHint?: string): string {
  const hint = String(productHint ?? "").trim()
  if (hint && !/^[A-Za-z0-9]+$/.test(hint)) return hint
  if (hint && CN_NAME_TO_CODE[hint]) return hint
  const code = extractProductCode(productOrInstrument, productHint)
  if (code && PRODUCT_NAME_MAP[code]) return PRODUCT_NAME_MAP[code]
  if (hint) return hint
  return code || productOrInstrument || "其他"
}

export function extractProductCode(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim()
    if (!raw) continue
    if (CN_NAME_TO_CODE[raw]) return CN_NAME_TO_CODE[raw]
    const upper = raw.toUpperCase()
    const match = upper.match(/^[A-Z]{1,3}/)
    if (match) return match[0]
  }
  return ""
}

function decodeTextBuffer(buf: Buffer): string {
  // CTP statements are often GBK / GB18030 on Windows brokers.
  const utf8 = buf.toString("utf8")
  if (!utf8.includes("�") && /客户|资金|成交|持仓|Client|Account/.test(utf8)) return utf8
  try {
    // Node 20+: TextDecoder supports gb18030 on most builds
    const dec = new TextDecoder("gb18030")
    return dec.decode(buf)
  } catch {
    return utf8
  }
}

function kvNumber(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const re = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d\\-]*(-?[\\d,]+(?:\\.\\d+)?)`,
      "i",
    )
    const m = text.match(re)
    if (m) return parseNum(m[1])
  }
  return null
}

function kvString(text: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]?\\s*([^\\n\\r]+)`,
      "i",
    )
    const m = text.match(re)
    if (m) return m[1].trim().split(/\s{2,}/)[0].trim()
  }
  return ""
}

function splitTableLine(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  if (trimmed.includes("|")) {
    return trimmed.split("|").map((c) => c.trim()).filter((c, i, arr) => !(c === "" && (i === 0 || i === arr.length - 1)))
  }
  // Collapse multi-space columns
  return trimmed.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean)
}

function findHeaderIndex(cells: string[], needles: string[]): number {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (needles.some((n) => c === n || c.includes(n))) return i
  }
  return -1
}

function mapBs(raw: string): string {
  const s = raw.trim()
  if (/^b$/i.test(s) || s.includes("买")) return "买"
  if (/^s$/i.test(s) || s.includes("卖")) return "卖"
  return s
}

function mapOc(raw: string): string {
  const s = raw.trim()
  if (/开/.test(s) || /^o$/i.test(s)) return "开"
  if (/平/.test(s) || /^c$/i.test(s)) return "平"
  return s
}

/** Parse CTP bilingual Daily Account Statement TXT. */
export function parseYinheStatementTxt(buf: Buffer, sourceFile: string): YinheDayBundle {
  const text = decodeTextBuffer(buf)
  const warnings: string[] = []

  const clientId = kvString(text, ["客户号 Client ID", "客户号", "Client ID", "资金账号"])
  const clientName = kvString(text, ["客户名 Client Name", "客户名", "Client Name"])
  const dateRaw =
    kvString(text, ["日期 Date", "Date", "结算日期", "交易日期"]) ||
    (sourceFile.match(/(\d{8})/)?.[1] ?? "")
  const tradeDate = normalizeDate(dateRaw)
  if (!tradeDate) {
    warnings.push(`${sourceFile}: 无法解析结算日期`)
    return { tradeDate: "", account: null, trades: [], positions: [], closed: [], warnings }
  }

  const account: YinheAccountSummary = {
    clientId: clientId || "unknown",
    clientName,
    tradeDate,
    balanceBf: kvNumber(text, ["期初结存 Balance b/f", "期初结存", "Balance b/f"]),
    depositWithdrawal: kvNumber(text, ["出入金 Deposit/Withdrawal", "出 入 金", "出入金", "Deposit/Withdrawal"]),
    realizedPl: kvNumber(text, ["平仓盈亏 Realized P/L", "平仓盈亏", "Realized P/L"]),
    mtmPl: kvNumber(text, ["持仓盈亏 MTM P/L", "持仓盯市盈亏", "持仓盈亏", "MTM P/L"]),
    commission: kvNumber(text, ["手续费 Commission", "手 续 费", "手续费", "Commission"]),
    balanceCf: kvNumber(text, ["期末结存 Balance c/f", "期末结存", "Balance c/f"]),
    clientEquity: kvNumber(text, ["客户权益 Client Equity", "客户权益", "Client Equity"]),
    fundAvail: kvNumber(text, ["可用资金 Fund Avail", "可用资金", "Fund Avail"]),
    riskDegree: normalizeRisk(kvNumber(text, ["风险度 Risk Degree", "风险度", "Risk Degree"])),
    marginOccupied: kvNumber(text, ["保证金占用 Margin Occupied", "保证金占用", "Margin Occupied"]),
    sourceFile,
  }

  const trades = parseTxtTradeSection(text, tradeDate, sourceFile)
  const positions = parseTxtPositionSection(text, tradeDate, sourceFile)
  const closed = parseTxtClosedSection(text, tradeDate, sourceFile)

  if (!account.clientEquity && account.balanceCf != null) {
    account.clientEquity = account.balanceCf
  }

  return { tradeDate, account, trades, positions, closed, warnings }
}

function parseTxtTradeSection(text: string, tradeDate: string, sourceFile: string): YinheTradeRow[] {
  const section = extractSection(text, [/成交记录/, /Transaction Record/], [/平仓明细/, /持仓明细/, /持仓汇总/, /Closed Position/, /Position Detail/, /Position Summary/, /交割明细/])
  if (!section) return []

  const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let headerIdx = -1
  let headerCells: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableLine(lines[i])
    const hasInstrument = findHeaderIndex(cells, ["合约", "Instrument"]) >= 0
    const hasLots = findHeaderIndex(cells, ["手数", "Lots"]) >= 0
    if (hasInstrument && hasLots) {
      headerIdx = i
      headerCells = cells
      break
    }
  }
  if (headerIdx < 0) return []

  const col = {
    date: findHeaderIndex(headerCells, ["成交日期", "Date"]),
    product: findHeaderIndex(headerCells, ["品种", "Product"]),
    instrument: findHeaderIndex(headerCells, ["合约", "Instrument"]),
    bs: findHeaderIndex(headerCells, ["买/卖", "B/S"]),
    price: findHeaderIndex(headerCells, ["成交价", "Price"]),
    lots: findHeaderIndex(headerCells, ["手数", "Lots"]),
    turnover: findHeaderIndex(headerCells, ["成交额", "Turnover"]),
    oc: findHeaderIndex(headerCells, ["开平", "O/C"]),
    fee: findHeaderIndex(headerCells, ["手续费", "Fee"]),
    realized: findHeaderIndex(headerCells, ["平仓盈亏", "Realized"]),
  }

  const rows: YinheTradeRow[] = []
  let rowNum = 0
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^共\s*\d+\s*条/.test(line) || /^总计/.test(line) || /^-{5,}/.test(line)) break
    const cells = splitTableLine(line)
    if (cells.length < 3) continue
    const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
    if (!instrument || /合约|Instrument|合计|小计/.test(instrument)) continue
    const productRaw = col.product >= 0 ? cells[col.product] ?? "" : ""
    const product = productDisplayName(instrument, productRaw)
    const d = col.date >= 0 ? normalizeDate(cells[col.date] ?? "") ?? tradeDate : tradeDate
    rowNum += 1
    rows.push({
      tradeDate: d,
      settlementDate: tradeDate,
      product,
      instrument,
      bs: mapBs(col.bs >= 0 ? cells[col.bs] ?? "" : ""),
      oc: mapOc(col.oc >= 0 ? cells[col.oc] ?? "" : ""),
      lots: n0(parseNum(col.lots >= 0 ? cells[col.lots] : null)),
      price: n0(parseNum(col.price >= 0 ? cells[col.price] : null)),
      turnover: n0(parseNum(col.turnover >= 0 ? cells[col.turnover] : null)),
      fee: n0(parseNum(col.fee >= 0 ? cells[col.fee] : null)),
      realizedPl: n0(parseNum(col.realized >= 0 ? cells[col.realized] : null)),
      sourceFile,
      rowNum,
    })
  }
  return rows
}

function parseTxtPositionSection(text: string, tradeDate: string, sourceFile: string): YinhePositionRow[] {
  const section = extractSection(
    text,
    [/持仓汇总/, /Position Summary/],
    [/交割明细/, /期权/, /客户签字/, /Company/, /End of Report/, /备注/],
  )
  if (!section) return []

  const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let headerIdx = -1
  let headerCells: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableLine(lines[i])
    if (findHeaderIndex(cells, ["合约", "Instrument"]) >= 0 && findHeaderIndex(cells, ["买持仓", "买仓", "Long"]) >= 0) {
      headerIdx = i
      headerCells = cells
      break
    }
    if (findHeaderIndex(cells, ["合约", "Instrument"]) >= 0 && findHeaderIndex(cells, ["买卖", "B/S"]) >= 0) {
      headerIdx = i
      headerCells = cells
      break
    }
  }
  if (headerIdx < 0) return []

  const hasLongCol = findHeaderIndex(headerCells, ["买持仓", "买仓", "Long"]) >= 0
  const rows: YinhePositionRow[] = []
  let rowNum = 0

  if (hasLongCol) {
    const col = {
      product: findHeaderIndex(headerCells, ["品种", "Product"]),
      instrument: findHeaderIndex(headerCells, ["合约", "Instrument"]),
      longPos: findHeaderIndex(headerCells, ["买持仓", "买仓", "Long"]),
      shortPos: findHeaderIndex(headerCells, ["卖持仓", "卖仓", "Short"]),
      avgBuy: findHeaderIndex(headerCells, ["买均价", "Avg.Buy", "LongAvg"]),
      avgSell: findHeaderIndex(headerCells, ["卖均价", "Avg.Sell", "ShortAvg"]),
      prev: findHeaderIndex(headerCells, ["昨结算", "PrevSettle"]),
      settl: findHeaderIndex(headerCells, ["今结算", "Settlement", "Settle"]),
      mtm: findHeaderIndex(headerCells, ["持仓盈亏", "MTM", "浮动盈亏"]),
      margin: findHeaderIndex(headerCells, ["保证金", "Margin"]),
    }
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^共\s*\d+\s*条/.test(line) || /^总计/.test(line) || /^-{5,}/.test(line)) break
      const cells = splitTableLine(line)
      const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
      if (!instrument || /合约|Instrument|合计/.test(instrument)) continue
      const productRaw = col.product >= 0 ? cells[col.product] ?? "" : ""
      rowNum += 1
      rows.push({
        settlementDate: tradeDate,
        product: productDisplayName(instrument, productRaw),
        instrument,
        longPos: n0(parseNum(col.longPos >= 0 ? cells[col.longPos] : null)),
        shortPos: n0(parseNum(col.shortPos >= 0 ? cells[col.shortPos] : null)),
        avgBuyPrice: n0(parseNum(col.avgBuy >= 0 ? cells[col.avgBuy] : null)),
        avgSellPrice: n0(parseNum(col.avgSell >= 0 ? cells[col.avgSell] : null)),
        prevSettl: n0(parseNum(col.prev >= 0 ? cells[col.prev] : null)),
        settlToday: n0(parseNum(col.settl >= 0 ? cells[col.settl] : null)),
        mtmPl: n0(parseNum(col.mtm >= 0 ? cells[col.mtm] : null)),
        marginOccupied: n0(parseNum(col.margin >= 0 ? cells[col.margin] : null)),
        sourceFile,
        rowNum,
      })
    }
  } else {
    // Directional rows: one line per side
    const col = {
      product: findHeaderIndex(headerCells, ["品种", "Product"]),
      instrument: findHeaderIndex(headerCells, ["合约", "Instrument"]),
      bs: findHeaderIndex(headerCells, ["买卖", "买/卖", "B/S"]),
      lots: findHeaderIndex(headerCells, ["持仓量", "手数", "Lots", "Position"]),
      avg: findHeaderIndex(headerCells, ["开仓均价", "持仓均价", "均价", "Avg"]),
      settl: findHeaderIndex(headerCells, ["结算价", "今结算", "Settlement"]),
      mtm: findHeaderIndex(headerCells, ["持仓盈亏", "浮动盈亏", "MTM"]),
      margin: findHeaderIndex(headerCells, ["保证金", "Margin"]),
    }
    const agg = new Map<string, YinhePositionRow>()
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^共\s*\d+\s*条/.test(line) || /^总计/.test(line) || /^-{5,}/.test(line)) break
      const cells = splitTableLine(line)
      const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
      if (!instrument || /合约|Instrument|合计/.test(instrument)) continue
      const productRaw = col.product >= 0 ? cells[col.product] ?? "" : ""
      const product = productDisplayName(instrument, productRaw)
      const bs = mapBs(col.bs >= 0 ? cells[col.bs] ?? "" : "")
      const lots = n0(parseNum(col.lots >= 0 ? cells[col.lots] : null))
      const avg = n0(parseNum(col.avg >= 0 ? cells[col.avg] : null))
      const key = instrument
      const cur = agg.get(key) ?? {
        settlementDate: tradeDate,
        product,
        instrument,
        longPos: 0,
        shortPos: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        prevSettl: 0,
        settlToday: n0(parseNum(col.settl >= 0 ? cells[col.settl] : null)),
        mtmPl: 0,
        marginOccupied: 0,
        sourceFile,
        rowNum: 0,
      }
      if (bs === "买") {
        cur.longPos += lots
        cur.avgBuyPrice = avg
      } else {
        cur.shortPos += lots
        cur.avgSellPrice = avg
      }
      cur.mtmPl += n0(parseNum(col.mtm >= 0 ? cells[col.mtm] : null))
      cur.marginOccupied += n0(parseNum(col.margin >= 0 ? cells[col.margin] : null))
      agg.set(key, cur)
    }
    for (const row of agg.values()) {
      rowNum += 1
      row.rowNum = rowNum
      rows.push(row)
    }
  }
  return rows
}

function parseTxtClosedSection(text: string, tradeDate: string, sourceFile: string): YinheClosedRow[] {
  const section = extractSection(
    text,
    [/平仓明细/, /Closed Position Detail/, /平仓记录/],
    [/持仓明细/, /持仓汇总/, /Position Detail/, /Position Summary/, /交割明细/],
  )
  if (!section) return []

  const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let headerIdx = -1
  let headerCells: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitTableLine(lines[i])
    if (findHeaderIndex(cells, ["合约", "Instrument"]) >= 0 && findHeaderIndex(cells, ["平仓盈亏", "Realized"]) >= 0) {
      headerIdx = i
      headerCells = cells
      break
    }
  }
  if (headerIdx < 0) return []

  const col = {
    product: findHeaderIndex(headerCells, ["品种", "Product"]),
    instrument: findHeaderIndex(headerCells, ["合约", "Instrument"]),
    bs: findHeaderIndex(headerCells, ["买/卖", "买卖", "B/S"]),
    lots: findHeaderIndex(headerCells, ["手数", "Lots"]),
    openPx: findHeaderIndex(headerCells, ["开仓价", "开仓均价", "Pos.Open"]),
    prev: findHeaderIndex(headerCells, ["昨结算", "PrevSettle"]),
    px: findHeaderIndex(headerCells, ["平仓价", "成交价", "Trans.Price", "Price"]),
    realized: findHeaderIndex(headerCells, ["平仓盈亏", "Realized"]),
  }

  const rows: YinheClosedRow[] = []
  let rowNum = 0
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^共\s*\d+\s*条/.test(line) || /^总计/.test(line) || /^-{5,}/.test(line)) break
    const cells = splitTableLine(line)
    const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
    if (!instrument || /合约|Instrument|合计/.test(instrument)) continue
    const productRaw = col.product >= 0 ? cells[col.product] ?? "" : ""
    rowNum += 1
    rows.push({
      settlementDate: tradeDate,
      product: productDisplayName(instrument, productRaw),
      instrument,
      bs: mapBs(col.bs >= 0 ? cells[col.bs] ?? "" : ""),
      lots: n0(parseNum(col.lots >= 0 ? cells[col.lots] : null)),
      posOpenPrice: n0(parseNum(col.openPx >= 0 ? cells[col.openPx] : null)),
      prevSettl: n0(parseNum(col.prev >= 0 ? cells[col.prev] : null)),
      transPrice: n0(parseNum(col.px >= 0 ? cells[col.px] : null)),
      realizedPl: n0(parseNum(col.realized >= 0 ? cells[col.realized] : null)),
      sourceFile,
      rowNum,
    })
  }
  return rows
}

function extractSection(text: string, starts: RegExp[], ends: RegExp[]): string | null {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (starts.some((re) => re.test(lines[i]))) {
      start = i
      break
    }
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (ends.some((re) => re.test(lines[i]))) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

/** Parse supplemental XLS (成交 / 持仓 / 结算单). */
export function parseYinheXls(buf: Buffer, sourceFile: string, fallbackDate?: string): YinheDayBundle {
  const warnings: string[] = []
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
  const trades: YinheTradeRow[] = []
  const positions: YinhePositionRow[] = []
  const closed: YinheClosedRow[] = []
  let account: YinheAccountSummary | null = null
  let tradeDate = fallbackDate ? normalizeDate(fallbackDate) ?? "" : ""

  const dateFromName = sourceFile.match(/(\d{8})/)?.[1]
  if (!tradeDate && dateFromName) tradeDate = normalizeDate(dateFromName) ?? ""

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: null,
      raw: false,
    }) as (string | number | null)[][]

    // Try account key-values anywhere in sheet
    const flat = rows.map((r) => (r ?? []).map((c) => String(c ?? "")).join(" ")).join("\n")
    if (!account && /客户权益|期初结存|保证金占用/.test(flat)) {
      const d =
        normalizeDate(kvString(flat, ["日期", "结算日期", "交易日期"])) ||
        tradeDate ||
        (dateFromName ? normalizeDate(dateFromName) : null)
      if (d) {
        tradeDate = d
        account = {
          clientId: kvString(flat, ["客户号", "资金账号", "Client ID"]) || "unknown",
          clientName: kvString(flat, ["客户名", "客户名称", "Client Name"]),
          tradeDate: d,
          balanceBf: kvNumber(flat, ["期初结存"]),
          depositWithdrawal: kvNumber(flat, ["出入金"]),
          realizedPl: kvNumber(flat, ["平仓盈亏"]),
          mtmPl: kvNumber(flat, ["持仓盈亏", "持仓盯市盈亏"]),
          commission: kvNumber(flat, ["手续费"]),
          balanceCf: kvNumber(flat, ["期末结存"]),
          clientEquity: kvNumber(flat, ["客户权益"]),
          fundAvail: kvNumber(flat, ["可用资金"]),
          riskDegree: normalizeRisk(kvNumber(flat, ["风险度"])),
          marginOccupied: kvNumber(flat, ["保证金占用", "保证金"]),
          sourceFile,
        }
      }
    }

    const headerRowIdx = rows.findIndex((r) => {
      const joined = (r ?? []).map((c) => String(c ?? "")).join("|")
      return /合约/.test(joined) && (/手数|持仓|买|卖|成交价|开平/.test(joined))
    })
    if (headerRowIdx < 0) continue

    const header = (rows[headerRowIdx] ?? []).map((c) => String(c ?? "").trim())
    const lowerName = `${sourceFile} ${sheetName}`.toLowerCase()
    const isTradeSheet =
      /成交/.test(sourceFile) ||
      /成交/.test(sheetName) ||
      (findHeaderIndex(header, ["开平"]) >= 0 && findHeaderIndex(header, ["成交价", "价格"]) >= 0)
    const isPosSheet =
      /持仓/.test(sourceFile) ||
      /持仓/.test(sheetName) ||
      findHeaderIndex(header, ["买持仓", "卖持仓", "持仓量"]) >= 0

    if (isTradeSheet || (!isPosSheet && findHeaderIndex(header, ["开平"]) >= 0)) {
      const col = {
        date: findHeaderIndex(header, ["成交日期", "日期", "结算日期"]),
        product: findHeaderIndex(header, ["品种"]),
        instrument: findHeaderIndex(header, ["合约"]),
        bs: findHeaderIndex(header, ["买/卖", "买卖"]),
        oc: findHeaderIndex(header, ["开平"]),
        price: findHeaderIndex(header, ["成交价", "价格"]),
        lots: findHeaderIndex(header, ["手数", "数量"]),
        turnover: findHeaderIndex(header, ["成交额", "成交金额"]),
        fee: findHeaderIndex(header, ["手续费"]),
        realized: findHeaderIndex(header, ["平仓盈亏"]),
      }
      let rowNum = trades.length
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const cells = (rows[r] ?? []).map((c) => String(c ?? "").trim())
        const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
        if (!instrument || /合计|小计|总计/.test(instrument)) continue
        const d =
          (col.date >= 0 ? normalizeDate(cells[col.date] ?? "") : null) ||
          tradeDate ||
          (dateFromName ? normalizeDate(dateFromName) : null)
        if (!d) continue
        if (!tradeDate) tradeDate = d
        rowNum += 1
        trades.push({
          tradeDate: d,
          settlementDate: tradeDate || d,
          product: productDisplayName(instrument, col.product >= 0 ? cells[col.product] : ""),
          instrument,
          bs: mapBs(col.bs >= 0 ? cells[col.bs] ?? "" : ""),
          oc: mapOc(col.oc >= 0 ? cells[col.oc] ?? "" : ""),
          lots: n0(parseNum(col.lots >= 0 ? cells[col.lots] : null)),
          price: n0(parseNum(col.price >= 0 ? cells[col.price] : null)),
          turnover: n0(parseNum(col.turnover >= 0 ? cells[col.turnover] : null)),
          fee: n0(parseNum(col.fee >= 0 ? cells[col.fee] : null)),
          realizedPl: n0(parseNum(col.realized >= 0 ? cells[col.realized] : null)),
          sourceFile,
          rowNum,
        })
      }
    } else if (isPosSheet || /持仓|结算单/.test(lowerName)) {
      const col = {
        product: findHeaderIndex(header, ["品种"]),
        instrument: findHeaderIndex(header, ["合约"]),
        longPos: findHeaderIndex(header, ["买持仓", "买仓"]),
        shortPos: findHeaderIndex(header, ["卖持仓", "卖仓"]),
        bs: findHeaderIndex(header, ["买/卖", "买卖"]),
        lots: findHeaderIndex(header, ["持仓量", "手数"]),
        avgBuy: findHeaderIndex(header, ["买均价"]),
        avgSell: findHeaderIndex(header, ["卖均价"]),
        avg: findHeaderIndex(header, ["开仓均价", "持仓均价", "均价"]),
        settl: findHeaderIndex(header, ["今结算", "结算价"]),
        mtm: findHeaderIndex(header, ["持仓盈亏", "浮动盈亏"]),
        margin: findHeaderIndex(header, ["保证金", "保证金占用"]),
      }
      const d = tradeDate || (dateFromName ? normalizeDate(dateFromName) : null)
      if (!d) {
        warnings.push(`${sourceFile}: 持仓表缺少结算日期`)
        continue
      }
      tradeDate = d
      let rowNum = positions.length
      if (col.longPos >= 0 || col.shortPos >= 0) {
        for (let r = headerRowIdx + 1; r < rows.length; r++) {
          const cells = (rows[r] ?? []).map((c) => String(c ?? "").trim())
          const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
          if (!instrument || /合计|小计|总计/.test(instrument)) continue
          rowNum += 1
          positions.push({
            settlementDate: d,
            product: productDisplayName(instrument, col.product >= 0 ? cells[col.product] : ""),
            instrument,
            longPos: n0(parseNum(col.longPos >= 0 ? cells[col.longPos] : null)),
            shortPos: n0(parseNum(col.shortPos >= 0 ? cells[col.shortPos] : null)),
            avgBuyPrice: n0(parseNum(col.avgBuy >= 0 ? cells[col.avgBuy] : null)),
            avgSellPrice: n0(parseNum(col.avgSell >= 0 ? cells[col.avgSell] : null)),
            prevSettl: 0,
            settlToday: n0(parseNum(col.settl >= 0 ? cells[col.settl] : null)),
            mtmPl: n0(parseNum(col.mtm >= 0 ? cells[col.mtm] : null)),
            marginOccupied: n0(parseNum(col.margin >= 0 ? cells[col.margin] : null)),
            sourceFile,
            rowNum,
          })
        }
      } else if (col.bs >= 0 && col.lots >= 0) {
        const agg = new Map<string, YinhePositionRow>()
        for (let r = headerRowIdx + 1; r < rows.length; r++) {
          const cells = (rows[r] ?? []).map((c) => String(c ?? "").trim())
          const instrument = col.instrument >= 0 ? cells[col.instrument] ?? "" : ""
          if (!instrument || /合计|小计|总计/.test(instrument)) continue
          const product = productDisplayName(instrument, col.product >= 0 ? cells[col.product] : "")
          const bs = mapBs(cells[col.bs] ?? "")
          const lots = n0(parseNum(cells[col.lots]))
          const avg = n0(parseNum(col.avg >= 0 ? cells[col.avg] : null))
          const cur = agg.get(instrument) ?? {
            settlementDate: d,
            product,
            instrument,
            longPos: 0,
            shortPos: 0,
            avgBuyPrice: 0,
            avgSellPrice: 0,
            prevSettl: 0,
            settlToday: n0(parseNum(col.settl >= 0 ? cells[col.settl] : null)),
            mtmPl: 0,
            marginOccupied: 0,
            sourceFile,
            rowNum: 0,
          }
          if (bs === "买") {
            cur.longPos += lots
            cur.avgBuyPrice = avg
          } else {
            cur.shortPos += lots
            cur.avgSellPrice = avg
          }
          cur.mtmPl += n0(parseNum(col.mtm >= 0 ? cells[col.mtm] : null))
          cur.marginOccupied += n0(parseNum(col.margin >= 0 ? cells[col.margin] : null))
          agg.set(instrument, cur)
        }
        for (const row of agg.values()) {
          rowNum += 1
          row.rowNum = rowNum
          positions.push(row)
        }
      }
    }
  }

  if (!tradeDate) warnings.push(`${sourceFile}: 未能识别结算日期`)
  return { tradeDate, account, trades, positions, closed, warnings }
}

export function mergeDayBundles(bundles: YinheDayBundle[]): YinheDayBundle[] {
  const byDate = new Map<string, YinheDayBundle>()
  for (const b of bundles) {
    if (!b.tradeDate) continue
    const cur = byDate.get(b.tradeDate) ?? {
      tradeDate: b.tradeDate,
      account: null,
      trades: [],
      positions: [],
      closed: [],
      warnings: [],
    }
    if (b.account && (!cur.account || (b.account.clientEquity != null && cur.account.clientEquity == null))) {
      cur.account = b.account
    } else if (b.account && !cur.account) {
      cur.account = b.account
    }
    // Prefer richer trade/position sets
    if (b.trades.length > cur.trades.length) cur.trades = b.trades
    else if (cur.trades.length === 0) cur.trades = b.trades
    if (b.positions.length > cur.positions.length) cur.positions = b.positions
    else if (cur.positions.length === 0) cur.positions = b.positions
    if (b.closed.length > cur.closed.length) cur.closed = b.closed
    else if (cur.closed.length === 0) cur.closed = b.closed
    cur.warnings.push(...b.warnings)
    byDate.set(b.tradeDate, cur)
  }
  return Array.from(byDate.values()).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
}
