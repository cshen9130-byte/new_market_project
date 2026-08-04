/**
 * Parse 融航 / 国金-style daily settlement workbooks (.xls/.xlsx).
 * Sheets: 客户交易结算日报, 成交明细, 平仓明细, 持仓明细, …
 */

import * as XLSX from "xlsx"

export type RonghangAccountDay = {
  tradeDate: string
  clientId: string
  clientName: string
  brokerName: string
  balanceBf: number
  balanceCf: number
  clientEquity: number
  depositWithdrawal: number
  dailyPl: number
  premium: number
  commission: number
  marginOccupied: number
  fundAvailable: number
  riskDegree: number
  sourceFile: string
}

export type RonghangTradeRow = {
  tradeDate: string
  instrument: string
  product: string
  bs: string
  oc: string
  lots: number
  price: number
  turnover: number
  fee: number
  realizedPl: number
  tradeTime: string
  tradeId: string
}

export type RonghangCloseRow = {
  tradeDate: string
  instrument: string
  product: string
  bs: string
  lots: number
  tradePrice: number
  openPrice: number
  realizedPl: number
  openDate: string
  openTradeId: string
}

export type RonghangPositionRow = {
  tradeDate: string
  instrument: string
  product: string
  longPos: number
  shortPos: number
  avgBuyPrice: number
  avgSellPrice: number
  prevSettl: number
  settlToday: number
  mtmPl: number
  marginOccupied: number
}

/** Detail lot rows used to resolve 原成交序号 → 开仓日期. */
export type RonghangPositionDetailRow = {
  tradeId: string
  openDate: string
  instrument: string
}

export type RonghangDayBundle = {
  account: RonghangAccountDay
  trades: RonghangTradeRow[]
  closes: RonghangCloseRow[]
  positions: RonghangPositionRow[]
  positionDetails: RonghangPositionDetailRow[]
  warnings: string[]
}

const PRODUCT_NAME_MAP: Record<string, string> = {
  AU: "黄金",
  AG: "白银",
  CU: "铜",
  AL: "铝",
  ZN: "锌",
  PB: "铅",
  NI: "镍",
  SN: "锡",
  AO: "氧化铝",
  BC: "国际铜",
  SI: "工业硅",
  LC: "碳酸锂",
  PS: "多晶硅",
  RB: "螺纹钢",
  I: "铁矿石",
  HC: "热轧卷板",
  SS: "不锈钢",
  WR: "线材",
  SF: "硅铁",
  SM: "锰硅",
  JM: "焦煤",
  J: "焦炭",
  SC: "原油",
  FU: "燃料油",
  LU: "低硫燃料油",
  PG: "液化石油气",
  ZC: "动力煤",
  JD: "鸡蛋",
  AP: "苹果",
  CJ: "红枣",
  C: "玉米",
  A: "豆一",
  B: "豆二",
  CS: "淀粉",
  M: "豆粕",
  Y: "豆油",
  RS: "菜籽",
  RM: "菜粕",
  OI: "菜油",
  P: "棕榈油",
  PK: "花生",
  LH: "生猪",
  NR: "20号胶",
  EB: "苯乙烯",
  TA: "PTA",
  V: "PVC",
  BR: "丁苯橡胶",
  RU: "橡胶",
  L: "塑料",
  PF: "短纤",
  EG: "乙二醇",
  MA: "甲醇",
  PP: "聚丙烯",
  UR: "尿素",
  SA: "纯碱",
  PX: "PX",
  BU: "沥青",
  TS: "2年国债",
  TF: "5年国债",
  T: "10年国债",
  TL: "30年国债",
  IF: "沪深300股指期货",
  IH: "上证50股指期货",
  IC: "中证500股指期货",
  IM: "中证1000股指期货",
  EC: "集运指数(欧线)",
  CF: "棉花",
  SR: "白糖",
  CY: "棉纱",
  FG: "玻璃",
  SP: "纸浆",
  FB: "纤维板",
  BB: "胶合板",
  LG: "原木",
}

/** Sector map aligned with 融航 data analysis report. */
export const RONGHANG_SECTOR_RULES: Record<string, string[]> = {
  有色金属: ["CU", "AL", "ZN", "PB", "NI", "SN", "AO", "BC", "SI", "LC"],
  黑色: ["RB", "I", "HC", "SS", "WR", "SF", "SM", "JM", "J"],
  能源: ["SC", "FU", "LU", "PG", "ZC"],
  农产品: ["JD", "AP", "CJ", "C", "A", "CS", "WH", "PM", "RR", "RI", "JR", "LR", "B", "M", "Y", "RS", "RM", "OI", "P", "PK", "LH"],
  化工: ["PR", "NR", "EB", "TA", "V", "BR", "RU", "L", "PF", "EG", "MA", "PP", "ED", "UR", "SA", "SH", "PX", "BU", "PS"],
  贵金属: ["AU", "AG"],
  国债: ["TS", "TF", "T", "TL"],
  金融指数: ["IF", "IH", "IC", "IM", "EC"],
  软商品: ["CF", "SR", "CY"],
  建材: ["FG", "SP", "FB", "BB", "LG"],
}

const PRODUCT_TO_SECTOR: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [sector, codes] of Object.entries(RONGHANG_SECTOR_RULES)) {
    for (const code of codes) map[code] = sector
  }
  return map
})()

function n0(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (raw == null) return 0
  const s = String(raw).trim().replace(/,/g, "").replace(/%/g, "")
  if (!s || s === "-" || s === "--") return 0
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : 0
}

function cellStr(raw: unknown): string {
  return String(raw ?? "").trim()
}

function normalizeDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, "0")
    const d = String(raw.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(raw)
    if (parsed) {
      const y = parsed.y
      const m = String(parsed.m).padStart(2, "0")
      const d = String(parsed.d).padStart(2, "0")
      return `${y}-${m}-${d}`
    }
  }
  const s = cellStr(raw)
  const m = s.match(/(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

function normalizeRisk(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1 && raw <= 100 ? raw / 100 : raw
  }
  const s = cellStr(raw)
  if (!s) return 0
  const v = parseFloat(s.replace(/%/g, "").replace(/,/g, ""))
  if (!Number.isFinite(v)) return 0
  if (s.includes("%") || v > 1) return v / 100
  return v
}

export function extractProductCode(instrument: string): string {
  const s = cellStr(instrument).toUpperCase()
  const m = s.match(/^([A-Z]+)/)
  return m?.[1] ?? s
}

export function productDisplayName(codeOrInstrument: string): string {
  const code = extractProductCode(codeOrInstrument)
  return PRODUCT_NAME_MAP[code] ?? code
}

export function productSector(codeOrInstrument: string): string {
  const code = extractProductCode(codeOrInstrument)
  return PRODUCT_TO_SECTOR[code] ?? "其他"
}

function sheetToMatrix(wb: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][]
}

function findSheetName(wb: XLSX.WorkBook, candidates: string[]): string | null {
  for (const name of wb.SheetNames) {
    if (candidates.some((c) => name.includes(c))) return name
  }
  return null
}

function findLabeledValue(matrix: unknown[][], label: string): unknown {
  for (const row of matrix) {
    for (let c = 0; c < row.length; c++) {
      if (cellStr(row[c]) === label) {
        for (let dc = 1; dc <= 3; dc++) {
          const v = row[c + dc]
          if (v !== "" && v != null) return v
        }
      }
    }
  }
  return null
}

function findHeaderRow(matrix: unknown[][], required: string[]): { rowIndex: number; headers: string[] } | null {
  for (let r = 0; r < matrix.length; r++) {
    const headers = matrix[r].map((c) => cellStr(c))
    if (required.every((h) => headers.includes(h))) {
      return { rowIndex: r, headers }
    }
  }
  return null
}

function colIndex(headers: string[], name: string): number {
  return headers.indexOf(name)
}

function parseAccount(matrix: unknown[][], sourceFile: string): RonghangAccountDay | null {
  const tradeDate = normalizeDate(findLabeledValue(matrix, "交易日期"))
  if (!tradeDate) return null

  const riskRaw = findLabeledValue(matrix, "风险度")
  return {
    tradeDate,
    clientId: cellStr(findLabeledValue(matrix, "客户期货期权内部资金账户")),
    clientName: cellStr(findLabeledValue(matrix, "客户名称")),
    brokerName: cellStr(findLabeledValue(matrix, "期货公司名称")),
    balanceBf: n0(findLabeledValue(matrix, "上日结存")),
    balanceCf: n0(findLabeledValue(matrix, "当日结存")),
    clientEquity: n0(findLabeledValue(matrix, "客户权益")),
    depositWithdrawal: n0(findLabeledValue(matrix, "当日存取合计")),
    dailyPl: n0(findLabeledValue(matrix, "当日盈亏")),
    premium: n0(findLabeledValue(matrix, "当日总权利金")),
    commission: n0(findLabeledValue(matrix, "当日手续费")),
    marginOccupied: n0(findLabeledValue(matrix, "保证金占用")),
    fundAvailable: n0(findLabeledValue(matrix, "可用资金")),
    riskDegree: normalizeRisk(riskRaw),
    sourceFile,
  }
}

function parseTrades(matrix: unknown[][], tradeDate: string): RonghangTradeRow[] {
  const hdr = findHeaderRow(matrix, ["合约", "手数"])
  if (!hdr) return []
  const { rowIndex, headers } = hdr
  const iInst = colIndex(headers, "合约")
  const iBs = colIndex(headers, "买/卖")
  const iOc = colIndex(headers, "开/平")
  const iLots = colIndex(headers, "手数")
  const iPrice = colIndex(headers, "成交价")
  const iTurnover = colIndex(headers, "成交额")
  const iFee = colIndex(headers, "手续费")
  const iPl = colIndex(headers, "平仓盈亏")
  const iTime = colIndex(headers, "成交时间")
  const iId = colIndex(headers, "成交序号")
  const iActualDate = colIndex(headers, "实际成交日期")
  const out: RonghangTradeRow[] = []
  for (let r = rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r]
    const instrument = cellStr(row[iInst])
    if (!instrument || instrument === "合计") break
    const lots = n0(row[iLots])
    if (lots === 0 && !instrument.match(/[A-Za-z]/)) continue
    const actual = iActualDate >= 0 ? normalizeDate(row[iActualDate]) : null
    out.push({
      tradeDate: actual ?? tradeDate,
      instrument,
      product: extractProductCode(instrument),
      bs: cellStr(row[iBs]),
      oc: cellStr(row[iOc]),
      lots,
      price: n0(row[iPrice]),
      turnover: n0(row[iTurnover]),
      fee: n0(row[iFee]),
      realizedPl: iPl >= 0 ? n0(row[iPl]) : 0,
      tradeTime: iTime >= 0 ? cellStr(row[iTime]) : "",
      tradeId: iId >= 0 ? cellStr(row[iId]) : "",
    })
  }
  return out
}

function parseCloses(matrix: unknown[][], tradeDate: string): RonghangCloseRow[] {
  const hdr = findHeaderRow(matrix, ["合约", "平仓盈亏"])
  if (!hdr) return []
  const { rowIndex, headers } = hdr
  const iInst = colIndex(headers, "合约")
  const iBs = colIndex(headers, "买/卖")
  const iLots = colIndex(headers, "手数")
  const iPrice = colIndex(headers, "成交价")
  const iOpen = colIndex(headers, "开仓价")
  const iPl = colIndex(headers, "平仓盈亏")
  const iOpenDate = Math.max(colIndex(headers, "原成交日期"), colIndex(headers, "开仓日期"))
  const iOpenId = colIndex(headers, "原成交序号")
  const iActualDate = colIndex(headers, "实际成交日期")
  const out: RonghangCloseRow[] = []
  for (let r = rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r]
    const instrument = cellStr(row[iInst])
    if (!instrument || instrument === "合计") break
    const actual = iActualDate >= 0 ? normalizeDate(row[iActualDate]) : null
    out.push({
      tradeDate: actual ?? tradeDate,
      instrument,
      product: extractProductCode(instrument),
      bs: cellStr(row[iBs]),
      lots: n0(row[iLots]),
      tradePrice: n0(row[iPrice]),
      openPrice: iOpen >= 0 ? n0(row[iOpen]) : 0,
      realizedPl: n0(row[iPl]),
      openDate: iOpenDate >= 0 ? normalizeDate(row[iOpenDate]) ?? "" : "",
      openTradeId: iOpenId >= 0 ? cellStr(row[iOpenId]) : "",
    })
  }
  return out
}

/**
 * Prefer 期货持仓汇总 on the account sheet (contract-level MTM for the day).
 * Fallback to 持仓明细 sheet aggregated by instrument.
 */
function parsePositionsFromAccount(matrix: unknown[][], tradeDate: string): RonghangPositionRow[] {
  let headerIdx = -1
  let headers: string[] = []
  for (let r = 0; r < matrix.length; r++) {
    if (cellStr(matrix[r][0]).includes("期货持仓汇总")) {
      for (let rr = r + 1; rr < Math.min(r + 5, matrix.length); rr++) {
        const hs = matrix[rr].map((c) => cellStr(c))
        if (hs.includes("合约") && hs.includes("持仓盈亏")) {
          headerIdx = rr
          headers = hs
          break
        }
      }
      break
    }
  }
  if (headerIdx < 0) return []

  const iInst = colIndex(headers, "合约")
  const iLong = colIndex(headers, "买持仓")
  const iShort = colIndex(headers, "卖持仓")
  const iBuy = colIndex(headers, "买均价")
  const iSell = colIndex(headers, "卖均价")
  const iPrev = colIndex(headers, "昨结算价")
  const iToday = colIndex(headers, "今结算价")
  const iMtm = colIndex(headers, "持仓盈亏")
  const iMargin = colIndex(headers, "交易保证金")
  const out: RonghangPositionRow[] = []

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    const instrument = cellStr(row[iInst])
    if (!instrument || instrument === "合计") break
    if (instrument.includes("期权") || instrument.includes("汇总")) break
    if (!/^[A-Za-z]/.test(instrument)) break
    out.push({
      tradeDate,
      instrument,
      product: extractProductCode(instrument),
      longPos: iLong >= 0 ? n0(row[iLong]) : 0,
      shortPos: iShort >= 0 ? n0(row[iShort]) : 0,
      avgBuyPrice: iBuy >= 0 ? n0(row[iBuy]) : 0,
      avgSellPrice: iSell >= 0 ? n0(row[iSell]) : 0,
      prevSettl: iPrev >= 0 ? n0(row[iPrev]) : 0,
      settlToday: iToday >= 0 ? n0(row[iToday]) : 0,
      mtmPl: iMtm >= 0 ? n0(row[iMtm]) : 0,
      marginOccupied: iMargin >= 0 ? n0(row[iMargin]) : 0,
    })
  }
  return out
}

function parsePositionDetails(matrix: unknown[][]): RonghangPositionDetailRow[] {
  const hdr = findHeaderRow(matrix, ["合约", "成交序号"])
  if (!hdr) return []
  const { rowIndex, headers } = hdr
  const iInst = colIndex(headers, "合约")
  const iId = colIndex(headers, "成交序号")
  const iDate = colIndex(headers, "实际成交日期")
  if (iId < 0 || iDate < 0) return []
  const out: RonghangPositionDetailRow[] = []
  for (let r = rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r]
    const instrument = cellStr(row[iInst])
    if (!instrument || instrument === "合计") break
    const tradeId = cellStr(row[iId])
    const openDate = normalizeDate(row[iDate]) ?? ""
    if (!tradeId || !openDate) continue
    out.push({ tradeId, openDate, instrument })
  }
  return out
}

export function parseRonghangWorkbook(buffer: Buffer, sourceFile: string): RonghangDayBundle {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const warnings: string[] = []

  const accountSheet =
    findSheetName(wb, ["客户交易结算日报", "交易结算日报", "结算日报"]) ?? wb.SheetNames[0]
  const accountMatrix = sheetToMatrix(wb, accountSheet)
  const account = parseAccount(accountMatrix, sourceFile)
  if (!account) {
    throw new Error(`无法从 ${sourceFile} 解析交易日期/账户信息。`)
  }

  const tradeSheet = findSheetName(wb, ["成交明细"])
  const closeSheet = findSheetName(wb, ["平仓明细"])
  const detailSheet = findSheetName(wb, ["持仓明细"])
  const trades = tradeSheet ? parseTrades(sheetToMatrix(wb, tradeSheet), account.tradeDate) : []
  const closes = closeSheet ? parseCloses(sheetToMatrix(wb, closeSheet), account.tradeDate) : []
  const positions = parsePositionsFromAccount(accountMatrix, account.tradeDate)
  const positionDetails = detailSheet ? parsePositionDetails(sheetToMatrix(wb, detailSheet)) : []

  if (positions.length === 0) {
    warnings.push(`${sourceFile}: 未找到期货持仓汇总，持仓盈亏归因可能不完整。`)
  }
  if (!tradeSheet) warnings.push(`${sourceFile}: 缺少成交明细。`)
  if (!closeSheet) warnings.push(`${sourceFile}: 缺少平仓明细。`)

  return { account, trades, closes, positions, positionDetails, warnings }
}

export function isRonghangSettlementFilename(name: string): boolean {
  return /\.xlsx?$/i.test(name) && !name.startsWith(".") && !name.includes("__MACOSX")
}
