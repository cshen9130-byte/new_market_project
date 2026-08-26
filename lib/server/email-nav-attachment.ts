/**
 * NAV extraction from 净值表 email attachments (.xls / .xlsx).
 * Reuses the nav-cleaner workbook parser for column detection and row parsing.
 */

import * as XLSX from "xlsx"
import {
  extractNavMetadata,
  normalizeFundDisplayName,
  type ExtractedNavData,
} from "@/lib/server/email-nav-extract"
import {
  extractSubjectUnitNavHint,
  isPlausibleEmailUnitNav,
} from "@/lib/server/email-nav-query"
import { analyzeNavWorkbook } from "@/lib/server/nav-cleaner"

export type NavTableAttachmentInfo = { filename: string; part: string }

const NAV_TABLE_SUBJECT_RE =
  /净值波动表|净值表|每日净值表|虚拟计提净值表|资产净值公告|净值公告|批量补发|【基金净值】|【净值公告】|【TA虚拟净值】|【虚拟净值】|TA虚拟净值|_虚拟净值_|虚拟净值提取|虚拟净值查询|虚拟净值数据|虚拟净值_20\d{6}|净值20\d{6}|净值\d{4}-\d{2}-\d{2}|^虚拟净值-|业绩报酬试算表/u
/** Manager DD packs: 代表性产品材料 + company.zip containing 历史净值序列. */
const PRODUCT_MATERIAL_SUBJECT_RE =
  /产品材料|代表性产品|净值序列|历史净值/u
const NAV_TABLE_FILENAME_RE =
  /净值波动表|净值表|每日净值|资产净值公告|净值公告|【基金净值】|【净值公告】|【TA虚拟净值】|【虚拟净值】|TA虚拟净值|_虚拟净值_|虚拟净值提取|虚拟净值查询|虚拟净值数据|虚拟净值_20\d{6}|净值20\d{6}|^虚拟净值-|业绩报酬试算|净值试算结果|试算结果/u
const NAV_TABLE_ZIP_FILENAME_RE =
  /资产净值|净值公告|批量补发|补发文件|信披报表|信报报表|净值波动表|净值表|净值序列|历史净值/i

/** Pure 业绩报酬 ledgers stay excluded; Xingye 业绩报酬试算表 / 试算结果 are NAV sources. */
function isExcludedNavAttachment(filename: string, subject = ""): boolean {
  if (/估值表|台账|份额明细|虚拟净值表现/i.test(filename)) return true
  if (!/业绩报酬/i.test(filename)) return false
  const blob = `${filename} ${subject}`
  return !/业绩报酬试算|净值试算结果|试算结果|试算表/i.test(blob)
}

export function isNavTableSubject(subject: string): boolean {
  return (
    (NAV_TABLE_SUBJECT_RE.test(subject) || PRODUCT_MATERIAL_SUBJECT_RE.test(subject))
    && !/估值表/u.test(subject)
  )
}

export function isNavTableAttachmentFilename(filename: string): boolean {
  if (/\.pdf$/i.test(filename)) {
    return /净值公告|资产净值公告/i.test(filename) && !/估值表/i.test(filename)
  }
  if (!/\.xlsx?$/i.test(filename)) return false
  if (/估值表/i.test(filename)) return false
  return NAV_TABLE_FILENAME_RE.test(filename)
}

/** Batch 补发 zips of 资产净值公告 spreadsheets (CSC 信报报表补发文件.zip). */
export function isNavTableZipFilename(filename: string, subject = ""): boolean {
  if (!/\.zip$/i.test(filename.trim())) return false
  if (isExcludedNavAttachment(filename, subject) && !NAV_TABLE_ZIP_FILENAME_RE.test(filename)) {
    return false
  }
  if (NAV_TABLE_ZIP_FILENAME_RE.test(filename)) return true
  return isNavTableSubject(subject)
}

/** Pick spreadsheet / batch-zip attachments that look like 净值表 files. */
export function selectNavTableAttachments(
  subject: string,
  attachments: NavTableAttachmentInfo[],
): NavTableAttachmentInfo[] {
  const zips = attachments.filter((a) => isNavTableZipFilename(a.filename, subject))
  const spreadsheets = attachments.filter(
    (a) => /\.xlsx?$/i.test(a.filename) && !isExcludedNavAttachment(a.filename, subject),
  )
  const pdfs = attachments.filter((a) => isNavTableAttachmentFilename(a.filename) && /\.pdf$/i.test(a.filename))
  const explicit = [
    ...spreadsheets.filter((a) => isNavTableAttachmentFilename(a.filename)),
    ...pdfs,
  ]
  if (explicit.length > 0 || zips.length > 0) return [...explicit, ...zips]
  if (
    isNavTableSubject(subject)
    || /^虚拟净值-/u.test(subject)
    || /【虚拟净值】/.test(subject)
    || /TA虚拟净值/u.test(subject)
    || /_虚拟净值_/u.test(subject)
    || /虚拟净值提取|虚拟净值查询|虚拟净值数据/u.test(subject)
  ) {
    return [
      ...spreadsheets.filter((a) => !/虚拟净值表现/i.test(a.filename)),
      ...zips,
    ]
  }
  return []
}

/**
 * CSC/中信建投 single-fund 资产净值公告 form (label/value, not a table):
 *   2026-08-05
 *   基金代码： SVP460
 *   基金名称： 墨雪鑫瑞1号…
 *   基金份额累计净值： 3.7647
 *   (optional 基金份额净值)
 */
function extractCscAssetNavFormFromBuffer(
  buffer: Buffer,
  filename: string,
  subject: string,
): ExtractedNavData | null {
  if (!/资产净值公告/u.test(`${filename}\n${subject}`)) return null
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false })
    const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]
    if (!sheet) return null
    const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    })
    const cells = rows.flatMap((row) =>
      (Array.isArray(row) ? row : []).map((c) => String(c ?? "").trim()),
    )
    const blob = cells.join("\n")

    let productCode: string | null = null
    let fundName: string | null = null
    let unitNav: number | null = null
    let cumulativeNav: number | null = null
    let navDate: string | null = null

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] ?? ""
      const next = cells[i + 1] ?? ""
      const codeM = cell.match(/^基金代码\s*[：:]\s*([A-Z0-9]+)?$/u)
      if (codeM) productCode = (codeM[1] || next).trim().toUpperCase() || productCode
      const nameM = cell.match(/^基金名称\s*[：:]\s*(.*)$/u)
      if (nameM) {
        const inline = nameM[1].trim()
        fundName = normalizeFundDisplayName(inline || next)
      }
      const unitM = cell.match(/^基金份额净值\s*[：:]\s*(\d+\.\d+)?$/u)
      if (unitM) {
        const raw = unitM[1] || next
        const n = parseFloat(String(raw).replace(/,/g, ""))
        if (Number.isFinite(n) && n > 0) unitNav = n
      }
      const cumM = cell.match(/^基金份额累计净值\s*[：:]\s*(\d+\.\d+)?$/u)
      if (cumM) {
        const raw = cumM[1] || next
        const n = parseFloat(String(raw).replace(/,/g, ""))
        if (Number.isFinite(n) && n > 0) cumulativeNav = n
      }
      if (!navDate) {
        const iso = cell.match(/^(20\d{2}-\d{2}-\d{2})$/)
        if (iso) navDate = iso[1]
        else {
          const asOf = cell.match(/截至\s*(20\d{2}-\d{2}-\d{2})/u)
          if (asOf) navDate = asOf[1]
        }
      }
    }

    if (!navDate) {
      const fromFile = filename.match(/(20\d{6})(?:\.\w+)?$/i)
      if (fromFile) {
        const s = fromFile[1]
        navDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      }
    }
    if (!navDate) {
      const fromSubj = subject.match(/(20\d{6}).{0,40}资产净值公告/u)
      if (fromSubj) {
        const s = fromSubj[1]
        navDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      }
    }

    const meta = extractNavMetadata(subject, `${filename}\n${blob}`)
    productCode = productCode || meta.productCode
    fundName = fundName || meta.fundName

    // Form often publishes only 累计净值; for undivided funds unit ≈ cum.
    if (unitNav == null && cumulativeNav != null) unitNav = cumulativeNav
    if (cumulativeNav == null && unitNav != null) cumulativeNav = unitNav
    if (!navDate || unitNav == null || unitNav <= 0) return null

    return {
      nav: unitNav,
      navDate,
      cumulativeNav,
      adjustedNav: null,
      productCode,
      fundName,
      source: "attachment_nav_table",
    }
  } catch {
    return null
  }
}

/**
 * Citics 资产净值公告 PDF / text:
 *   截至2021-02-10,以下基金资产净值如下：
 *   基金名称 协会代码 基金资产净值 基金资产份额 基金份额净值 基金份额累计净值
 *   量锐28号私募证券投资基金 SGC823 97,427,057.48 90,804,317.72 1.0729 1.0729
 * Later PDFs add share classes: SGC823(总) / SGC823(A类) / T07895(B类).
 */
export function extractNavRowsFromCiticsAnnouncementText(
  text: string,
  filename: string,
  subject: string,
): ExtractedNavData[] {
  const blob = `${filename}\n${subject}\n${text}`
  if (!/净值公告|资产净值公告/u.test(blob)) return []

  const asOf = text.match(/截至\s*(20\d{2}-\d{2}-\d{2})/u)
  let navDate = asOf?.[1] ?? null
  if (!navDate) {
    const compact = filename.match(/(20\d{6})(?:\.\w+)?$/i)
    if (compact) {
      const s = compact[1]
      navDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
  }
  if (!navDate) return []

  const meta = extractNavMetadata(subject, `${filename}\n${text}`)
  const rowRe =
    /([^\n\t]+?)\s+([A-Z0-9]{4,10})(?:\((总|[ABC]类)\))?\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+(\d+\.\d{2,8})\s+(\d+\.\d{2,8})/gu
  const parsed: {
    rawName: string
    baseCode: string
    share: string
    unitNav: number
    cumulativeNav: number
  }[] = []
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(text)) !== null) {
    const rawName = match[1].replace(/基金名称|协会代码/g, "").trim()
    if (!rawName || /基金管理人|托管人|声明/.test(rawName)) continue
    const unitNav = parseFloat(match[6])
    const cumulativeNav = parseFloat(match[7])
    if (!Number.isFinite(unitNav) || unitNav <= 0) continue
    parsed.push({
      rawName,
      baseCode: match[2].trim().toUpperCase(),
      share: (match[3] ?? "").trim(),
      unitNav,
      cumulativeNav: Number.isFinite(cumulativeNav) ? cumulativeNav : unitNav,
    })
  }

  const parentCode = parsed.find((row) => row.share === "总")?.baseCode ?? null
  const rows: ExtractedNavData[] = []
  for (const row of parsed) {
    let productCode = row.baseCode
    if (row.share === "A类" && parentCode && row.baseCode === parentCode) productCode = `${row.baseCode}A`
    else if (row.share === "B类" && parentCode && row.baseCode === parentCode) productCode = `${row.baseCode}B`
    else if (row.share === "C类" && parentCode && row.baseCode === parentCode) productCode = `${row.baseCode}C`

    rows.push({
      nav: row.unitNav,
      navDate,
      cumulativeNav: row.cumulativeNav,
      adjustedNav: null,
      productCode: productCode || meta.productCode,
      fundName: normalizeFundDisplayName(row.rawName) || meta.fundName || null,
      source: "attachment_nav_table",
    })
  }
  return rows
}

export function extractNavFromCiticsAnnouncementText(
  text: string,
  filename: string,
  subject: string,
): ExtractedNavData | null {
  const rows = extractNavRowsFromCiticsAnnouncementText(text, filename, subject)
  if (rows.length === 0) return null
  const parent = rows.find((row) => row.productCode && !/[ABC]$/i.test(row.productCode))
  return parent ?? rows[0] ?? null
}

export async function extractNavFromCiticsAnnouncementPdf(
  buffer: Buffer,
  filename: string,
  subject: string,
): Promise<ExtractedNavData[]> {
  const { readPdfTextWithCmaps } = await import("@/lib/server/pdf-text")
  const text = await readPdfTextWithCmaps(buffer)
  return extractNavRowsFromCiticsAnnouncementText(text, filename, subject)
}

/** Parse all historical NAV rows from a 净值表 workbook buffer. */
export function extractNavTableFromBuffer(
  buffer: Buffer,
  filename: string,
  subject: string,
): ExtractedNavData[] {
  try {
    const analysis = analyzeNavWorkbook(buffer, filename)
    const { productCode: subjectCode, fundName: subjectFundName } = extractNavMetadata(
      subject,
      filename,
    )
    const subjectCodeNorm = subjectCode?.trim().toUpperCase() || null

    const rows = analysis.rows.map((row) => {
      let unitNav = row.unitNav
      if (!isPlausibleEmailUnitNav(unitNav, row.cumulativeNav)) {
        const hinted = extractSubjectUnitNavHint(subject)
        if (hinted != null) unitNav = hinted
      }
      const rowCode = (row.productCode ?? "").trim().toUpperCase() || null
      const rowFundName = row.fundName?.trim()
        ? normalizeFundDisplayName(row.fundName)
        : null
      // Prefer per-row identity from the workbook; subject is only a fallback.
      // CSC 虚拟净值提取 subjects put the FOF/investor second — a wrong subjectFundName
      // must not override the underlying name from the xlsx row (SCU622 bleed).
      const productCode = rowCode || subjectCodeNorm
      const fundName =
        rowCode && subjectCodeNorm && rowCode !== subjectCodeNorm
          ? rowFundName || null
          : rowFundName || subjectFundName || null
      return {
        nav: unitNav,
        navDate: row.date,
        cumulativeNav: row.cumulativeNav,
        adjustedNav: row.adjustedNav,
        productCode,
        fundName,
        source: "attachment_nav_table" as const,
      }
    })
    if (rows.length > 0) return rows
  } catch {
    // fall through to CSC label/value 资产净值公告 form
  }
  const formRow = extractCscAssetNavFormFromBuffer(buffer, filename, subject)
  return formRow ? [formRow] : []
}
