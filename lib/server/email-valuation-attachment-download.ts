/**
 * Re-download a stored 估值表 attachment from IMAP.
 *
 * Prefer BODYSTRUCTURE + BODY[part] (same path as email ingest). Fetching the
 * full raw message with `source: true` hangs on Tencent Exmail for larger zips.
 */

import type { ImapFlow } from "imapflow"
import { getCrawlEmailByAccount, getImapFolders } from "@/lib/server/crawl-emails"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import {
  extractSpreadsheetFromZipBuffer,
  parseZipInnerAttachmentKey,
} from "@/lib/server/email-valuation-zip"

const IMAP_CONNECTION_TIMEOUT_MS = 20_000
const IMAP_GREETING_TIMEOUT_MS = 10_000
const IMAP_SOCKET_TIMEOUT_MS = 60_000

type AttachmentInfo = { filename: string; part: string }

function basenameLower(name: string): string {
  return name.trim().replace(/^.*[/\\]/, "").toLowerCase()
}

export function attachmentNameMatches(candidate: string, target: string): boolean {
  const a = basenameLower(candidate)
  const b = basenameLower(target)
  if (!a || !b) return false
  if (a === b) return true
  return a.includes(b) || b.includes(a)
}

function collectAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: AttachmentInfo[] = [],
): AttachmentInfo[] {
  const fname: string =
    node?.dispositionParameters?.filename ??
    node?.dispositionParameters?.name ??
    node?.parameters?.name ??
    ""
  if (fname) out.push({ filename: fname, part: pathStr || "1" })
  if (Array.isArray(node?.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function decodeFetchedImapPart(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf) return buf
  const head = buf.subarray(0, Math.min(buf.length, 80)).toString("ascii").replace(/\s+/g, "")
  if (/^(?:UEsDB|JVBERi|0M8R4K)/.test(head)) {
    return Buffer.from(buf.toString("ascii").replace(/\s+/g, ""), "base64")
  }
  return buf
}

async function downloadImapPart(client: ImapFlow, uid: string, part: string): Promise<Buffer> {
  const msg = await client.fetchOne(
    String(uid),
    { uid: true, bodyParts: [part] },
    { uid: true },
  )
  const parts = (msg as { bodyParts?: Map<string, Buffer> } | false)?.bodyParts
  const raw = parts?.get(part) ?? parts?.get(String(part))
  if (!raw?.length) throw new Error(`empty IMAP part ${part}`)
  return decodeFetchedImapPart(raw)
}

export function extractAttachmentBuffer(
  raw: Buffer,
  targetFilename: string,
): Buffer | null {
  const boundary = raw.toString("binary").match(/boundary="?([^"\r\n;]+)"?/i)?.[1]
  if (!boundary) return null

  for (const part of raw.toString("binary").split(`--${boundary}`)) {
    const fnMatch = part.match(/filename\*?=(?:UTF-8''|"?([^"\r\n;]+)"?)/i) ?? part.match(/filename="?([^"\r\n]+)"?/i)
    if (!fnMatch) continue
    let filename = (fnMatch[1] ?? "").trim()
    try {
      if (/%[0-9A-Fa-f]{2}/.test(filename)) filename = decodeURIComponent(filename)
    } catch {
      // keep encoded name
    }
    if (!attachmentNameMatches(filename, targetFilename)) continue
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

async function fetchAttachmentFromMailbox(input: {
  crawlEmailAccount: string
  emailUid: string
  attachmentFilename: string
}): Promise<{ buffer: Buffer; filename: string } | null> {
  const account = await getCrawlEmailByAccount(input.crawlEmailAccount)
  if (!account?.pass?.trim()) return null
  if (!input.attachmentFilename?.trim() || !input.emailUid?.trim()) return null

  const client = createSafeImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    label: account.account,
  })

  try {
    await client.connect()
    for (const folder of getImapFolders(account)) {
      try {
        await client.mailboxOpen(folder)
        const structured = await client.fetchOne(
          input.emailUid,
          { uid: true, bodyStructure: true },
          { uid: true },
        )
        if (!structured) continue

        const attachments = collectAttachments(
          (structured as { bodyStructure?: unknown }).bodyStructure,
        )
        const hit =
          attachments.find((a) => basenameLower(a.filename) === basenameLower(input.attachmentFilename))
          ?? attachments.find((a) => attachmentNameMatches(a.filename, input.attachmentFilename))

        if (hit) {
          const buffer = await downloadImapPart(client, input.emailUid, hit.part)
          if (buffer.length) return { buffer, filename: input.attachmentFilename.trim() }
        }

        const rawMsg = await client.fetchOne(
          input.emailUid,
          { uid: true, source: true },
          { uid: true },
        )
        const source = (rawMsg as { source?: Buffer } | false)?.source
        if (!source?.length) continue
        const body = extractAttachmentBuffer(source, input.attachmentFilename)
        if (body?.length) return { buffer: body, filename: input.attachmentFilename.trim() }
      } catch (e) {
        console.warn(
          `[email-valuation-attachment-download] ${account.account} folder=${folder} uid=${input.emailUid}:`,
          e instanceof Error ? e.message : e,
        )
      }
    }
  } catch (e) {
    console.warn(
      "[email-valuation-attachment-download] connect failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  } finally {
    await closeImapFlow(client)
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

  return fetchAttachmentFromMailbox(input)
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
