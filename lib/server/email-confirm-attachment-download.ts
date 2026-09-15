/**
 * Re-download a stored 确认单 attachment from IMAP when the disk file is missing.
 */

import {
  attachmentNameMatches,
  fetchMailboxAttachmentByFilename,
} from "@/lib/server/email-valuation-attachment-download"
import { expandConfirmZipBuffer } from "@/lib/server/email-confirm-attachment"
import { parseZipInnerAttachmentKey } from "@/lib/server/email-valuation-zip"

function basenameLower(name: string): string {
  return name.trim().replace(/^.*[/\\]/, "").toLowerCase()
}

function pickZipInner(
  zipBuffer: Buffer,
  innerFilename: string,
): { buffer: Buffer; filename: string } | null {
  const files = expandConfirmZipBuffer(zipBuffer)
  if (files.length === 0) return null
  const target = basenameLower(innerFilename)
  const hit =
    files.find((f) => basenameLower(f.filename) === target)
    ?? files.find((f) => attachmentNameMatches(f.filename, innerFilename))
    ?? (files.length === 1 ? files[0] : null)
  return hit ? { buffer: hit.buffer, filename: hit.filename } : null
}

function parseSanitizedZipKey(stored: string): { archive: string; inner: string } | null {
  const inner = parseZipInnerAttachmentKey(stored)
  if (inner) return inner
  const m = stored.trim().match(/^(.+\.zip)[_]+(.+)$/i)
  if (!m) return null
  return { archive: m[1], inner: m[2] }
}

export async function fetchConfirmAttachmentFromEmail(input: {
  crawlEmailAccount: string
  emailUid: string
  attachmentFilename: string
}): Promise<{ buffer: Buffer; filename: string } | null> {
  const filename = input.attachmentFilename.trim()
  if (!filename || !input.emailUid.trim() || !input.crawlEmailAccount.trim()) return null

  const zipKey = parseSanitizedZipKey(filename)
  if (zipKey) {
    const zip = await fetchMailboxAttachmentByFilename({
      crawlEmailAccount: input.crawlEmailAccount,
      emailUid: input.emailUid,
      attachmentFilename: zipKey.archive,
    })
    if (!zip?.buffer.length) return null
    return pickZipInner(zip.buffer, zipKey.inner)
  }

  const direct = await fetchMailboxAttachmentByFilename({
    crawlEmailAccount: input.crawlEmailAccount,
    emailUid: input.emailUid,
    attachmentFilename: filename,
  })
  if (direct?.buffer.length) {
    if (/\.zip$/i.test(direct.filename) || (direct.buffer[0] === 0x50 && direct.buffer[1] === 0x4b)) {
      return pickZipInner(direct.buffer, filename) ?? direct
    }
    return direct
  }

  return null
}
