/**
 * Expand 估值表 batch .zip attachments into individual spreadsheet buffers.
 */
import AdmZip from "adm-zip"

export type ZipSpreadsheetEntry = {
  /** Path inside the archive, e.g. folder/file.xls */
  entryName: string
  /** Basename used for parsing, e.g. file.xls */
  filename: string
  buffer: Buffer
}

/** Stored on valuation rows to re-download a file inside a zip batch. */
export function zipInnerAttachmentKey(archiveFilename: string, innerFilename: string): string {
  return `${archiveFilename.trim()}::${innerFilename.trim()}`
}

export function parseZipInnerAttachmentKey(stored: string): { archive: string; inner: string } | null {
  const idx = stored.indexOf("::")
  if (idx <= 0) return null
  const archive = stored.slice(0, idx).trim()
  const inner = stored.slice(idx + 2).trim()
  if (!archive || !inner) return null
  return { archive, inner }
}

export function isValuationZipFilename(filename: string): boolean {
  return /\.zip$/i.test(filename.trim())
}

export function expandValuationZipBuffer(buffer: Buffer, archiveFilename: string): ZipSpreadsheetEntry[] {
  const zip = new AdmZip(buffer)
  const out: ZipSpreadsheetEntry[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!/\.xlsx?$/i.test(entry.entryName)) continue
    const filename = entry.entryName.split(/[/\\]/).pop() ?? entry.entryName
    out.push({
      entryName: entry.entryName,
      filename,
      buffer: entry.getData(),
    })
  }
  if (out.length === 0 && archiveFilename) {
    // Some archives use a single nested folder; adm-zip already flattens entry names.
  }
  return out
}

/** Prefer 历史净值 / NAV workbooks inside a manager 产品材料 / 尽调材料 zip. */
export function preferNavHistoryZipEntries(entries: ZipSpreadsheetEntry[]): ZipSpreadsheetEntry[] {
  const blob = (e: ZipSpreadsheetEntry) => `${e.entryName}\n${e.filename}`
  const preferred = entries.filter((e) => /净值|nav/i.test(blob(e)))
  if (preferred.length > 0) return preferred
  // Do not fall back to 要素表 / 合同 / 公司介绍 when the pack has no NAV sheets.
  return entries.filter((e) => !/要素表|产品要素|一页通|基金合同|产品合同|公司介绍|公司简介/.test(blob(e)))
}

/** Citics 【净值公告】 zips pack weekly 资产净值公告 PDFs (and occasionally xlsx). */
export function expandNavTableZipBuffer(buffer: Buffer, archiveFilename: string): ZipSpreadsheetEntry[] {
  const sheets = expandValuationZipBuffer(buffer, archiveFilename)
  const zip = new AdmZip(buffer)
  const pdfs: ZipSpreadsheetEntry[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!/\.pdf$/i.test(entry.entryName)) continue
    const filename = entry.entryName.split(/[/\\]/).pop() ?? entry.entryName
    if (!/净值公告|资产净值公告|净值序列|历史净值/i.test(`${archiveFilename}\n${filename}`)) continue
    pdfs.push({
      entryName: entry.entryName,
      filename,
      buffer: entry.getData(),
    })
  }
  return preferNavHistoryZipEntries([...sheets, ...pdfs])
}

export function extractSpreadsheetFromZipBuffer(
  zipBuffer: Buffer,
  innerFilename: string,
): { buffer: Buffer; filename: string } | null {
  const target = innerFilename.trim().toLowerCase()
  if (!target) return null
  const zip = new AdmZip(zipBuffer)
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const base = (entry.entryName.split(/[/\\]/).pop() ?? entry.entryName).toLowerCase()
    if (base !== target && !entry.entryName.toLowerCase().endsWith(target)) continue
    if (!/\.xlsx?$/i.test(entry.entryName)) continue
    return { buffer: entry.getData(), filename: entry.entryName.split(/[/\\]/).pop() ?? entry.entryName }
  }
  return null
}
