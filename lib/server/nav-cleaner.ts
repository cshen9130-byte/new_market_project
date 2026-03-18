import fs from "fs"
import path from "path"

import Holidays from "date-holidays"
import * as XLSX from "xlsx"

export type NavCleanerRow = {
  date: string
  unitNav: number
  cumulativeNav: number
  sourceDate: string
  sourceUnitNav: string
  sourceCumulativeNav: string
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
const holidayCalendar = new Holidays("CN")

const DATE_HEADER_PATTERNS = [
  /日期|净值日期|估值日期|业务日期|date|tradedate|navdate|valuationdate|asof/i,
]

const UNIT_NAV_HEADER_PATTERNS = [
  /单位净值|基金净值|netassetvalue|unitnav|navperunit|navunit|netvalue|净值|^nav$/i,
]

const CUMULATIVE_NAV_HEADER_PATTERNS = [
  /累计净值|累积净值|复权净值|adjustednav|accumulatednav|accnav|totalnav|adjustednetvalue/i,
]

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

function chooseWorksheet(workbook: XLSX.WorkBook) {
  let bestSheetName = workbook.SheetNames[0]
  let bestRowCount = -1

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
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
        matchHeaderScore(normalizedHeader, UNIT_NAV_HEADER_PATTERNS) + (numericCount / sampleCount) * 3,
      cumulativeScore:
        matchHeaderScore(normalizedHeader, CUMULATIVE_NAV_HEADER_PATTERNS) + (numericCount / sampleCount) * 3,
      numericCount,
    }
  })

  const bestDateColumn = [...scoredColumns].sort((left, right) => right.dateScore - left.dateScore)[0] ?? null
  const dateIndex = bestDateColumn && bestDateColumn.dateScore > 1 ? bestDateColumn.index : null

  const navCandidates = scoredColumns.filter((column) => column.index !== dateIndex)
  const cumulativeCandidate = [...navCandidates].sort((left, right) => right.cumulativeScore - left.cumulativeScore)[0] ?? null
  let cumulativeIndex = cumulativeCandidate && cumulativeCandidate.cumulativeScore > 1 ? cumulativeCandidate.index : null

  const unitCandidate = [...navCandidates]
    .filter((column) => column.index !== cumulativeIndex)
    .sort((left, right) => right.unitScore - left.unitScore)[0] ?? null
  let unitIndex = unitCandidate && unitCandidate.unitScore > 1 ? unitCandidate.index : null

  if (unitIndex == null && cumulativeIndex != null) {
    unitIndex = cumulativeIndex
  }

  if (cumulativeIndex == null && unitIndex != null) {
    cumulativeIndex = unitIndex
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

  return {
    headers,
    dateIndex,
    unitIndex,
    cumulativeIndex,
    inferredDateFormat,
  }
}

function isChinaTradingDay(isoDate: string) {
  const [yearToken, monthToken, dayToken] = isoDate.split("-")
  const year = Number(yearToken)
  const month = Number(monthToken)
  const day = Number(dayToken)
  const localDate = new Date(year, month - 1, day)
  const weekday = localDate.getDay()

  if (weekday === 0 || weekday === 6) return false
  return !holidayCalendar.isHoliday(localDate)
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
  const { headers, dateIndex, unitIndex, cumulativeIndex, inferredDateFormat } = detectColumns(rawRows, headerRowIndex)
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

    if (!parsedDate) {
      if (stringifyCell(row[dateIndex]) || unitNav != null || cumulativeNav != null) {
        skippedRows += 1
      }
      continue
    }

    const resolvedUnitNav = unitNav ?? cumulativeNav
    const resolvedCumulativeNav = cumulativeNav ?? unitNav
    if (resolvedUnitNav == null || resolvedCumulativeNav == null) {
      skippedRows += 1
      continue
    }

    parsedRows.push({
      date: parsedDate.iso,
      unitNav: Number(resolvedUnitNav.toFixed(8)),
      cumulativeNav: Number(resolvedCumulativeNav.toFixed(8)),
      sourceDate: stringifyCell(row[dateIndex]),
      sourceUnitNav: unitIndex != null ? stringifyCell(row[unitIndex]) : "",
      sourceCumulativeNav: cumulativeIndex != null ? stringifyCell(row[cumulativeIndex]) : "",
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
    },
    inferredDateFormat: inferredDateFormat.label,
    totalSourceRows: Math.max(rawRows.length - (headerRowIndex + 1), 0),
    validRowCount: dedupedRows.length,
    duplicateDateCount,
    nonTradingDayCount,
    warnings,
    rows: dedupedRows,
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