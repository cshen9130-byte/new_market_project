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
const UNIT_NAV_NAME_RE = /^(单位净值|今日单位净值|基金份额净值|基金单位净值)$/u
const CUM_NAV_NAME_RE = /^(累计单位净值|累计净值|基金份额累计净值|累积单位净值)$/u

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

function pickNavNumber(row: ValuationRow): number | null {
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

function normaliseDate(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return raw
  const compact = raw.match(/^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const loose = raw.match(/(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/)
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

function scanPortfolioNav(rows: ValuationRow[]): { unit: number | null; cum: number | null } {
  let unit: number | null = null
  let cum: number | null = null
  for (const row of rows) {
    const name = normalizeName(String(row.name ?? ""))
    if (!name) continue
    const val = pickNavNumber(row)
    if (val == null) continue
    if (UNIT_NAV_NAME_RE.test(name)) unit = val
    else if (CUM_NAV_NAME_RE.test(name)) cum = val
  }
  return { unit, cum }
}

function scanSheetHeaderNav(buffer: Buffer): { unit: number | null; cum: number | null; date: string | null } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheetName =
    workbook.SheetNames.find((name) => /估值|valuation|portfolio/i.test(name)) ??
    workbook.SheetNames[0]
  if (!sheetName) return { unit: null, cum: null, date: null }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: false,
  })

  let unit: number | null = null
  let cum: number | null = null
  let date: string | null = null

  for (const row of rows.slice(0, 80)) {
    const cells = (row ?? []).map((cell) => String(cell ?? "").trim())
    const joined = cells.join(" ")

    const dateMatch = joined.match(/(?:估值日期|净值日期|日期)\s*[：:]\s*(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})/)
    if (dateMatch) {
      const parsed = normaliseDate(dateMatch[1])
      if (parsed) date = parsed
    }

    for (let i = 0; i < cells.length; i++) {
      const label = normalizeName(cells[i])
      const inlineUnit = cells[i].match(/单位净值\s*[：:]\s*(\d+\.\d+)/)
      if (inlineUnit) unit = parseFloat(inlineUnit[1])
      const inlineCum = cells[i].match(/累计(?:单位)?净值\s*[：:]\s*(\d+\.\d+)/)
      if (inlineCum) cum = parseFloat(inlineCum[1])

      if (UNIT_NAV_NAME_RE.test(label)) {
        for (let j = i + 1; j < Math.min(cells.length, i + 4); j++) {
          const n = parseNavNumber(cells[j])
          if (n != null && isPlausibleUnitNav(n)) {
            unit = n
            break
          }
        }
      }
      if (CUM_NAV_NAME_RE.test(label)) {
        for (let j = i + 1; j < Math.min(cells.length, i + 4); j++) {
          const n = parseNavNumber(cells[j])
          if (n != null && n > 0.05) {
            cum = n
            break
          }
        }
      }
    }
  }

  return { unit, cum, date }
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
    const headerScan = scanSheetHeaderNav(buffer)
    const analysis = parseValuationWorkbook(buffer, filename)
    const portfolioScan = scanPortfolioNav(analysis.portfolio_data)
    const shared = extractNavMetadata(subject, filename)

    const nav = headerScan.unit ?? portfolioScan.unit
    if (nav == null || !isPlausibleUnitNav(nav)) return null

    const navDate =
      headerScan.date ??
      (analysis.summary.valuation_date ? normaliseDate(analysis.summary.valuation_date) : null) ??
      subjectOrFilenameDate(subject, filename)

    if (!navDate) return null

    return {
      nav,
      navDate,
      cumulativeNav: headerScan.cum ?? portfolioScan.cum,
      productCode: shared.productCode,
      fundName: shared.fundName ?? analysis.summary.fund_name,
      source: "attachment_valuation_table",
    }
  } catch {
    return null
  }
}
