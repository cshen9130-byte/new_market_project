/**
 * Fast path: ingest 估值表 batch .zip emails without scanning the full mailbox body.
 */
import type { ImapFlow } from "imapflow"
import { getCrawlEmailByAccount, getImapFolders, listCrawlEmails, persistCrawlEmailAccount, type CrawlEmailAccount } from "@/lib/server/crawl-emails"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import { extractValuationFromBuffer, selectValuationAttachments } from "@/lib/server/email-valuation-attachment"
import { upsertEmailValuationRecords, type EmailValuationInsert } from "@/lib/server/email-valuation-pg"
import { expandValuationZipBuffer, isValuationZipFilename, zipInnerAttachmentKey } from "@/lib/server/email-valuation-zip"

type AttachmentInfo = { filename: string; part: string }

function collectAttachments(
  node: any,
  pathStr = "",
  out: AttachmentInfo[] = [],
): AttachmentInfo[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  const disp: string = (node.disposition ?? "").toLowerCase()
  if (fname && (disp === "attachment" || fname)) {
    out.push({ filename: fname, part: pathStr || "1" })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function formatSenderEmail(from: Array<{ address?: string; mailbox?: string; host?: string }> | undefined): string {
  const first = from?.[0]
  if (!first) return ""
  if (first.address?.trim()) return first.address.trim()
  if (first.mailbox && first.host) return `${first.mailbox}@${first.host}`.trim()
  return ""
}

async function downloadPart(client: ImapFlow, uid: string, part: string): Promise<Buffer> {
  const dl = await client.download(uid, part, { uid: true })
  const bufs: Buffer[] = []
  for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
  return Buffer.concat(bufs)
}

async function ingestZipValuationsForAccount(
  account: CrawlEmailAccount,
  since: Date,
  errors: string[],
): Promise<EmailValuationInsert[]> {
  if (!account.pass?.trim()) return []

  const client = createSafeImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    label: account.account,
  })

  const inserts: EmailValuationInsert[] = []
  try {
    await client.connect()
    for (const folder of getImapFolders(account)) {
      await client.mailboxOpen(folder)
      const uids = (await client.search({ since }, { uid: true })) || []

      type Candidate = {
        uid: number
        subject: string
        sentAt: Date
        senderEmail: string
        attachments: AttachmentInfo[]
      }
      const candidates: Candidate[] = []

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        const envelope = (msg as { envelope?: { subject?: string; date?: Date; from?: unknown[] } }).envelope
        const subject = envelope?.subject ?? ""
        const structure = (msg as { bodyStructure?: unknown }).bodyStructure
        if (!structure) continue
        const attachments = collectAttachments(structure)
        const zipAttachments = selectValuationAttachments(subject, attachments).filter((a) =>
          isValuationZipFilename(a.filename),
        )
        if (zipAttachments.length === 0) continue
        const sentAt = (msg as { internalDate?: Date }).internalDate ?? envelope?.date ?? new Date()
        candidates.push({
          uid: (msg as { uid?: number }).uid ?? 0,
          subject,
          sentAt,
          senderEmail: formatSenderEmail(envelope?.from as Parameters<typeof formatSenderEmail>[0]),
          attachments: zipAttachments,
        })
      }

      for (const c of candidates) {
        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(c.uid),
          sentAt: c.sentAt.toISOString(),
          subject: c.subject,
          senderEmail: c.senderEmail,
        }
        for (const att of c.attachments) {
          try {
            const buf = await downloadPart(client, String(c.uid), att.part)
            for (const inner of expandValuationZipBuffer(buf, att.filename)) {
              const extracted = extractValuationFromBuffer(inner.buffer, inner.filename, c.subject, c.senderEmail)
              if (!extracted) continue
              inserts.push({
                ...emailMeta,
                attachmentFilename: zipInnerAttachmentKey(att.filename, inner.filename),
                productCode: extracted.productCode,
                fundName: extracted.fundName,
                valuationDate: extracted.valuationDate,
                unitNav: extracted.unitNav,
                cumulativeNav: extracted.cumulativeNav,
                custodyBalance: extracted.custodyBalance,
                netAssetValue: extracted.netAssetValue,
                paidInCapital: extracted.paidInCapital,
                totalAsset: extracted.totalAsset,
                totalLiability: extracted.totalLiability,
                custodian: extracted.custodian,
                netAsset: extracted.netAssetValue,
                underlyingHoldings: extracted.underlyingHoldings,
                holdingsCount: extracted.holdingsCount,
                source: extracted.source,
                summary: extracted.analysis.summary,
                holdings: extracted.analysis.portfolio_data,
              })
            }
          } catch (e) {
            errors.push(
              `${account.account} UID ${c.uid} zip ${att.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }
      }
    }
  } finally {
    await closeImapFlow(client)
  }

  return inserts
}

export async function ingestZipValuationBatchEmails(options?: {
  days?: number
  since?: Date
}): Promise<{ recordsSaved: number; holdingsSaved: number; zipEmails: number; errors: string[] }> {
  const errors: string[] = []
  const since = options?.since ?? new Date()
  if (!options?.since) {
    const { resolveEmailParseLookbackDays } = await import("@/lib/server/email-parse-lookback")
    since.setDate(since.getDate() - resolveEmailParseLookbackDays(options?.days))
  }

  const allPubs = await listCrawlEmails()
  const accountsWithPass = await Promise.all(allPubs.map((p) => getCrawlEmailByAccount(p.account)))
  const accounts = accountsWithPass.filter((a): a is NonNullable<typeof a> => !!a?.pass?.trim())

  const allInserts: EmailValuationInsert[] = []
  for (const account of accounts) {
    try {
      const rows = await ingestZipValuationsForAccount(account, since, errors)
      if (rows.length > 0) persistCrawlEmailAccount(account).catch(() => {})
      allInserts.push(...rows)
    } catch (e) {
      errors.push(`${account.account}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (allInserts.length === 0) {
    return { recordsSaved: 0, holdingsSaved: 0, zipEmails: 0, errors }
  }

  const zipEmailKeys = new Set(allInserts.map((r) => `${r.crawlEmailAccount}:${r.emailUid}`))
  const saved = await upsertEmailValuationRecords(allInserts)
  return {
    recordsSaved: saved.recordsSaved,
    holdingsSaved: saved.holdingsSaved,
    zipEmails: zipEmailKeys.size,
    errors,
  }
}
