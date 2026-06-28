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
