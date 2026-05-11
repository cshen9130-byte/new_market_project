import * as XLSX from "xlsx"

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

// 科目代码列候选表头名
const CODE_HEADER_PATTERNS = [
  /^科目代码$|^代码$|^合约代码$|^证券代码$|^code$/i,
]

// 科目名称列候选表头名
const NAME_HEADER_PATTERNS = [
  /^科目名称$|^名称$|^合约名称$|^证券名称$|^品种名称$|^name$/i,
]

function cellToString(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }
  return String(value).trim()
}

function normalizeHeader(value: unknown): string {
  return cellToString(value)
    .replace(/[\s\u3000\t\r\n]/g, "")
}

function matchesAny(header: string, patterns: RegExp[]): boolean {
  const norm = normalizeHeader(header)
  return patterns.some((p) => p.test(norm))
}

/**
 * Find the 0-based row index of the header row.
 * Looks for the row containing a code-like and name-like header.
 * Searches only within the first 30 rows.
 */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i]
    if (!row) continue
    const hasCode = row.some((cell) => matchesAny(cellToString(cell), CODE_HEADER_PATTERNS))
    const hasName = row.some((cell) => matchesAny(cellToString(cell), NAME_HEADER_PATTERNS))
    if (hasCode && hasName) return i
  }
  // Fallback: find first row with >= 4 non-empty cells that looks like headers
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i]
    if (!row) continue
    const nonEmpty = row.filter((c) => cellToString(c).length > 0)
    if (nonEmpty.length >= 4) return i
  }
  return 0
}

/**
 * Extract summary metadata from the rows above the header row.
 * Tries to find fund name, valuation date, nav, total assets, total liabilities.
 */
function extractSummaryFromTopRows(rows: unknown[][], headerRow: number): ValuationSummary {
  const summary: ValuationSummary = {
    fund_name: "未知基金",
    valuation_date: new Date().toISOString().split("T")[0],
    nav: 0,
    total_asset: 0,
    total_liability: 0,
  }

  const FUND_NAME_PATTERN = /基金名称|产品名称|客户名称|fund.?name/i
  const DATE_PATTERN = /估值日期|日期|valuation.?date|date/i
  const NAV_PATTERN = /资产净值|净资产|基金净值/
  const ASSET_PATTERN = /总资产|资产总计|资产合计/
  const LIABILITY_PATTERN = /总负债|负债总计|负债合计/

  for (let i = 0; i < headerRow; i++) {
    const row = rows[i]
    if (!row) continue
    const cells = row.map(cellToString)
    const joined = cells.join("")

    if (FUND_NAME_PATTERN.test(joined)) {
      const idx = cells.findIndex((c) => FUND_NAME_PATTERN.test(c))
      if (idx >= 0) {
        const val = cells[idx + 1] || cells[idx + 2] || ""
        if (val && val.length > 0) summary.fund_name = val
      }
    }

    if (DATE_PATTERN.test(joined)) {
      const idx = cells.findIndex((c) => DATE_PATTERN.test(c))
      if (idx >= 0) {
        const val = cells[idx + 1] || cells[idx + 2] || ""
        if (val && val.length > 0) {
          // Try to parse as date
          const d = new Date(val)
          if (!isNaN(d.getTime())) {
            summary.valuation_date = d.toISOString().split("T")[0]
          } else {
            summary.valuation_date = val
          }
        }
      }
    }

    for (const cell of cells) {
      if (NAV_PATTERN.test(cell)) {
        const nextIdx = cells.indexOf(cell) + 1
        const val = Number(cells[nextIdx] || cells[nextIdx + 1] || "")
        if (!isNaN(val) && val > 0) summary.nav = val
      }
      if (ASSET_PATTERN.test(cell)) {
        const nextIdx = cells.indexOf(cell) + 1
        const val = Number(cells[nextIdx] || cells[nextIdx + 1] || "")
        if (!isNaN(val) && val > 0) summary.total_asset = val
      }
      if (LIABILITY_PATTERN.test(cell)) {
        const nextIdx = cells.indexOf(cell) + 1
        const val = Number(cells[nextIdx] || cells[nextIdx + 1] || "")
        if (!isNaN(val) && val > 0) summary.total_liability = val
      }
    }
  }

  return summary
}

/**
 * Map a raw 2D array of spreadsheet rows into an array of row objects,
 * using the header row to determine field names.
 *
 * Column names are preserved as-is so the client-side field detection logic
 * in valuation_page.tsx can still do its own matching.  We additionally
 * inject normalised aliases for the most common Chinese column names so the
 * client's FIELD_CANDIDATES lookup has something to hit.
 */
function rowsToObjects(rows: unknown[][], headerRowIndex: number): ValuationRow[] {
  const headers = (rows[headerRowIndex] || []).map(cellToString)

  const result: ValuationRow[] = []

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Skip fully-empty rows
    const nonEmpty = row.filter((c) => cellToString(c).length > 0)
    if (nonEmpty.length === 0) continue

    const obj: ValuationRow = { code: "", name: "" }

    headers.forEach((header, colIdx) => {
      const rawVal = row[colIdx] ?? null
      const strVal = cellToString(rawVal)
      const numVal = Number(strVal)
      const value = !isNaN(numVal) && isFinite(numVal) && strVal !== "" ? numVal : strVal

      // Store under original header name
      if (header) obj[header] = value

      // Inject normalised aliases for client-side detection
      const norm = normalizeHeader(header)
      if (/^科目代码$|^代码$|^合约代码$|^证券代码$/i.test(norm)) {
        obj.code = strVal
      } else if (/^科目名称$|^名称$|^合约名称$|^证券名称$|^品种名称$/i.test(norm)) {
        obj.name = strVal
      } else if (/^数量$|^持仓数量$|^手数$|^合约数$/.test(norm)) {
        if (typeof value === "number") obj["数量"] = value
      } else if (/^市值$|^公允价值$|^估值$|^名义市值$/.test(norm)) {
        if (typeof value === "number") obj["market_value"] = value
      } else if (/^市价$|^结算价$|^最新价$|^现价$/.test(norm)) {
        if (typeof value === "number") obj["current_price"] = value
      } else if (/^成本$|^持仓成本$/.test(norm)) {
        if (typeof value === "number") obj["cost"] = value
      } else if (/^单位成本$|^开仓均价$/.test(norm)) {
        if (typeof value === "number") obj["unit_cost"] = value
      } else if (/^估值增值$/.test(norm)) {
        if (typeof value === "number") obj["unrealized_pnl"] = value
      } else if (/^保证金$|^保证金占用$/.test(norm)) {
        if (typeof value === "number") obj["margin_usage"] = value
      }
    })

    result.push(obj)
  }

  return result
}

/**
 * Parse a valuation workbook buffer and return structured portfolio data.
 */
export function parseValuationWorkbook(buffer: Buffer, filename: string): ValuationAnalysis {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })

  // Prefer a sheet whose name contains "估值" or "持仓", otherwise use the first sheet
  const sheetName =
    workbook.SheetNames.find((n) => /估值|持仓|portfolio|valuation/i.test(n)) ??
    workbook.SheetNames[0]

  if (!sheetName) {
    throw new Error("工作簿中没有可用的工作表")
  }

  const sheet = workbook.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  })

  const headerRowIndex = findHeaderRow(rows)
  const summary = extractSummaryFromTopRows(rows, headerRowIndex)
  const portfolioData = rowsToObjects(rows, headerRowIndex)

  // Post-process: also try to extract nav/assets from portfolio data rows
  if (summary.nav === 0) {
    const navRow = portfolioData.find((item) => {
      const n = (item.name || "").replace(/\s/g, "")
      return /^(基金)?资产净值$|^净资产$|^基金净值$|^资产总值$/.test(n)
    })
    if (navRow) {
      const mv = Number(navRow["market_value"] ?? navRow["market_value"] ?? 0)
      if (mv > 0) summary.nav = mv
    }
  }

  return { portfolio_data: portfolioData, summary }
}
