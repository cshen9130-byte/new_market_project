/**
 * NAV extraction from 净值表 email attachments (.xls / .xlsx).
 * Reuses the nav-cleaner workbook parser for column detection and row parsing.
 */

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
  /净值波动表|净值表|每日净值表|虚拟计提净值表|资产净值公告|批量补发|【基金净值】|【TA虚拟净值】|【虚拟净值】|TA虚拟净值|_虚拟净值_|虚拟净值_20\d{6}|净值20\d{6}|净值\d{4}-\d{2}-\d{2}|^虚拟净值-|业绩报酬试算表/u
const NAV_TABLE_FILENAME_RE =
  /净值波动表|净值表|每日净值|资产净值公告|【基金净值】|【TA虚拟净值】|【虚拟净值】|TA虚拟净值|_虚拟净值_|虚拟净值_20\d{6}|净值20\d{6}|^虚拟净值-|业绩报酬试算|净值试算结果|试算结果/u
const NAV_TABLE_ZIP_FILENAME_RE =
  /资产净值|净值公告|批量补发|补发文件|信披报表|信报报表|净值波动表|净值表/i

/** Pure 业绩报酬 ledgers stay excluded; Xingye 业绩报酬试算表 / 试算结果 are NAV sources. */
function isExcludedNavAttachment(filename: string, subject = ""): boolean {
  if (/估值表|台账|份额明细|虚拟净值表现/i.test(filename)) return true
  if (!/业绩报酬/i.test(filename)) return false
  const blob = `${filename} ${subject}`
  return !/业绩报酬试算|净值试算结果|试算结果|试算表/i.test(blob)
}

export function isNavTableSubject(subject: string): boolean {
  return NAV_TABLE_SUBJECT_RE.test(subject) && !/估值表/u.test(subject)
}

export function isNavTableAttachmentFilename(filename: string): boolean {
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
  const explicit = spreadsheets.filter((a) => isNavTableAttachmentFilename(a.filename))
  if (explicit.length > 0 || zips.length > 0) return [...explicit, ...zips]
  if (
    isNavTableSubject(subject)
    || /^虚拟净值-/u.test(subject)
    || /【虚拟净值】/.test(subject)
    || /TA虚拟净值/u.test(subject)
    || /_虚拟净值_/u.test(subject)
  ) {
    return [
      ...spreadsheets.filter((a) => !/虚拟净值表现/i.test(a.filename)),
      ...zips,
    ]
  }
  return []
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

    return analysis.rows.map((row) => {
      let unitNav = row.unitNav
      if (!isPlausibleEmailUnitNav(unitNav, row.cumulativeNav)) {
        const hinted = extractSubjectUnitNavHint(subject)
        if (hinted != null) unitNav = hinted
      }
      const rowCode = (row.productCode ?? "").trim().toUpperCase() || null
      const rowFundName = row.fundName?.trim()
        ? normalizeFundDisplayName(row.fundName)
        : null
      // Prefer per-row identity from multi-product CMS 每日净值表.xls; subject is only a fallback.
      const productCode = rowCode || subjectCodeNorm
      const fundName =
        rowCode && subjectCodeNorm && rowCode !== subjectCodeNorm
          ? rowFundName || null
          : subjectFundName || rowFundName || null
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
  } catch {
    return []
  }
}
