/**
 * Re-download a stored 估值表 attachment from IMAP and extract 托管券商.
 */

import { extractValuationFromBuffer } from "@/lib/server/email-valuation-attachment"
import { fetchValuationAttachmentFromEmail } from "@/lib/server/email-valuation-attachment-download"
import { resolveCustodianFromValuationRecord } from "@/lib/server/email-valuation-custodian"

export async function refetchValuationCustodianFromEmail(input: {
  crawlEmailAccount: string
  emailUid: string
  attachmentFilename: string
  subject: string | null
  senderEmail: string | null
}): Promise<string | null> {
  const fetched = await fetchValuationAttachmentFromEmail({
    crawlEmailAccount: input.crawlEmailAccount,
    emailUid: input.emailUid,
    attachmentFilename: input.attachmentFilename,
  })
  if (!fetched) return null

  const extracted = extractValuationFromBuffer(
    fetched.buffer,
    input.attachmentFilename,
    input.subject ?? "",
    input.senderEmail || null,
  )
  return resolveCustodianFromValuationRecord({
    custodian: extracted?.custodian,
    summaryCustodian: extracted?.analysis?.summary?.custodian,
    headerRows: extracted?.analysis?.summary?.header_rows ?? null,
    senderEmail: input.senderEmail,
    subject: input.subject,
    attachmentFilename: input.attachmentFilename,
  })
}
