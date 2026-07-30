import fs from "fs"
import path from "path"

import * as XLSX from "xlsx"

import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"

export type NavCleanerRow = {
  date: string
  unitNav: number
  cumulativeNav: number
  adjustedNav: number | null
  /** Optional 产品代码 from workbook column when present. */
  productCode?: string | null
  sourceDate: string
  sourceUnitNav: string
  sourceCumulativeNav: string
  sourceAdjustedNav: string
  isChinaTradingDay: boolean
}

export type NavCleanerAnalysis = {
  sourceFileName: string
  sheetName: string
  headerRowNumber: number
  headers: string[]
  detectedColumns: {
    date: string | null
    unitNav: string | null
    cumulativeNav: string | null
    adjustedNav: string | null
  }
  inferredDateFormat: string
  totalSourceRows: number
  validRowCount: number
  duplicateDateCount: number
  nonTradingDayCount: number
  warnings: string[]
  rows: NavCleanerRow[]
}

type DateOrder = "ymd" | "mdy" | "dmy"

const TEMPLATE_PATH = path.join(process.cwd(), "NAV_template", "上传净值模版.xlsx")

const PRODUCT_CODE_HEADER_PATTERNS = [
  /^产品代码$|^基金代码$|^备案编号$|productcode|fundcode|beian/i,
]

const DATE_HEADER_PATTERNS = [
  /日期|净值日期|估值日期|业务日期|date|tradedate|navdate|valuationdate|asof/i,
]

const UNIT_NAV_HEADER_PATTERNS = [
  /试算后单位净值/i,
  /单位净值|今日单位净值|基金份额净值|基金单位净值|份额净值|netassetvalue|unitnav|navperunit|navunit|^nav$/i,
]

const WITHDRAWAL_NAV_HEADER_PATTERNS = [
  /累计单位净值|累计份额净值|累计净值|累积净值|accumulatednav|accnav|totalnav/i,
]

const ADJUSTED_NAV_HEADER_PATTERNS = [
  /复权净值|adjustednav|adjustednetvalue/i,
]

const CUMULATIVE_NAV_HEADER_PATTERNS = [
  ...WITHDRAWAL_NAV_HEADER_PATTERNS,
  ...ADJUSTED_NAV_HEADER_PATTERNS,
]

/** Headers like 累计单位净值 also match /单位净值/ — exclude them from unit scoring. */
function isAdjustedNavHeader(normalizedHeader: string): boolean {
  return ADJUSTED_NAV_HEADER_PATTERNS.some((pattern) => pattern.test(normalizedHeader))
}

function isWithdrawalNavHeader(normalizedHeader: string): boolean {
  return WITHDRAWAL_NAV_HEADER_PATTERNS.some((pattern) => pattern.test(normalizedHeader))
}

function isCumulativeNavHeader(normalizedHeader: string): boolean {
  return isWithdrawalNavHeader(normalizedHeader) || isAdjustedNavHeader(normalizedHeader)
}

/** Total AUM / share-count columns must not score as unit NAV (Citics 【基金净值】 xlsx). */
function isNonUnitNavHeader(normalizedHeader: string): boolean {
  if (isCumulativeNavHeader(normalizedHeader)) return true
  return /资产净值|净资产|资产份额|持有份额|份额数|成立以来|收益率|涨跌幅|试算前单位净值|试算前累计|虚拟单位净值|totalasset|netasset(?!value)/i.test(
    normalizedHeader,
  )
}

function stringifyCell(value: unknown) {
  if (value == null) return ""
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = `${value.getMonth() + 1}`.padStart(2, "0")
    const day = `${value.getDate()}`.padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  return String(value).trim()
}

function normalizeHeader(value: unknown) {
  return stringifyCell(value)
    .toLowerCase()
    .replace(/[\s_\-（）()【】\[\]:：]/g, "")
}

function matchHeaderScore(normalizedHeader: string, patterns: RegExp[]) {
  if (!normalizedHeader) return 0
  let score = 0
  for (const pattern of patterns) {
    if (pattern.test(normalizedHeader)) {
      score += 5
    }
  }
  return score
}

function isValidDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false

  const candidate = new Date(year, month - 1, day)
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  )
}

function resolveYear(token: string) {
  const numeric = Number(token)
  if (!Number.isFinite(numeric)) return Number.NaN
  if (token.length === 2) {
    return numeric >= 70 ? 1900 + numeric : 2000 + numeric
  }
  return numeric
}

function normalizeDateString(text: string) {
  return text
    .trim()
    .replace(/年|\./g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, "")
}

function formatIsoDate(year: number, month: number, day: number) {
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`
}

function parseDateValue(
  value: unknown,
  preferredOrder: DateOrder,
): { iso: string; formatLabel: string } | null {
  if (value == null || value === "") return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      iso: formatIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      formatLabel: "Date object",
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed && isValidDateParts(parsed.y, parsed.m, parsed.d)) {
      return {
        iso: formatIsoDate(parsed.y, parsed.m, parsed.d),
        formatLabel: "Excel serial date",
      }
    }
  }

  const raw = normalizeDateString(String(value))
  if (!raw) return null

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4))
    const month = Number(raw.slice(4, 6))
    const day = Number(raw.slice(6, 8))
    if (isValidDateParts(year, month, day)) {
      return { iso: formatIsoDate(year, month, day), formatLabel: "YYYYMMDD" }
    }
  }

  const tokens = raw.split(/[\/-]/).filter(Boolean)
  if (tokens.length !== 3) return null

  if (tokens[0].length === 4) {
    const year = Number(tokens[0])
    const month = Number(tokens[1])
    const day = Number(tokens[2])
    if (isValidDateParts(year, month, day)) {
      return { iso: formatIsoDate(year, month, day), formatLabel: "YYYY-MM-DD" }
    }
    return null
  }

  const year = resolveYear(tokens[2])
  if (!Number.isFinite(year)) return null

  const first = Number(tokens[0])
  const second = Number(tokens[1])
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null

  const [month, day] = preferredOrder === "dmy" ? [second, first] : [first, second]
  if (!isValidDateParts(year, month, day)) return null

  return {
    iso: formatIsoDate(year, month, day),
    formatLabel: preferredOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY",
  }
}

function parseNumberValue(value: unknown) {
  if (value == null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return value

  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[￥$]/g, "")
    .replace(/^\((.*)\)$/, "-$1")

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function inferDateOrder(values: unknown[]): { order: DateOrder; label: string } {
  let ymd = 0
  let mdy = 0
  let dmy = 0
  let excel = 0

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      excel += 1
      continue
    }

    const raw = normalizeDateString(stringifyCell(value))
    if (!raw) continue

    if (/^\d{8}$/.test(raw) && /^19|20/.test(raw)) {
      ymd += 1
      continue
    }

    const tokens = raw.split(/[\/-]/).filter(Boolean)
    if (tokens.length !== 3) continue

    if (tokens[0].length === 4) {
      ymd += 1
      continue
    }

    const first = Number(tokens[0])
    const second = Number(tokens[1])
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue

    if (first > 12 && second <= 12) {
      dmy += 1
    } else if (second > 12 && first <= 12) {
      mdy += 1
    }
  }

  if (dmy > mdy && dmy > 0) {
    return { order: "dmy", label: "DD/MM/YYYY" }
  }
  if (mdy > 0) {
    return { order: "mdy", label: "MM/DD/YYYY" }
  }
  if (ymd > 0 || excel > 0) {
    return { order: "ymd", label: excel > ymd ? "Excel serial date" : "YYYY-MM-DD" }
  }
  return { order: "mdy", label: "MM/DD/YYYY" }
}

/**
 * WPS / some exporters write a stale `<dimension ref="A1:I3"/>` while sheetData
 * still contains thousands of rows. SheetJS trusts `!ref`, so expand it from
 * actual cell keys before sheet_to_json.
 */
export function expandWorksheetUsedRange(worksheet: XLSX.WorkSheet): void {
  const cellKeys = Object.keys(worksheet).filter((key) => !key.startsWith("!"))
  if (cellKeys.length === 0) return

  let minR = Infinity
  let minC = Infinity
  let maxR = -1
  let maxC = -1
  for (const key of cellKeys) {
    const addr = XLSX.utils.decode_cell(key)
    if (addr.r < minR) minR = addr.r
    if (addr.c < minC) minC = addr.c
    if (addr.r > maxR) maxR = addr.r
    if (addr.c > maxC) maxC = addr.c
  }
  if (maxR < 0 || maxC < 0 || !Number.isFinite(minR) || !Number.isFinite(minC)) return

  const expanded = XLSX.utils.encode_range({
    s: { r: minR, c: minC },
    e: { r: maxR, c: maxC },
  })
  const current = worksheet["!ref"]
  if (!current) {
    worksheet["!ref"] = expanded
    return
  }
  try {
    const cur = XLSX.utils.decode_range(current)
    const exp = XLSX.utils.decode_range(expanded)
    const curCells = (cur.e.r - cur.s.r + 1) * (cur.e.c - cur.s.c + 1)
    const expCells = (exp.e.r - exp.s.r + 1) * (exp.e.c - exp.s.c + 1)
    if (expCells > curCells) worksheet["!ref"] = expanded
  } catch {
    worksheet["!ref"] = expanded
  }
}

function chooseWorksheet(workbook: XLSX.WorkBook) {
  let bestSheetName = workbook.SheetNames[0]
  let bestRowCount = -1

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    expandWorksheetUsedRange(worksheet)
    const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(worksheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    })
    if (rows.length > bestRowCount) {
      bestRowCount = rows.length
      bestSheetName = sheetName
    }
  }

  return bestSheetName
}

function detectHeaderRow(rows: unknown[][]) {
  let bestIndex = 0
  let bestScore = -1

  const scanLimit = Math.min(rows.length, 12)
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const cells = rows[rowIndex]?.map(normalizeHeader).filter(Boolean) ?? []
    if (cells.length === 0) continue

    let score = 0
    let categories = 0

    const hasDate = cells.some((cell) => matchHeaderScore(cell, DATE_HEADER_PATTERNS) > 0)
    const hasUnit = cells.some((cell) => matchHeaderScore(cell, UNIT_NAV_HEADER_PATTERNS) > 0)
    const hasCum = cells.some((cell) => matchHeaderScore(cell, CUMULATIVE_NAV_HEADER_PATTERNS) > 0)

    if (hasDate) {
      categories += 1
      score += 5
    }
    if (hasUnit) {
      categories += 1
      score += 5
    }
    if (hasCum) {
      categories += 1
      score += 5
    }

    score += cells.reduce(
      (sum, cell) =>
        sum +
        matchHeaderScore(cell, DATE_HEADER_PATTERNS) +
        matchHeaderScore(cell, UNIT_NAV_HEADER_PATTERNS) +
        matchHeaderScore(cell, CUMULATIVE_NAV_HEADER_PATTERNS),
      0,
    )

    if (categories >= 2 && score > bestScore) {
      bestScore = score
      bestIndex = rowIndex
    }
  }

  return bestScore >= 0 ? bestIndex : 0
}

function detectColumns(rows: unknown[][], headerRowIndex: number) {
  const headers = rows[headerRowIndex]?.map(stringifyCell) ?? []
  const sampleRows = rows.slice(headerRowIndex + 1, headerRowIndex + 31)
  const columnCount = Math.max(
    headers.length,
    ...sampleRows.map((row) => row.length),
  )

  const dateSamples = [] as unknown[]
  const scoredColumns = Array.from({ length: columnCount }, (_, index) => {
    const header = headers[index] ?? ""
    const normalizedHeader = normalizeHeader(header)
    const values = sampleRows.map((row) => row[index]).filter((value) => value != null && value !== "")
    dateSamples.push(...values.slice(0, 5))

    const parseableDateCount = values.filter((value) => parseDateValue(value, "mdy")).length
    const numericCount = values.filter((value) => parseNumberValue(value) != null).length
    const sampleCount = values.length || 1

    return {
      index,
      header,
      dateScore:
        matchHeaderScore(normalizedHeader, DATE_HEADER_PATTERNS) + (parseableDateCount / sampleCount) * 6,
      unitScore:
        (isNonUnitNavHeader(normalizedHeader)
          ? 0
          : matchHeaderScore(normalizedHeader, UNIT_NAV_HEADER_PATTERNS)) +
        (numericCount / sampleCount) * 3,
      withdrawalScore:
        matchHeaderScore(normalizedHeader, WITHDRAWAL_NAV_HEADER_PATTERNS) + (numericCount / sampleCount) * 3,
      adjustedScore:
        matchHeaderScore(normalizedHeader, ADJUSTED_NAV_HEADER_PATTERNS) + (numericCount / sampleCount) * 3,
      cumulativeScore:
        matchHeaderScore(normalizedHeader, CUMULATIVE_NAV_HEADER_PATTERNS) + (numericCount / sampleCount) * 3,
      numericCount,
    }
  })

  const bestDateColumn = [...scoredColumns].sort((left, right) => right.dateScore - left.dateScore)[0] ?? null
  const dateIndex = bestDateColumn && bestDateColumn.dateScore > 1 ? bestDateColumn.index : null

  const navCandidates = scoredColumns.filter((column) => column.index !== dateIndex)

  const adjustedCandidate = [...navCandidates].sort((left, right) => right.adjustedScore - left.adjustedScore)[0] ?? null
  // Require an explicit header keyword match (score contribution ≥ 5) beyond the baseline
  // numeric-only score (3).  A threshold of > 4 prevents bare-numeric columns from being
  // mis-assigned as 复权净值 in 3-column attachments that omit the adjusted NAV column.
  let adjustedIndex = adjustedCandidate && adjustedCandidate.adjustedScore > 4 ? adjustedCandidate.index : null

  const withdrawalCandidate = [...navCandidates]
    .filter((column) => column.index !== adjustedIndex)
    .sort((left, right) => right.withdrawalScore - left.withdrawalScore)[0] ?? null
  let cumulativeIndex = withdrawalCandidate && withdrawalCandidate.withdrawalScore > 1 ? withdrawalCandidate.index : null

  const unitCandidate = [...navCandidates]
    .filter((column) => column.index !== cumulativeIndex && column.index !== adjustedIndex)
    .filter((column) => !isNonUnitNavHeader(normalizeHeader(column.header)))
    .sort((left, right) => right.unitScore - left.unitScore)[0] ?? null
  let unitIndex = unitCandidate && unitCandidate.unitScore > 1 ? unitCandidate.index : null

  if (unitIndex == null && cumulativeIndex != null) {
    unitIndex = cumulativeIndex
  }
  if (unitIndex == null && adjustedIndex != null) {
    unitIndex = adjustedIndex
  }

  if (cumulativeIndex == null && adjustedIndex != null && adjustedIndex !== unitIndex) {
    cumulativeIndex = adjustedIndex
  }
  if (cumulativeIndex == null && unitIndex != null) {
    cumulativeIndex = unitIndex
  }
  if (adjustedIndex == null && cumulativeIndex != null && cumulativeIndex !== unitIndex) {
    adjustedIndex = cumulativeIndex
  }
  if (adjustedIndex == null && unitIndex != null) {
    adjustedIndex = unitIndex
  }

  if (unitIndex == null && cumulativeIndex == null) {
    const numericColumns = navCandidates.filter((column) => column.numericCount > 0)
    if (numericColumns[0]) unitIndex = numericColumns[0].index
    if (numericColumns[1]) {
      cumulativeIndex = numericColumns[1].index
    } else if (numericColumns[0]) {
      cumulativeIndex = numericColumns[0].index
    }
  }

  const inferredDateFormat = inferDateOrder(dateSamples)

  let productCodeIndex: number | null = null
  for (let index = 0; index < headers.length; index += 1) {
    const normalized = normalizeHeader(headers[index] ?? "")
    if (matchHeaderScore(normalized, PRODUCT_CODE_HEADER_PATTERNS) > 0) {
      productCodeIndex = index
      break
    }
  }

  return {
    headers,
    dateIndex,
    unitIndex,
    cumulativeIndex,
    adjustedIndex,
    productCodeIndex,
    inferredDateFormat,
  }
}

function isWorkbookReturnIndexRow(row: NavCleanerRow, baselineUnit: number): boolean {
  const allEqual =
    Math.abs(row.unitNav - row.cumulativeNav) / row.unitNav < 0.001 &&
    (row.adjustedNav == null || Math.abs(row.unitNav - row.adjustedNav) / row.unitNav < 0.001)
  return allEqual && row.unitNav / baselineUnit >= 2
}

/** Drop summary rows where cumulative-return / AUM columns were misread as unit NAV. */
function filterImplausibleWorkbookNavRows(rows: NavCleanerRow[], warnings: string[]): NavCleanerRow[] {
  if (rows.length < 2) return rows
  const SPIKE_RATIO = 2
  const filtered: NavCleanerRow[] = []
  for (const row of rows) {
    const prev = filtered.at(-1)
    if (prev) {
      const ratio = row.unitNav / prev.unitNav
      const allEqual =
        Math.abs(row.unitNav - row.cumulativeNav) / row.unitNav < 0.001 &&
        (row.adjustedNav == null || Math.abs(row.unitNav - row.adjustedNav) / row.unitNav < 0.001)
      if (allEqual && (ratio >= SPIKE_RATIO || ratio <= 1 / SPIKE_RATIO)) {
        warnings.push(
          `已跳过 ${row.date} 异常净值 ${row.unitNav}（相对前一日 ${prev.unitNav} 变动过大，疑似累计收益/资产净值误读）`,
        )
        continue
      }
    }
    filtered.push(row)
  }

  let baselineIdx = -1
  for (let i = filtered.length - 1; i >= 0; i -= 1) {
    const unit = filtered[i]?.unitNav
    if (unit == null || !Number.isFinite(unit)) continue
    if (i > 0) {
      const prevUnit = filtered[i - 1]?.unitNav
      if (
        prevUnit != null &&
        Math.abs(unit - filtered[i].cumulativeNav) / unit < 0.001 &&
        unit / prevUnit >= SPIKE_RATIO
      ) {
        continue
      }
    }
    baselineIdx = i
    break
  }
  if (baselineIdx < 0 || baselineIdx >= filtered.length - 1) return filtered

  const baselineUnit = filtered[baselineIdx].unitNav
  let cutFrom = filtered.length
  for (let i = filtered.length - 1; i > baselineIdx; i -= 1) {
    if (!isWorkbookReturnIndexRow(filtered[i], baselineUnit)) break
    warnings.push(
      `已跳过 ${filtered[i].date} 异常净值 ${filtered[i].unitNav}（尾部累计收益指数误读，相对基准 ${baselineUnit} 过高）`,
    )
    cutFrom = i
  }
  return cutFrom < filtered.length ? filtered.slice(0, cutFrom) : filtered
}

function formatTemplateDate(isoDate: string) {
  const [yearToken, monthToken, dayToken] = isoDate.split("-")
  const year = Number(yearToken)
  const month = Number(monthToken)
  const day = Number(dayToken)
  return `${month}/${day}/${`${year % 100}`.padStart(2, "0")}`
}

export function analyzeNavWorkbook(buffer: Buffer, sourceFileName: string): NavCleanerAnalysis {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheetName = chooseWorksheet(workbook)
  const worksheet = workbook.Sheets[sheetName]
  expandWorksheetUsedRange(worksheet)
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  })

  if (rawRows.length === 0) {
    throw new Error("上传文件中没有可读取的数据。")
  }

  const headerRowIndex = detectHeaderRow(rawRows)
  const {
    headers,
    dateIndex,
    unitIndex,
    cumulativeIndex,
    adjustedIndex,
    productCodeIndex,
    inferredDateFormat,
  } = detectColumns(rawRows, headerRowIndex)
  const warnings: string[] = []

  if (dateIndex == null) {
    throw new Error("无法识别日期列，请确认文件中包含日期字段。")
  }
  if (unitIndex == null && cumulativeIndex == null) {
    throw new Error("无法识别净值列，请确认文件中包含单位净值或累计净值字段。")
  }
  if (unitIndex === cumulativeIndex) {
    warnings.push("仅识别到一列净值数据，已同时用于单位净值和累计净值。")
  }

  const parsedRows: NavCleanerRow[] = []
  let skippedRows = 0

  for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
    const row = rawRows[rowIndex] ?? []
    const parsedDate = parseDateValue(row[dateIndex], inferredDateFormat.order)
    const unitNav = unitIndex != null ? parseNumberValue(row[unitIndex]) : null
    const cumulativeNav = cumulativeIndex != null ? parseNumberValue(row[cumulativeIndex]) : null
    const adjustedNav = adjustedIndex != null ? parseNumberValue(row[adjustedIndex]) : null
    const rowProductCode =
      productCodeIndex != null
        ? stringifyCell(row[productCodeIndex]).trim().toUpperCase() || null
        : null

    if (!parsedDate) {
      if (stringifyCell(row[dateIndex]) || unitNav != null || cumulativeNav != null || adjustedNav != null) {
        skippedRows += 1
      }
      continue
    }

    const resolvedUnitNav = unitNav ?? cumulativeNav ?? adjustedNav
    const resolvedCumulativeNav = cumulativeNav ?? adjustedNav ?? unitNav
    const resolvedAdjustedNav = adjustedNav ?? cumulativeNav ?? unitNav
    if (resolvedUnitNav == null || resolvedCumulativeNav == null || resolvedAdjustedNav == null) {
      skippedRows += 1
      continue
    }

    parsedRows.push({
      date: parsedDate.iso,
      unitNav: Number(resolvedUnitNav.toFixed(8)),
      cumulativeNav: Number(resolvedCumulativeNav.toFixed(8)),
      adjustedNav: Number(resolvedAdjustedNav.toFixed(8)),
      productCode: rowProductCode,
      sourceDate: stringifyCell(row[dateIndex]),
      sourceUnitNav: unitIndex != null ? stringifyCell(row[unitIndex]) : "",
      sourceCumulativeNav: cumulativeIndex != null ? stringifyCell(row[cumulativeIndex]) : "",
      sourceAdjustedNav: adjustedIndex != null ? stringifyCell(row[adjustedIndex]) : "",
      isChinaTradingDay: isChinaTradingDay(parsedDate.iso),
    })
  }

  if (parsedRows.length === 0) {
    throw new Error("无法提取有效净值数据，请检查日期列和净值列内容。")
  }

  const dedupedByDate = new Map<string, NavCleanerRow>()
  for (const row of parsedRows) {
    dedupedByDate.set(row.date, row)
  }

  const dedupedRows = [...dedupedByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  const duplicateDateCount = parsedRows.length - dedupedRows.length
  const nonTradingDayCount = dedupedRows.filter((row) => !row.isChinaTradingDay).length
  const filteredRows = filterImplausibleWorkbookNavRows(dedupedRows, warnings)

  if (skippedRows > 0) {
    warnings.push(`已跳过 ${skippedRows} 行无法识别的记录。`)
  }
  if (duplicateDateCount > 0) {
    warnings.push(`发现 ${duplicateDateCount} 个重复日期，已保留该日期的最后一条记录。`)
  }

  return {
    sourceFileName,
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    headers,
    detectedColumns: {
      date: headers[dateIndex] || null,
      unitNav: unitIndex != null ? headers[unitIndex] || null : null,
      cumulativeNav: cumulativeIndex != null ? headers[cumulativeIndex] || null : null,
      adjustedNav: adjustedIndex != null ? headers[adjustedIndex] || null : null,
    },
    inferredDateFormat: inferredDateFormat.label,
    totalSourceRows: Math.max(rawRows.length - (headerRowIndex + 1), 0),
    validRowCount: filteredRows.length,
    duplicateDateCount,
    nonTradingDayCount,
    warnings,
    rows: filteredRows,
  }
}

export function buildTemplateWorkbook(rows: NavCleanerRow[]) {
  const templateWorkbook = fs.existsSync(TEMPLATE_PATH) ? XLSX.readFile(TEMPLATE_PATH) : XLSX.utils.book_new()
  const templateSheetName = templateWorkbook.SheetNames[0] || "Sheet1"
  const outputRows = [
    ["日期", "单位净值", "累计净值"],
    ...rows.map((row) => [formatTemplateDate(row.date), row.unitNav, row.cumulativeNav]),
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(outputRows)

  worksheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }]
  for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
    const dateCell = worksheet[`A${rowIndex}`]
    const unitCell = worksheet[`B${rowIndex}`]
    const cumulativeCell = worksheet[`C${rowIndex}`]
    if (dateCell) dateCell.z = "m/d/yy"
    if (unitCell) unitCell.z = "0.0000"
    if (cumulativeCell) cumulativeCell.z = "0.0000"
  }

  templateWorkbook.Sheets[templateSheetName] = worksheet
  if (!templateWorkbook.SheetNames.includes(templateSheetName)) {
    templateWorkbook.SheetNames = [templateSheetName]
  }

  return XLSX.write(templateWorkbook, { type: "buffer", bookType: "xlsx" })
}