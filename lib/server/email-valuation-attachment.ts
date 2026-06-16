/**
 * Unit NAV extraction from 估值表 email attachments (.xls / .xlsx).
 * Used as fallback when the same email has no 净值表 NAV data.
 */

import * as XLSX from "xlsx"
import {
  extractNavMetadata,
  type ExtractedNavData,
} from "@/lib/server/email-nav-extract"
import { parseValuationWorkbook, type ValuationRow } from "@/lib/server/valuation-analyzer"

export type ValuationAttachmentInfo = { filename: string; part: string }

const VALUATION_FILENAME_RE = /估值表|估值|专用表/i
const EXCLUDE_VALUATION_RE = /净值表|台账|份额明细|业绩报酬|虚拟净值表现/i

function normalizeName(name: string): string {
  return name.replace(/[\s\u3000:：]/g, "")
}

function parseNavNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  const text = String(raw ?? "").trim().replace(/,/g, "")
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function isPlausibleUnitNav(n: number): boolean {
  return n > 0.05 && n < 500
}

function isUnitNavLabel(name: string): boolean {
  const n = normalizeName(name)
  if (!n || /累计/.test(n)) return false
  return /^(单位净值|今日单位净值|基金份额净值|基金单位净值|份额净值|基金净值)$/.test(n)
    || (/单位净值/.test(n) && !/累计/.test(n))
}

function isCumNavLabel(name: string): boolean {
  const n = normalizeName(name)
  return /^(累计单位净值|累计净值|基金份额累计净值|累积单位净值)$/.test(n)
    || (/累计/.test(n) && /净值/.test(n))
}

function normaliseDate(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return raw
  const compact = raw.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const loose = raw.match(/(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/)
  if (loose) {
    const [, y, m, d] = loose
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return null
}

function subjectOrFilenameDate(subject: string, filename: string): string | null {
  const iso = subject.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  if (iso) return iso
  const compact = (subject + filename).match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

function firstPlausibleNavInCells(cells: string[], startIdx: number): number | null {
  for (let j = startIdx; j < cells.length; j++) {
    const inlineUnit = cells[j].match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (inlineUnit && !/累计/.test(cells[j])) {
      const n = parseFloat(inlineUnit[1])
      if (isPlausibleUnitNav(n)) return n
    }
    const n = parseNavNumber(cells[j])
    if (n != null && isPlausibleUnitNav(n)) return n
  }
  return null
}

function scanRowsForNav(rows: unknown[][]): { unit: number | null; cum: number | null; date: string | null } {
  let unit: number | null = null
  let cum: number | null = null
  let date: string | null = null

  for (const row of rows.slice(0, 120)) {
    const cells = (row ?? []).map((cell) => String(cell ?? "").trim())
    const joined = cells.join(" ")

    const dateMatch = joined.match(/(?:估值日期|净值日期|日期)\s*[：:]\s*(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})/)
    if (dateMatch) {
      const parsed = normaliseDate(dateMatch[1])
      if (parsed) date = parsed
    }

    const joinedUnit = joined.match(/(?:^|[^累计])单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (joinedUnit) {
      const n = parseFloat(joinedUnit[1])
      if (isPlausibleUnitNav(n)) unit = n
    }
    const joinedCum = joined.match(/累计(?:单位)?净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (joinedCum) {
      const n = parseFloat(joinedCum[1])
      if (n > 0.05) cum = n
    }

    for (let i = 0; i < cells.length; i++) {
      const label = normalizeName(cells[i])
      if (isUnitNavLabel(label) || (/单位净值/.test(cells[i]) && !/累计/.test(cells[i]))) {
        const n = firstPlausibleNavInCells(cells, i + 1)
        if (n != null) unit = n
      }
      if (isCumNavLabel(label) || (/累计/.test(cells[i]) && /净值/.test(cells[i]))) {
        const n = firstPlausibleNavInCells(cells, i + 1)
        if (n != null) cum = n
      }
    }
  }

  return { unit, cum, date }
}

function scanWorkbookNav(buffer: Buffer): { unit: number | null; cum: number | null; date: string | null } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  let date: string | null = null

  for (const sheetName of workbook.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    })
    const found = scanRowsForNav(rows)
    if (found.unit != null) return found
    if (found.date && !date) date = found.date
  }

  return { unit: null, cum: null, date }
}

function scanPortfolioNav(rows: ValuationRow[]): { unit: number | null; cum: number | null } {
  let unit: number | null = null
  let cum: number | null = null
  for (const row of rows) {
    const name = normalizeName(String(row.name ?? ""))
    if (!name) continue
    if (isUnitNavLabel(name)) {
      const val = pickNavNumberFromRow(row)
      if (val != null) unit = val
    } else if (isCumNavLabel(name)) {
      const val = pickNavNumberFromRow(row)
      if (val != null) cum = val
    }
  }
  return { unit, cum }
}

function pickNavNumberFromRow(row: ValuationRow): number | null {
  const keys = ["price", "current_price", "market_value", "unit_cost", "cost"]
  for (const k of keys) {
    const n = parseNavNumber(row[k])
    if (n != null && isPlausibleUnitNav(n)) return n
  }
  for (const [k, v] of Object.entries(row)) {
    if (k === "code" || k === "name" || k === "original_code") continue
    const n = parseNavNumber(v)
    if (n != null && isPlausibleUnitNav(n)) return n
  }
  return null
}

export function isValuationAttachmentFilename(filename: string): boolean {
  if (!/\.xlsx?$/i.test(filename)) return false
  if (EXCLUDE_VALUATION_RE.test(filename)) return false
  return VALUATION_FILENAME_RE.test(filename)
}

/** Pick spreadsheet attachments that look like 估值表 files. */
export function selectValuationAttachments(
  subject: string,
  attachments: ValuationAttachmentInfo[],
): ValuationAttachmentInfo[] {
  const spreadsheets = attachments.filter(
    (a) => /\.xlsx?$/i.test(a.filename) && !EXCLUDE_VALUATION_RE.test(a.filename),
  )
  const explicit = spreadsheets.filter((a) => isValuationAttachmentFilename(a.filename))
  if (explicit.length > 0) return explicit
  if (/估值表|估值/i.test(subject)) {
    return spreadsheets.filter((a) => !/净值表|每日净值|资产净值公告/i.test(a.filename))
  }
  return []
}

/** Parse unit NAV from a 估值表 workbook buffer. */
export function extractNavFromValuationBuffer(
  buffer: Buffer,
  filename: string,
  subject: string,
): ExtractedNavData | null {
  try {
    const headerScan = scanWorkbookNav(buffer)
    const analysis = parseValuationWorkbook(buffer, filename)
    const portfolioScan = scanPortfolioNav(analysis.portfolio_data)
    const shared = extractNavMetadata(subject, "")

    const nav = headerScan.unit ?? portfolioScan.unit
    if (nav == null || !isPlausibleUnitNav(nav)) return null

    const navDate =
      headerScan.date ??
      (analysis.summary.valuation_date ? normaliseDate(analysis.summary.valuation_date) : null) ??
      subjectOrFilenameDate(subject, filename)

    if (!navDate) return null

    const fundName =
      shared.fundName ??
      (analysis.summary.fund_name && analysis.summary.fund_name !== "未知基金"
        ? analysis.summary.fund_name
        : null)

    return {
      nav,
      navDate,
      cumulativeNav: headerScan.cum ?? portfolioScan.cum,
      productCode: shared.productCode,
      fundName,
      source: "attachment_valuation_table",
    }
  } catch {
    return null
  }
}
