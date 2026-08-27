/**
 * 估值表 extraction from email attachments (.xls / .xlsx) and inline HTML/text tables.
 */

import * as XLSX from "xlsx"
import {
  extractNavMetadata,
  type ExtractedNavData,
} from "@/lib/server/email-nav-extract"
import { expandWorksheetUsedRange } from "@/lib/server/nav-cleaner"
import {
  parseValuationRows,
  parseValuationWorkbook,
  type ValuationAnalysis,
  type ValuationRow,
} from "@/lib/server/valuation-analyzer"
import {
  enrichValuationMetrics,
  type FofUnderlyingMetric,
} from "@/lib/server/email-valuation-metrics"
import { resolveCustodianFromValuationRecord } from "@/lib/server/email-valuation-custodian"

export type ValuationAttachmentInfo = { filename: string; part: string }

export type ExtractedValuationData = {
  analysis: ValuationAnalysis
  productCode: string | null
  fundName: string | null
  valuationDate: string
  unitNav: number | null
  cumulativeNav: number | null
  custodyBalance: number | null
  netAssetValue: number | null
  paidInCapital: number | null
  totalAsset: number | null
  totalLiability: number | null
  custodian: string | null
  underlyingHoldings: FofUnderlyingMetric[]
  holdingsCount: number
  source: "attachment_valuation_table" | "body_html_table"
}

const VALUATION_FILENAME_RE = /估值表|估值|专用表/i
const EXCLUDE_VALUATION_RE = /净值波动表|净值表|净值公告|资产净值公告|台账|份额明细|业绩报酬|虚拟净值表现/i
const VALUATION_ZIP_RE = /\.zip$/i

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

/** Prior-day NAV labels on CMS/招商 估值表 — must not overwrite today's 单位净值. */
function isPriorDayUnitNavLabel(name: string): boolean {
  return /昨日|上日|前一|上一|前天/.test(name)
}

function isUnitNavLabel(name: string): boolean {
  const n = normalizeName(name)
  if (!n || /累计/.test(n) || isPriorDayUnitNavLabel(n)) return false
  return /^(单位净值|今日单位净值|基金份额净值|基金单位净值|份额净值|基金净值)$/.test(n)
    || (/单位净值/.test(n) && !/累计/.test(n) && !isPriorDayUnitNavLabel(n))
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

/** Custody 估值表 emails embed a batch/send date in subject or filename (not always the NAV date). */
export function isCustodySendDateValuationSubject(subject: string, filename: string): boolean {
  const text = `${subject}\0${filename}`
  if (/估值表_(20\d{6})/u.test(text)) return true
  if (/_20\d{6}_估值表/u.test(text)) return true
  // 国泰海通: SAVW72_金舆基石一号…_20260615估值表
  if (/_(20\d{6})估值表/u.test(text)) return true
  return false
}

/** Guotai subjects encode the valuation/NAV date as `_YYYYMMDD估值表`. */
export function isGuotaiValuationSubject(subject: string, filename: string): boolean {
  return /_(20\d{6})估值表/u.test(`${subject}\0${filename}`)
}

/** 华泰 产品估值表_日报 / CODE_NAME估值表YYYYMMDD — filename date is the NAV date. */
export function isHuataiDailyValuationSubject(subject: string, filename: string): boolean {
  const text = `${subject}\0${filename}`
  return /产品估值表_日报_(20\d{6})/u.test(text)
    || /私募证券投资基金估值表(20\d{6})/u.test(text)
}

function valuationSubjectSendDate(subject: string, filename: string): string | null {
  const text = `${subject}${filename}`
  const huataiDaily = text.match(/产品估值表_日报_(20\d{6})/u)
  if (huataiDaily) return normaliseDate(huataiDaily[1])
  const afterTable = text.match(/估值表_(20\d{6})/u)
  if (afterTable) return normaliseDate(afterTable[1])
  const beforeTable = text.match(/_(20\d{6})_估值表/u)
  if (beforeTable) return normaliseDate(beforeTable[1])
  const guotai = text.match(/_(20\d{6})估值表/u)
  if (guotai) return normaliseDate(guotai[1])
  const glued = text.match(/估值表(20\d{6})/u)
  if (glued) return normaliseDate(glued[1])
  return subjectOrFilenameDate(subject, filename)
}

function calendarDaysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`)
  const tb = Date.parse(`${b}T12:00:00Z`)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((ta - tb) / 86_400_000))
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

function formatLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`
}

function parseHeaderDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalIsoDate(value)
  }
  const text = String(value ?? "").trim()
  if (!text) return null
  return normaliseDate(text)
}

function extractValuationDateFromHeaderRow(row: unknown[]): string | null {
  const cells = (row ?? []).map((cell) => String(cell ?? "").trim())
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    // Prefer 估值日期/净值日期 only — bare「日期」matches holdings labels like「到期日」.
    const inline = cell.match(/(?:估值日期|净值日期)\s*[：:]\s*(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})/)
    if (inline) {
      const parsed = normaliseDate(inline[1])
      if (parsed) return parsed
    }

    const label = cell.replace(/[\s\u3000:：]/g, "")
    if (/^(估值日期|净值日期)$/.test(label)) {
      for (let j = i + 1; j < Math.min(i + 4, (row ?? []).length); j += 1) {
        const parsed = parseHeaderDateValue((row ?? [])[j])
        if (parsed) return parsed
      }
    }
  }
  return null
}

function scanRowsForNav(rows: unknown[][]): { unit: number | null; cum: number | null; date: string | null } {
  let unit: number | null = null
  let cum: number | null = null
  let date: string | null = null
  // Header inline「单位净值：x.xxxx」is ground truth for CMS/招商. Do not let later
  // 昨日单位净值 / holdings cells overwrite it (last-wins caused a 1-day NAV shift).
  let unitLockedFromHeader = false

  // Date lives in the workbook header; scanning deep into holdings rewrites it with 到期日 etc.
  for (let rowIdx = 0; rowIdx < Math.min(rows.length, 120); rowIdx += 1) {
    const row = rows[rowIdx]
    const cells = (row ?? []).map((cell) => String(cell ?? "").trim())
    const joined = cells.join(" ")
    const inHeaderZone = rowIdx < 15

    if (!date) {
      const headerDate = extractValuationDateFromHeaderRow(row ?? [])
      if (headerDate) date = headerDate
      const dateMatch = joined.match(/(?:估值日期|净值日期)\s*[：:]\s*(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})/)
      if (dateMatch) {
        const parsed = normaliseDate(dateMatch[1])
        if (parsed) date = parsed
      }
    }

    // Skip prior-day NAV labels entirely (昨日单位净值 / 上日单位净值).
    if (!isPriorDayUnitNavLabel(joined)) {
      const joinedUnit = joined.match(/(?:^|[^累计])单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
      if (joinedUnit && (!unitLockedFromHeader || inHeaderZone)) {
        const n = parseFloat(joinedUnit[1])
        if (isPlausibleUnitNav(n)) {
          unit = n
          if (inHeaderZone) unitLockedFromHeader = true
        }
      }
    }
    const joinedCum = joined.match(/累计(?:单位)?净值\s*[：:]\s*(\d+\.\d{3,8})/)
    if (joinedCum) {
      const n = parseFloat(joinedCum[1])
      if (n > 0.05) cum = n
    }

    // Once header inline 单位净值 is locked, ignore body「单位净值」subject rows
    // (CMS often repeats the prior close under that label below the holdings).
    if (unitLockedFromHeader) continue

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (isPriorDayUnitNavLabel(cell)) continue
      const label = normalizeName(cell)
      // Inline「单位净值:0.9884」already handled above; do not let adjacent cells overwrite.
      if (/单位净值\s*[：:]\s*\d+\.\d{3,8}/.test(cell) && !/累计/.test(cell)) continue
      if (isUnitNavLabel(label) || (/单位净值/.test(cell) && !/累计/.test(cell))) {
        const n = firstPlausibleNavInCells(cells, i + 1)
        if (n != null) unit = n
      }
      if (isCumNavLabel(label) || (/累计/.test(cell) && /净值/.test(cell))) {
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
    const sheet = workbook.Sheets[sheetName]
    expandWorksheetUsedRange(sheet)
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
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

/** 国信 subjects omit 备案号; zip inner files are `SCP742…估值表20260825.xlsx`. */
function mergeValuationNavMetadata(subject: string, filename: string) {
  const fromSubject = extractNavMetadata(subject, "")
  if (fromSubject.productCode) return fromSubject
  if (!filename.trim()) return fromSubject
  const fromFile = extractNavMetadata(filename, "")
  return {
    productCode: fromFile.productCode,
    fundName: fromSubject.fundName ?? fromFile.fundName,
  }
}

function countMeaningfulHoldings(rows: ValuationRow[]): number {
  const detail = rows.filter((row) => row.include_in_detail)
  if (detail.length > 0) return detail.length
  return rows.filter((row) => {
    const code = String(row.code ?? "")
    const name = String(row.name ?? "")
    return code && name && !/合计|小计|总计|单位净值|资产净值/.test(name)
  }).length
}

function previousChinaTradingDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  const cur = new Date(y, m - 1, d)
  for (let i = 0; i < 10; i += 1) {
    cur.setDate(cur.getDate() - 1)
    const next = formatLocalIsoDate(cur)
    const weekday = cur.getDay()
    if (weekday !== 0 && weekday !== 6) return next
  }
  return formatLocalIsoDate(cur)
}

function resolveValuationTableNavDate(
  subject: string,
  filename: string,
  headerDate: string | null,
  summaryDate: string | null,
): string | null {
  const subjectDate = valuationSubjectSendDate(subject, filename)
  const header = headerDate ? normaliseDate(headerDate) : null
  const summary = summaryDate ? normaliseDate(summaryDate) : null
  const custodySend = subjectDate != null && isCustodySendDateValuationSubject(subject, filename)
  const guotai = subjectDate != null && isGuotaiValuationSubject(subject, filename)
  const huataiDaily = subjectDate != null && isHuataiDailyValuationSubject(subject, filename)

  // 国泰海通 `_YYYYMMDD估值表` / 华泰 `产品估值表_日报_YYYYMMDD` — subject date is
  // the valuation/NAV date. Reject header false positives (e.g. holdings「到期日」)
  // that land far earlier.
  if ((guotai || huataiDaily) && subjectDate) {
    if (header && calendarDaysBetween(header, subjectDate) <= 1) return header
    if (summary && calendarDaysBetween(summary, subjectDate) <= 1) return summary
    return subjectDate
  }

  if (header && (!subjectDate || header !== subjectDate)) return header
  if (summary && (!subjectDate || summary !== subjectDate)) return summary
  if (custodySend && subjectDate) {
    // Guohai / GTJA 4级科目估值表_YYYYMMDD: filename date is the NAV date when the
    // workbook header agrees. Only shift back one trading day when header is absent
    // (legacy custodians that embed send-date in the filename).
    if (header === subjectDate || summary === subjectDate) return subjectDate
    if (header) return header
    if (summary) return summary
    return previousChinaTradingDay(subjectDate)
  }
  return header ?? summary ?? subjectDate
}

function isSuccessfulValuation(analysis: ValuationAnalysis): boolean {
  const holdingsCount = countMeaningfulHoldings(analysis.portfolio_data)
  if (holdingsCount >= 3) return true
  if (analysis.summary.nav > 0 || analysis.summary.total_asset > 0) return true
  return holdingsCount > 0
}

function buildExtractedValuation(
  analysis: ValuationAnalysis,
  subject: string,
  filename: string,
  source: ExtractedValuationData["source"],
  headerScanDate: string | null = null,
  senderEmail: string | null = null,
  bodyText: string | null = null,
  headerScanUnit: number | null = null,
): ExtractedValuationData | null {
  if (!isSuccessfulValuation(analysis)) return null

  const { summary: enriched, underlyingHoldings } = enrichValuationMetrics(analysis)
  analysis = { ...analysis, summary: enriched }

  const shared = mergeValuationNavMetadata(subject, filename)
  const portfolioScan = scanPortfolioNav(analysis.portfolio_data)

  const valuationDate = resolveValuationTableNavDate(
    subject,
    filename,
    headerScanDate,
    enriched.valuation_date || null,
  )

  if (!valuationDate) return null

  // Prefer workbook header 单位净值 — same source we trust in repair scripts.
  // Do not leave unit_nav null when the header has a plausible value (backfill
  // only copies non-null unit_nav into ops_email_nav_records).
  const unitNav =
    (headerScanUnit != null && isPlausibleUnitNav(headerScanUnit) ? headerScanUnit : null)
    ?? (enriched.unit_nav > 0 ? enriched.unit_nav : null)
    ?? portfolioScan.unit
    ?? (enriched.nav > 0 && isPlausibleUnitNav(enriched.nav) ? enriched.nav : null)

  const netAssetValue =
    enriched.net_asset_value > 0
      ? enriched.net_asset_value
      : enriched.total_asset && enriched.total_liability
        ? enriched.total_asset - enriched.total_liability
        : null

  const fundName =
    shared.fundName ??
    (enriched.fund_name && enriched.fund_name !== "未知基金" ? enriched.fund_name : null)

  const paidInCapital =
    enriched.paid_in_capital > 0
      ? enriched.paid_in_capital
      : netAssetValue != null && unitNav != null && unitNav > 0.05
        ? netAssetValue / unitNav
        : null

  const custodian = resolveCustodianFromValuationRecord({
    custodian: enriched.custodian ?? analysis.summary.custodian,
    summaryCustodian: enriched.custodian ?? analysis.summary.custodian,
    senderEmail,
    subject,
    attachmentFilename: filename,
    bodyText,
  })
  analysis = {
    ...analysis,
    summary: {
      ...analysis.summary,
      custodian,
      ...(unitNav != null ? { unit_nav: unitNav } : {}),
    },
  }

  return {
    analysis,
    productCode: shared.productCode,
    fundName,
    valuationDate,
    unitNav,
    cumulativeNav: portfolioScan.cum,
    custodyBalance: enriched.custody_balance > 0 ? enriched.custody_balance : null,
    netAssetValue,
    paidInCapital,
    totalAsset: enriched.total_asset > 0 ? enriched.total_asset : null,
    totalLiability: enriched.total_liability > 0 ? enriched.total_liability : null,
    custodian,
    underlyingHoldings,
    holdingsCount: countMeaningfulHoldings(analysis.portfolio_data),
    source,
  }
}

/** Parse plain-text / HTML-stripped table rows embedded in email body. */
export function extractValuationFromEmailBody(
  bodyText: string,
  subject: string,
  senderEmail: string | null = null,
): ExtractedValuationData | null {
  if (!/估值表|估值/i.test(subject) && !/科目代码/.test(bodyText)) return null

  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const headerIdx = lines.findIndex((line) =>
    /科目代码/.test(line) && /科目名称|名称/.test(line),
  )
  if (headerIdx < 0) return null

  const rows: unknown[][] = lines.slice(headerIdx).map((line) => {
    if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim())
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((cell) => cell.trim())
    return line.split(/\s+/).map((cell) => cell.trim())
  })

  if (rows.length < 4) return null

  try {
    const analysis = parseValuationRows(rows, subject)
    return buildExtractedValuation(analysis, subject, "", "body_html_table", null, senderEmail, bodyText)
  } catch {
    return null
  }
}

export function isValuationAttachmentFilename(filename: string): boolean {
  if (VALUATION_ZIP_RE.test(filename)) {
    return VALUATION_FILENAME_RE.test(filename)
  }
  if (!/\.xlsx?$/i.test(filename)) return false
  if (EXCLUDE_VALUATION_RE.test(filename)) return false
  return VALUATION_FILENAME_RE.test(filename)
}

/** Pick spreadsheet / batch zip attachments that look like 估值表 files. */
export function selectValuationAttachments(
  subject: string,
  attachments: ValuationAttachmentInfo[],
): ValuationAttachmentInfo[] {
  const valuationSubject = /估值表|估值/i.test(subject)
  const zips = attachments.filter(
    (a) => VALUATION_ZIP_RE.test(a.filename) && !EXCLUDE_VALUATION_RE.test(a.filename),
  )
  if (valuationSubject && zips.length > 0) return zips

  const spreadsheets = attachments.filter(
    (a) => /\.xlsx?$/i.test(a.filename) && !EXCLUDE_VALUATION_RE.test(a.filename),
  )
  const explicit = spreadsheets.filter((a) => isValuationAttachmentFilename(a.filename))
  if (explicit.length > 0) return explicit
  if (valuationSubject) {
    return spreadsheets.filter((a) => !/净值波动表|净值表|每日净值|资产净值公告|净值公告/i.test(a.filename))
  }
  return []
}

/** Parse full 估值表 structure from a workbook buffer. */
export function extractValuationFromBuffer(
  buffer: Buffer,
  filename: string,
  subject: string,
  senderEmail: string | null = null,
): ExtractedValuationData | null {
  try {
    const headerScan = scanWorkbookNav(buffer)
    const analysis = parseValuationWorkbook(buffer, filename)
    return buildExtractedValuation(
      analysis,
      subject,
      filename,
      "attachment_valuation_table",
      headerScan.date,
      senderEmail,
      null,
      headerScan.unit,
    )
  } catch {
    return null
  }
}

/** Parse unit NAV from a 估值表 workbook buffer (NAV fallback). */
export function extractNavFromValuationBuffer(
  buffer: Buffer,
  filename: string,
  subject: string,
): ExtractedNavData | null {
  try {
    const full = extractValuationFromBuffer(buffer, filename, subject)
    if (full?.unitNav != null) {
      return {
        nav: full.unitNav,
        navDate: full.valuationDate,
        cumulativeNav: full.cumulativeNav,
        productCode: full.productCode,
        fundName: full.fundName,
        source: "attachment_valuation_table",
      }
    }

    const headerScan = scanWorkbookNav(buffer)
    const analysis = parseValuationWorkbook(buffer, filename)
    const portfolioScan = scanPortfolioNav(analysis.portfolio_data)
    const shared = mergeValuationNavMetadata(subject, filename)

    const nav = headerScan.unit ?? portfolioScan.unit
    if (nav == null || !isPlausibleUnitNav(nav)) return null

    const navDate = resolveValuationTableNavDate(
      subject,
      filename,
      headerScan.date,
      analysis.summary.valuation_date || null,
    )

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
