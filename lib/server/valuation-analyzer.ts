import * as XLSX from "xlsx"
import { resolveFundHoldingCode } from "@/lib/server/fund-holding-code"

export interface ValuationRow {
  code: string
  name: string
  [key: string]: unknown
}

export interface ValuationSummary {
  fund_name: string
  valuation_date: string
  nav: number
  total_asset: number
  total_liability: number
}

export interface ValuationAnalysis {
  portfolio_data: ValuationRow[]
  summary: ValuationSummary
}

type HeaderRole =
  | "code"
  | "name"
  | "currency"
  | "fx_rate"
  | "quantity"
  | "unit_cost"
  | "cost"
  | "cost_weight"
  | "price"
  | "market_value"
  | "market_weight"
  | "unrealized_pnl"
  | "suspension_info"
  | "rights_info"
  | "unknown"

interface ColumnMeta {
  index: number
  label: string
  role: HeaderRole
}

const CODE_PATTERN = /^(科目代码|科目编号|代码|合约代码|证券代码|产品代码|code)$/i
const NAME_PATTERN = /^(科目名称|名称|合约名称|证券名称|品种名称|name)$/i

function formatLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`
}

function cellToString(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatLocalIsoDate(value)
  return String(value).trim()
}

function normalizeText(value: unknown): string {
  return cellToString(value).replace(/[\s\u3000\t\r\n:：]/g, "")
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value == null) return 0

  let text = cellToString(value)
  if (!text) return 0

  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }

  text = text
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")

  const num = Number(text)
  if (!Number.isFinite(num)) return 0
  return negative ? -num : num
}

function parseDateText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalIsoDate(value)
  }

  const text = cellToString(value)
  const compactMatch = text.match(/(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})/)
  if (compactMatch) {
    const [, year, month, day] = compactMatch
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }

  const compact8 = text.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)
  if (compact8) {
    return `${compact8[1]}-${compact8[2]}-${compact8[3]}`
  }

  const date = new Date(text)
  if (!Number.isNaN(date.getTime())) return formatLocalIsoDate(date)
  return ""
}

/** 估值表 header often puts 估值日期 and the date value in adjacent cells. */
function extractValuationDateFromHeaderRow(row: unknown[]): string {
  const cells = (row ?? []).map((cell) => cellToString(cell))
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    const inline = cell.match(/(?:估值日期|净值日期|日期)\s*[：:]\s*(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})/)
    if (inline) {
      const parsed = parseDateText(inline[1])
      if (parsed) return parsed
    }

    const label = cell.replace(/[\s\u3000:：]/g, "")
    if (/^(估值日期|净值日期|日期)$/.test(label)) {
      for (let j = i + 1; j < Math.min(i + 4, (row ?? []).length); j += 1) {
        const parsed = parseDateText((row ?? [])[j])
        if (parsed) return parsed
      }
    }
  }
  return ""
}

function isPlausibleUnitNavValue(value: number): boolean {
  return value > 0.05 && value < 500
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] || []).map(normalizeText)
    const hasCode = cells.some((cell) => CODE_PATTERN.test(cell))
    const hasName = cells.some((cell) => NAME_PATTERN.test(cell))
    const hasValue = cells.some((cell) => /市值|成本|数量|行情|估值增值|market/i.test(cell))
    if (hasCode && hasName && hasValue) return i
  }

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const nonEmpty = (rows[i] || []).filter((cell) => cellToString(cell).length > 0)
    if (nonEmpty.length >= 6) return i
  }

  return 0
}

function countHeaderRows(rows: unknown[][], headerRowIndex: number): number {
  let count = 1

  for (let i = headerRowIndex + 1; i < Math.min(rows.length, headerRowIndex + 4); i++) {
    const cells = (rows[i] || []).map(normalizeText)
    const first = cells[0] || ""
    const headerLikeCount = cells.filter((cell) =>
      /科目代码|科目名称|原币|本币|成本占比|市值占比|十亿千百|停牌信息|权益信息/.test(cell),
    ).length

    if (CODE_PATTERN.test(first) || headerLikeCount >= 3) count += 1
    else break
  }

  return count
}

function roleFromHeader(base: string, sub: string, colIdx: number, duplicateOrdinal: number): HeaderRole {
  const joined = normalizeText(`${base}${sub}`)
  const baseNorm = normalizeText(base)
  const subNorm = normalizeText(sub)

  if (CODE_PATTERN.test(baseNorm)) return "code"
  if (NAME_PATTERN.test(baseNorm)) return "name"
  if (/^币种$/.test(baseNorm)) return "currency"
  if (/^汇率$/.test(baseNorm)) return "fx_rate"
  if (/^数量$|持仓数量|手数|合约数|quantity|volume|position/i.test(baseNorm)) return "quantity"
  if (/单位成本|开仓均价|持仓均价|unitcost|avgcost/i.test(joined)) return "unit_cost"
  if (/成本占/.test(joined)) return "cost_weight"
  if (/市值占/.test(joined)) return "market_weight"
  // 招商证券等: combined headers like 市值-本币 / 成本-本币 (sometimes with digit-scale sub-row)
  if (/^市值[-－]?本币$/i.test(baseNorm)) return "market_value"
  if (/^成本[-－]?本币$/i.test(baseNorm)) return "cost"
  if (/市值/.test(joined) && /本币/.test(joined) && !/占比|增值/.test(joined)) return "market_value"
  if (/成本/.test(joined) && /本币/.test(joined) && !/占比|增值/.test(joined)) return "cost"
  if (/市价|行情|结算价|最新价|现价|price/i.test(baseNorm)) return "price"
  if (/估值增值|浮动盈亏|未实现盈亏|valuation|pnl/i.test(baseNorm)) return "unrealized_pnl"
  if (/停牌/.test(baseNorm)) return "suspension_info"
  if (/权益/.test(baseNorm)) return "rights_info"

  if (/^成本$/.test(baseNorm)) {
    if (/本币/.test(subNorm)) return "cost"
    if (/原币/.test(subNorm)) return "unknown"
    return duplicateOrdinal === 1 ? "cost" : "unknown"
  }

  if (/^市值$|市场价值|公允价值|持仓市值|估值|marketvalue/i.test(baseNorm)) {
    if (/本币/.test(subNorm)) return "market_value"
    if (/原币/.test(subNorm)) return "unknown"
    return duplicateOrdinal === 1 ? "market_value" : "unknown"
  }

  return colIdx === 0 ? "code" : colIdx === 1 ? "name" : "unknown"
}

function buildColumnMeta(rows: unknown[][], headerRowIndex: number, headerRowCount: number): ColumnMeta[] {
  const headerRows = rows.slice(headerRowIndex, headerRowIndex + headerRowCount)
  const maxCols = Math.max(...headerRows.map((row) => row.length))
  const seenBase = new Map<string, number>()
  const columns: ColumnMeta[] = []

  for (let col = 0; col < maxCols; col++) {
    const base = cellToString(headerRows[0]?.[col])
    const sub = headerRows
      .slice(1)
      .map((row) => cellToString(row?.[col]))
      .filter(Boolean)
      .join("_")

    const baseKey = normalizeText(base)
    const ordinal = (seenBase.get(baseKey) || 0) + 1
    seenBase.set(baseKey, ordinal)

    columns.push({
      index: col,
      label: [base, sub].filter(Boolean).join("_"),
      role: roleFromHeader(base, sub, col, ordinal),
    })
  }

  return columns
}

/** Prefer 市值-本币 over the first generic 市值 column (招商等双行/三行表头). */
function marketValueColumnIndex(columns: ColumnMeta[]): number {
  const marketCols = columns.filter((col) => col.role === "market_value")
  if (marketCols.length === 0) {
    const labeled = columns.find(
      (col) => /市值/.test(col.label) && /本币/.test(col.label) && !/占比|增值/.test(col.label),
    )
    return labeled?.index ?? -1
  }
  const local = marketCols.find((col) => /本币/.test(col.label))
  if (local) return local.index
  return marketCols[marketCols.length - 1].index
}

function costColumnIndex(columns: ColumnMeta[]): number {
  const costCols = columns.filter((col) => col.role === "cost")
  if (costCols.length === 0) {
    const labeled = columns.find(
      (col) => /成本/.test(col.label) && /本币/.test(col.label) && !/占比|增值/.test(col.label),
    )
    return labeled?.index ?? -1
  }
  const local = costCols.find((col) => /本币/.test(col.label))
  if (local) return local.index
  return costCols[costCols.length - 1].index
}

function rowLocalizedAmount(row: unknown[], columns: ColumnMeta[], kind: "market_value" | "cost"): number {
  const idx = kind === "market_value" ? marketValueColumnIndex(columns) : costColumnIndex(columns)
  if (idx >= 0) {
    const v = parseNumber(row[idx])
    if (v) return v
  }
  for (const col of columns) {
    const isMarket = /市值/.test(col.label) && /本币/.test(col.label) && !/占比|增值/.test(col.label)
    const isCost = /成本/.test(col.label) && /本币/.test(col.label) && !/占比|增值/.test(col.label)
    if ((kind === "market_value" && isMarket) || (kind === "cost" && isCost)) {
      const v = parseNumber(row[col.index])
      if (v) return v
    }
  }
  return 0
}

export function pickRowMarketValue(row: ValuationRow): number {
  const direct = parseNumber(row.market_value ?? row.signed_market_value)
  if (direct) return Math.abs(direct)
  for (const [key, val] of Object.entries(row)) {
    if (/市值/.test(key) && /本币/.test(key) && !/占比|增值/.test(key)) {
      const n = parseNumber(val)
      if (n) return Math.abs(n)
    }
  }
  return 0
}

export function pickRowCost(row: ValuationRow): number {
  const direct = parseNumber(row.cost ?? row.signed_cost)
  if (direct) return Math.abs(direct)
  for (const [key, val] of Object.entries(row)) {
    if (/成本/.test(key) && /本币/.test(key) && !/占比|增值/.test(key)) {
      const n = parseNumber(val)
      if (n) return Math.abs(n)
    }
  }
  return 0
}

function extractFundName(rows: unknown[][], headerRowIndex: number, filename: string): string {
  for (let i = 0; i < Math.min(headerRowIndex, 12); i++) {
    const joined = (rows[i] || []).map(cellToString).filter(Boolean).join(" ")
    const parts = joined.split(/___|__|_/).map((part) => part.trim()).filter(Boolean)
    const fund = parts.find((part) => /基金/.test(part) && !/估值表|专用表|证券投资基金估值|管理人|托管/.test(part))
    if (fund) return fund.replace(/专用表$/, "")

    const quoted = joined.match(/[""''\u201c\u201d]([^""''\u201c\u201d]*基金[^""''\u201c\u201d]*)[""''\u201c\u201d]/)
    if (quoted?.[1] && !/估值表|管理人/.test(quoted[1])) return quoted[1].trim()

    const productLine = joined.match(/(?:产品名称|基金名称)\s*[：:]\s*([^\s|]+(?:基金[^\s|]*)?)/)
    if (productLine?.[1]) return productLine[1].trim()
  }

  const filePatterns = [
    /【基金估值表】([A-Z0-9]+)_([^_]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_/u,
    /([A-Z0-9]+)_([^_]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_(?:资产)?估值表/u,
    /([^_]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)每日(?:产品)?(?:三|四)?级估值表/u,
    /(?:^|_)([^_]*基金[^_]*)_/u,
  ]
  for (const re of filePatterns) {
    const m = filename.match(re)
    if (m?.[2]) return m[2]
    if (m?.[1] && /基金/.test(m[1])) return m[1]
  }

  return "未知基金"
}

function extractSummary(rows: unknown[][], headerRowIndex: number, columns: ColumnMeta[], filename: string): ValuationSummary {
  const summary: ValuationSummary = {
    fund_name: extractFundName(rows, headerRowIndex, filename),
    valuation_date: "",
    nav: 0,
    total_asset: 0,
    total_liability: 0,
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []

    if (i < Math.min(rows.length, 25)) {
      const parsedDate = extractValuationDateFromHeaderRow(row)
      if (parsedDate) summary.valuation_date = parsedDate
    }

    const code = cellToString(row[columns.find((col) => col.role === "code")?.index ?? 0])
    const name = normalizeText(row[columns.find((col) => col.role === "name")?.index ?? 1])
    const label = name || normalizeText(code)
    const costCol = costColumnIndex(columns)
    const marketCol = marketValueColumnIndex(columns)
    const cost = costCol >= 0 ? parseNumber(row[costCol]) : rowLocalizedAmount(row, columns, "cost")
    const marketValue = marketCol >= 0 ? parseNumber(row[marketCol]) : rowLocalizedAmount(row, columns, "market_value")
    const value = marketValue || cost

    if (!label) {
      continue
    }

    if (/^(基金)?资产净值$/.test(label) || /^资产净值$/.test(label)) {
      summary.nav = value || summary.nav
    } else if (/^(资产类合计|资产合计|资产总值|资产类总计)$/.test(label)) {
      summary.total_asset = value || summary.total_asset
    } else if (/^(负债类合计|负债合计|负债总值|负债类总计)$/.test(label)) {
      summary.total_liability = Math.abs(value) || summary.total_liability
    } else if (/^单位净值$/.test(label) && isPlausibleUnitNavValue(value)) {
      // unit NAV handled in enrichValuationMetrics; do not store as net asset
    } else if (/^托管户余额$|^托管账户余额$|^托管户$/.test(label)) {
      // custody handled in enrichValuationMetrics
    }
  }

  if (!summary.valuation_date) {
    const fileDate = filename.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/)
    // Custody send-date in filename is not the NAV date (see email-valuation-attachment).
    const sendDateInFilename = /估值表_(20\d{6})/u.test(filename) || /_20\d{6}_估值表/u.test(filename)
    if (fileDate && !sendDateInFilename) {
      summary.valuation_date = `${fileDate[1]}-${fileDate[2]}-${fileDate[3]}`
    }
  }

  if (!summary.nav && summary.total_asset && summary.total_liability) {
    summary.nav = summary.total_asset - summary.total_liability
  }

  return summary
}

function normalizeSubjectCode(code: string): string {
  return code.replace(/\s+/g, "").replace(/\./g, "")
}

function extractContractSymbol(code: string, name: string): string {
  const matches = `${code} ${name}`.match(/[A-Za-z]{1,4}\d{2,5}/g) || []
  return (
    matches.find((match) => !/^(DD|DE|DF|DG)\d/i.test(match) && !/^[A-Za-z]\d01$/i.test(match))?.toUpperCase() ||
    matches[0]?.toUpperCase() ||
    ""
  )
}

function inferExchange(code: string, symbol: string): string {
  if (/\bCFX\b/i.test(code)) return "CFFEX"
  if (/\bCZC\b/i.test(code)) return "CZCE"
  if (/\bDCE\b/i.test(code)) return "DCE"
  if (/\bGEX\b/i.test(code)) return "GFEX"
  if (/\bSC\b/i.test(code)) return "INE"
  if (/\bSQ\b/i.test(code)) return "SHFE"

  const sub = normalizeSubjectCode(code).substring(4, 6)
  if (["03", "04", "01", "02"].includes(sub) && /^(IF|IH|IC|IM|T|TF|TS|TL)/.test(symbol)) return "CFFEX"
  if (["05", "06", "21", "22", "DD", "DE", "DF", "DG"].includes(sub)) return "SHFE"
  if (["07", "08"].includes(sub)) return "DCE"
  if (["31", "32"].includes(sub)) return "CZCE"
  if (["41", "42"].includes(sub)) return "DCE"
  if (["25", "26"].includes(sub)) return "GFEX"
  if (["74", "75", "A8", "A9"].includes(sub)) return "INE"
  if (/^(LC|SI|PS)/.test(symbol)) return "GFEX"
  if (/^(SC|NR|LU|EC)/.test(symbol)) return "INE"

  return "未知"
}

function inferAssetClass(symbol: string, name: string): string {
  if (/期权/.test(name)) return "期权"
  if (/^(IF|IH|IC|IM)/.test(symbol)) return "股指期货"
  if (/^(T|TF|TS|TL)/.test(symbol)) return "国债期货"
  if (symbol) return "商品期货"
  return "其他"
}

function inferRowKind(code: string, name: string): string {
  const compactCode = normalizeSubjectCode(code)
  if (compactCode.startsWith("3102")) return "derivative"
  if (compactCode.startsWith("1001")) return "stock"
  if (compactCode.startsWith("1002")) return "bank_deposit"
  if (compactCode.startsWith("1021")) return "settlement_reserve"
  if (compactCode.startsWith("1031")) return "margin_deposit"
  if (compactCode.startsWith("1101")) return "bond"
  if (compactCode.startsWith("1102")) return "fund_or_stock"
  if (compactCode.startsWith("1105")) return /货币/.test(name) ? "money_fund" : "fund"
  if (compactCode.startsWith("1108") || compactCode.startsWith("1109")) return "private_fund"
  if (/私募证券投资基金|私募基金/.test(name)) return "private_fund"
  if (compactCode.startsWith("1202")) return "repo"
  if (compactCode.startsWith("1203") || compactCode.startsWith("1207")) return "receivable"
  if (compactCode.startsWith("3003")) return "clearing"
  if (/^22/.test(compactCode)) return "payable"
  return "other"
}

function hasEconomicValue(row: ValuationRow): boolean {
  return (
    Math.abs(Number(row.position || 0)) > 0 ||
    Math.abs(Number(row.market_value || 0)) > 0 ||
    Math.abs(Number(row.cost || 0)) > 0 ||
    Math.abs(Number(row.unrealized_pnl || 0)) > 0
  )
}

function isOffsetOrSummaryRow(code: string, name: string): boolean {
  const compactCode = code.replace(/\s+/g, "")
  const normalizedName = normalizeText(name)
  const hasContractInName = /[A-Za-z]{1,4}\d{2,5}/.test(name)

  if (!name) return true
  if (/^(基金)?资产净值$/.test(normalizedName) || /^净资产$/.test(normalizedName)) return false
  if (/^(资产类合计|资产合计|资产总值|资产类总计)$/.test(normalizedName)) return false
  if (/^(负债类合计|负债合计|负债总值|负债类总计)$/.test(normalizedName)) return false
  if (!code) return true
  if (!/^\d/.test(compactCode)) return true
  if (/合计|小计|总计|打印日期|声明/.test(normalizedName)) return true
  if (/单位净值/.test(normalizedName)) return true
  if (/净值/.test(normalizedName)) return true
  if (/增长率|已实现收益|可分配利润|累计派现|现金类占净值比/.test(normalizedName)) return true
  if (/冲销|冲抵|估值增值|应计利息/.test(normalizedName)) return true
  if (compactCode.startsWith("3102") && /初始合约价值/.test(name) && !hasContractInName) return true
  if (/^3102\.[^.]+\.(02)\./.test(compactCode)) return true
  if (compactCode.startsWith("3102") && !/[A-Za-z]{1,4}\d{2,4}/.test(`${compactCode}${name}`)) return true

  return false
}

function rowsToObjects(rows: unknown[][], headerRowIndex: number, headerRowCount: number, columns: ColumnMeta[]): ValuationRow[] {
  const startRow = headerRowIndex + headerRowCount
  const result: ValuationRow[] = []

  for (let rowIdx = startRow; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    if (!row || row.every((cell) => cellToString(cell).length === 0)) continue

    const obj: ValuationRow = { code: "", name: "" }

    for (const col of columns) {
      const rawValue = row[col.index] ?? null
      const stringValue = cellToString(rawValue)
      const numberValue = parseNumber(rawValue)
      const value = stringValue !== "" && Number.isFinite(numberValue) && /^[-(]?\s*[\d,.]+%?\)?$/.test(stringValue)
        ? numberValue
        : stringValue

      if (col.label) obj[col.label] = value

      switch (col.role) {
        case "code":
          obj.code = stringValue
          obj.original_code = stringValue
          break
        case "name":
          obj.name = stringValue
          break
        case "currency":
          obj.currency = stringValue
          break
        case "fx_rate":
          obj.fx_rate = numberValue
          break
        case "quantity":
          obj.position = Math.abs(numberValue)
          obj.volume = Math.abs(numberValue)
          obj.quantity = Math.abs(numberValue)
          break
        case "unit_cost":
          obj.unit_cost = Math.abs(numberValue)
          break
        case "cost":
          obj.cost = Math.abs(numberValue)
          obj.signed_cost = numberValue
          break
        case "cost_weight":
          obj.cost_weight = numberValue
          break
        case "price":
          obj.current_price = Math.abs(numberValue)
          obj.price = Math.abs(numberValue)
          break
        case "market_value":
          obj.market_value = Math.abs(numberValue)
          obj.notional_value = Math.abs(numberValue)
          obj.signed_market_value = numberValue
          break
        case "market_weight":
          obj.market_weight = numberValue
          break
        case "unrealized_pnl":
          obj.unrealized_pnl = numberValue
          obj.net_value_change = numberValue
          break
      }
    }

    if (isOffsetOrSummaryRow(obj.code, obj.name)) {
      continue
    }

    if (normalizeSubjectCode(obj.code).startsWith("3102") && !(Number(obj.position) > 0)) {
      continue
    }

    obj.code = normalizeSubjectCode(obj.code)

    result.push(obj)
  }

  const codes = result.map((row) => normalizeSubjectCode(row.code))

  for (const row of result) {
    const code = normalizeSubjectCode(row.code)
    const hasContract = code.startsWith("3102") && /[A-Za-z]{1,4}\d{2,5}/.test(`${code}${row.name || ""}`)
    const isLeaf = hasContract || !codes.some((other) => other !== code && other.startsWith(code))
    const rowKind = inferRowKind(code, row.name)

    row.row_kind = rowKind
    row.is_leaf = isLeaf

    if (rowKind === "derivative") {
      const symbol = extractContractSymbol(code, row.name)
      if (symbol) row.symbol = symbol
      row.direction = Number(row.signed_market_value ?? row.signed_cost ?? 0) < 0 ? "short" : "long"
      row.exchange = inferExchange(String(row.original_code ?? code), symbol)
      row.asset_class = inferAssetClass(symbol, row.name)
    } else if (["private_fund", "fund", "money_fund", "fund_or_stock"].includes(rowKind)) {
      const fundCode = resolveFundHoldingCode(code, String(row.name ?? ""), null)
      if (fundCode) row.symbol = fundCode
    }
    if (!row.direction) {
      row.direction = Number(row.signed_market_value ?? row.signed_cost ?? 0) < 0 || rowKind === "payable" ? "short" : "long"
    }
    row.include_in_detail = isLeaf && hasEconomicValue(row)
    row.include_in_analysis = Boolean(
      row.include_in_detail &&
      (
        rowKind === "derivative" ||
        rowKind === "stock" ||
        rowKind === "bond" ||
        rowKind === "fund_or_stock" ||
        rowKind === "private_fund"
      ),
    )
  }

  return result
}

export function parseValuationRows(rows: unknown[][], filename: string): ValuationAnalysis {
  const headerRowIndex = findHeaderRow(rows)
  const headerRowCount = countHeaderRows(rows, headerRowIndex)
  const columns = buildColumnMeta(rows, headerRowIndex, headerRowCount)
  const summary = extractSummary(rows, headerRowIndex, columns, filename)
  const portfolioData = rowsToObjects(rows, headerRowIndex, headerRowCount, columns)

  return { portfolio_data: portfolioData, summary }
}

function scoreValuationAnalysis(analysis: ValuationAnalysis): number {
  const detailRows = analysis.portfolio_data.filter((row) => row.include_in_detail)
  const holdingsScore = detailRows.length > 0 ? detailRows.length : analysis.portfolio_data.length
  const summaryScore =
    (analysis.summary.nav > 0 ? 10 : 0) +
    (analysis.summary.total_asset > 0 ? 5 : 0)
  return holdingsScore + summaryScore
}

export function parseValuationWorkbook(buffer: Buffer, filename: string): ValuationAnalysis {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  if (workbook.SheetNames.length === 0) throw new Error("工作簿中没有可用的工作表。")

  const orderedSheets = [
    ...workbook.SheetNames.filter((name) => /估值|持仓|valuation|portfolio/i.test(name)),
    ...workbook.SheetNames.filter((name) => !/估值|持仓|valuation|portfolio/i.test(name)),
  ]

  let best: ValuationAnalysis | null = null
  let bestScore = -1

  for (const sheetName of orderedSheets) {
    try {
      const sheet = workbook.Sheets[sheetName]
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: false,
      })
      if (rows.length < 3) continue

      const analysis = parseValuationRows(rows, filename)
      const score = scoreValuationAnalysis(analysis)
      if (score > bestScore) {
        best = analysis
        bestScore = score
      }
    } catch {
      // try next sheet
    }
  }

  if (!best) throw new Error("工作簿中没有可用的工作表。")
  return best
}
