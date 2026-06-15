/**
 * NAV extraction from 净值表 email attachments (.xls / .xlsx).
 * Reuses the nav-cleaner workbook parser for column detection and row parsing.
 */

import {
  extractNavMetadata,
  type ExtractedNavData,
} from "@/lib/server/email-nav-extract"
import { analyzeNavWorkbook } from "@/lib/server/nav-cleaner"

export type NavTableAttachmentInfo = { filename: string; part: string }

const NAV_TABLE_SUBJECT_RE = /净值表|每日净值表|虚拟计提净值表/u
const NAV_TABLE_FILENAME_RE = /净值表|每日净值/u
const EXCLUDE_ATTACHMENT_RE = /估值表|台账|份额明细|业绩报酬|虚拟净值表现/i

export function isNavTableSubject(subject: string): boolean {
  return NAV_TABLE_SUBJECT_RE.test(subject) && !/估值表/u.test(subject)
}

export function isNavTableAttachmentFilename(filename: string): boolean {
  if (!/\.xlsx?$/i.test(filename)) return false
  if (/估值表/i.test(filename)) return false
  return NAV_TABLE_FILENAME_RE.test(filename)
}

/** Pick spreadsheet attachments that look like 净值表 files. */
export function selectNavTableAttachments(
  subject: string,
  attachments: NavTableAttachmentInfo[],
): NavTableAttachmentInfo[] {
  const spreadsheets = attachments.filter(
    (a) => /\.xlsx?$/i.test(a.filename) && !EXCLUDE_ATTACHMENT_RE.test(a.filename),
  )
  const explicit = spreadsheets.filter((a) => isNavTableAttachmentFilename(a.filename))
  if (explicit.length > 0) return explicit
  if (isNavTableSubject(subject)) {
    return spreadsheets.filter((a) => !/虚拟净值/i.test(a.filename))
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
    const { productCode, fundName } = extractNavMetadata(subject, filename)

    return analysis.rows.map((row) => ({
      nav: row.unitNav,
      navDate: row.date,
      cumulativeNav: row.cumulativeNav,
      productCode,
      fundName,
      source: "attachment_nav_table" as const,
    }))
  } catch {
    return []
  }
}
