/**
 * Select email attachments that look like broker 确认单 / 确认函.
 */

export type ConfirmAttachmentInfo = { filename: string; part: string }

export const CONFIRM_SUBJECT_RE =
  /确认单|确认函|交易确认|成交确认|申购确认|赎回确认|认购确认|基金成立|Transaction\s*Confirm/iu

export const CONFIRM_FILENAME_RE =
  /确认单|确认函|交易确认|成交确认|申购确认|赎回确认|认购确认|基金成立|Transaction\s*Confirm/iu

const CONFIRM_EXT_RE = /\.(pdf|png|jpe?g|gif|webp|bmp|xlsx?|docx?)$/i

export function isConfirmSubject(subject: string): boolean {
  return CONFIRM_SUBJECT_RE.test(subject || "")
}

export function isConfirmAttachmentFilename(filename: string): boolean {
  const name = (filename || "").trim()
  if (!name || !CONFIRM_EXT_RE.test(name)) return false
  // Exclude valuation / NAV / ledger noise even if "确认" appears elsewhere.
  if (/估值表|净值表|净值波动|台账|份额明细|投资者明细|持有人明细|业绩报酬试算/i.test(name)) {
    return false
  }
  return CONFIRM_FILENAME_RE.test(name)
}

export function hasConfirmAttachment(
  subject: string,
  attachments: ConfirmAttachmentInfo[],
): boolean {
  if (isConfirmSubject(subject)) return true
  return attachments.some((a) => isConfirmAttachmentFilename(a.filename))
}

/** Prefer PDFs named as confirm slips; fall back to any confirm-named file; then PDFs on confirm subjects. */
export function selectConfirmAttachments(
  subject: string,
  attachments: ConfirmAttachmentInfo[],
): ConfirmAttachmentInfo[] {
  const named = attachments.filter((a) => isConfirmAttachmentFilename(a.filename))
  if (named.length > 0) {
    const pdfs = named.filter((a) => /\.pdf$/i.test(a.filename))
    return pdfs.length > 0 ? pdfs : named
  }
  if (!isConfirmSubject(subject)) return []
  const pdfs = attachments.filter((a) => /\.pdf$/i.test(a.filename))
  if (pdfs.length > 0) return pdfs
  return attachments.filter((a) => CONFIRM_EXT_RE.test(a.filename))
}
