/**
 * Re-download a stored 估值表 attachment from IMAP and extract 托管券商.
 */

import { ImapFlow } from "imapflow"
import { getCrawlEmailByAccount, getImapFolders } from "@/lib/server/crawl-emails"
import { extractValuationFromBuffer } from "@/lib/server/email-valuation-attachment"
import { resolveCustodianFromValuationRecord } from "@/lib/server/email-valuation-custodian"

function extractAttachmentBuffer(
  raw: Buffer,
  targetFilename: string,
): Buffer | null {
  const boundary = raw.toString("binary").match(/boundary="([^"]+)"/i)?.[1]
  if (!boundary) return null

  const normalizedTarget = targetFilename.trim().toLowerCase()
  for (const part of raw.toString("binary").split(`--${boundary}`)) {
    const fnMatch = part.match(/filename="?([^"\r\n]+)"?/i)
    if (!fnMatch) continue
    const filename = fnMatch[1].trim()
    if (filename.toLowerCase() !== normalizedTarget && !filename.toLowerCase().includes(normalizedTarget)) {
      continue
    }
    const blankIdx = part.indexOf("\r\n\r\n")
    if (blankIdx < 0) continue
    if (/base64/i.test(part)) {
      return Buffer.from(
        part.slice(blankIdx + 4).replace(/[\r\n]/g, "").split("\r\n--")[0],
        "base64",
      )
    }
    return Buffer.from(part.slice(blankIdx + 4).split("\r\n--")[0], "binary")
  }
  return null
}

export async function refetchValuationCustodianFromEmail(input: {
  crawlEmailAccount: string
  emailUid: string
  attachmentFilename: string
  subject: string | null
  senderEmail: string | null
}): Promise<string | null> {
  const account = getCrawlEmailByAccount(input.crawlEmailAccount)
  if (!account?.pass?.trim()) return null
  if (!input.attachmentFilename?.trim()) return null

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
  })

  try {
    await client.connect()
    for (const folder of getImapFolders(account)) {
      await client.mailboxOpen(folder)
      const msg = await client.fetchOne(input.emailUid, { source: true, envelope: true }, { uid: true })
      if (!msg?.source) continue

      const senderEmail =
        input.senderEmail
        ?? String(
          (msg as { envelope?: { from?: { address?: string }[] } }).envelope?.from?.[0]?.address ?? "",
        ).trim().toLowerCase()
      const subject =
        input.subject
        ?? (msg as { envelope?: { subject?: string } }).envelope?.subject
        ?? ""

      const body = extractAttachmentBuffer(msg.source as Buffer, input.attachmentFilename)
      if (!body?.length) continue

      const extracted = extractValuationFromBuffer(
        body,
        input.attachmentFilename,
        subject,
        senderEmail || null,
      )
      const resolved = resolveCustodianFromValuationRecord({
        custodian: extracted?.custodian,
        summaryCustodian: extracted?.analysis?.summary?.custodian,
        headerRows: extracted?.analysis?.summary?.header_rows ?? null,
        senderEmail,
        subject,
        attachmentFilename: input.attachmentFilename,
      })
      if (resolved) return resolved
    }
  } catch {
    return null
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }

  return null
}
