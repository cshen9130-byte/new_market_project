/**
 * Re-download a stored 估值表 attachment from IMAP.
 */

import { getCrawlEmailByAccount, getImapFolders } from "@/lib/server/crawl-emails"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import {
  extractSpreadsheetFromZipBuffer,
  parseZipInnerAttachmentKey,
} from "@/lib/server/email-valuation-zip"

export function extractAttachmentBuffer(
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

export async function fetchValuationAttachmentFromEmail(input: {
  crawlEmailAccount: string
  emailUid: string
  attachmentFilename: string
}): Promise<{ buffer: Buffer; filename: string } | null> {
  const innerKey = parseZipInnerAttachmentKey(input.attachmentFilename)
  if (innerKey) {
    const zipResult = await fetchValuationAttachmentFromEmail({
      crawlEmailAccount: input.crawlEmailAccount,
      emailUid: input.emailUid,
      attachmentFilename: innerKey.archive,
    })
    if (!zipResult) return null
    const extracted = extractSpreadsheetFromZipBuffer(zipResult.buffer, innerKey.inner)
    if (!extracted) return null
    return { buffer: extracted.buffer, filename: extracted.filename }
  }

  const account = getCrawlEmailByAccount(input.crawlEmailAccount)
  if (!account?.pass?.trim()) return null
  if (!input.attachmentFilename?.trim()) return null

  const client = createSafeImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    label: account.account,
  })

  try {
    await client.connect()
    for (const folder of getImapFolders(account)) {
      await client.mailboxOpen(folder)
      const msg = await client.fetchOne(input.emailUid, { source: true }, { uid: true })
      if (!msg?.source) continue

      const body = extractAttachmentBuffer(msg.source as Buffer, input.attachmentFilename)
      if (!body?.length) continue

      return { buffer: body, filename: input.attachmentFilename.trim() }
    }
  } catch {
    return null
  } finally {
    await closeImapFlow(client)
  }

  return null
}

export function mimeTypeForValuationFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (lower.endsWith(".xls")) {
    return "application/vnd.ms-excel"
  }
  if (lower.endsWith(".csv")) {
    return "text/csv;charset=utf-8"
  }
  return "application/octet-stream"
}
