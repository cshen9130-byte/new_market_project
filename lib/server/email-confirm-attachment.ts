/**
 * Select email attachments that look like broker 确认单 / 确认函.
 * TA often sends the PDF inside a .zip on a 「确认单」 subject.
 */

import AdmZip from "adm-zip"

export type ConfirmAttachmentInfo = { filename: string; part: string }

export type ConfirmZipInner = {
  filename: string
  buffer: Buffer
}

export const CONFIRM_SUBJECT_RE =
  /确认单|确认函|交易确认|成交确认|申购确认|赎回确认|认购确认|基金成立|Transaction\s*Confirm|TA确认单/iu

export const CONFIRM_FILENAME_RE =
  /确认单|确认函|交易确认|成交确认|申购确认|赎回确认|认购确认|基金成立|Transaction\s*Confirm/iu

const CONFIRM_FILE_EXT_RE = /\.(pdf|png|jpe?g|gif|webp|bmp|xlsx?|docx?)$/i
const CONFIRM_EXT_RE = /\.(pdf|png|jpe?g|gif|webp|bmp|xlsx?|docx?|zip)$/i

function isValuationNoiseName(name: string): boolean {
  return /估值表|净值表|净值波动|台账|份额明细|投资者明细|持有人明细|业绩报酬试算/i.test(name)
}

export function isConfirmSubject(subject: string): boolean {
  return CONFIRM_SUBJECT_RE.test(subject || "")
}

export function isConfirmAttachmentFilename(filename: string): boolean {
  const name = (filename || "").trim()
  if (!name || !CONFIRM_EXT_RE.test(name)) return false
  if (isValuationNoiseName(name)) return false
  if (/\.zip$/i.test(name)) {
    return CONFIRM_FILENAME_RE.test(name)
  }
  if (!CONFIRM_FILE_EXT_RE.test(name)) return false
  return CONFIRM_FILENAME_RE.test(name)
}

export function hasConfirmAttachment(
  subject: string,
  attachments: ConfirmAttachmentInfo[],
): boolean {
  if (isConfirmSubject(subject)) return true
  return attachments.some((a) => isConfirmAttachmentFilename(a.filename))
}

/** Prefer PDFs named as confirm slips; include zips on 确认单 subjects. */
export function selectConfirmAttachments(
  subject: string,
  attachments: ConfirmAttachmentInfo[],
): ConfirmAttachmentInfo[] {
  const named = attachments.filter((a) => isConfirmAttachmentFilename(a.filename))
  if (named.length > 0) {
    const pdfs = named.filter((a) => /\.pdf$/i.test(a.filename))
    if (pdfs.length > 0) return pdfs
    return named
  }
  if (!isConfirmSubject(subject)) return []
  const pdfs = attachments.filter((a) => /\.pdf$/i.test(a.filename) && !isValuationNoiseName(a.filename))
  if (pdfs.length > 0) return pdfs
  const zips = attachments.filter((a) => /\.zip$/i.test(a.filename) && !isValuationNoiseName(a.filename))
  if (zips.length > 0) return zips
  return attachments.filter((a) => CONFIRM_FILE_EXT_RE.test(a.filename) && !isValuationNoiseName(a.filename))
}

/** Unpack 确认单 PDFs (and images) from a TA zip. */
export function expandConfirmZipBuffer(buffer: Buffer): ConfirmZipInner[] {
  const zip = new AdmZip(buffer)
  const files: ConfirmZipInner[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!CONFIRM_FILE_EXT_RE.test(entry.entryName)) continue
    const filename = entry.entryName.split(/[/\\]/).pop() ?? entry.entryName
    if (isValuationNoiseName(filename)) continue
    files.push({ filename, buffer: entry.getData() })
  }
  const named = files.filter((f) => CONFIRM_FILENAME_RE.test(f.filename))
  return named.length > 0 ? named : files.filter((f) => /\.pdf$/i.test(f.filename))
}
