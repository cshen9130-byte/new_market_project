/**
 * Ingest historical 估值表 batch zip emails only (fast backfill path).
 */
import { ImapFlow } from "imapflow"
import { getCrawlEmailByAccount, getImapFolders, listCrawlEmails } from "@/lib/server/crawl-emails"
import { extractValuationFromBuffer, selectValuationAttachments } from "@/lib/server/email-valuation-attachment"
import { upsertEmailValuationRecords, type EmailValuationInsert } from "@/lib/server/email-valuation-pg"
import { expandValuationZipBuffer, isValuationZipFilename, zipInnerAttachmentKey } from "@/lib/server/email-valuation-zip"

function collectAttachments(node: any, pathStr = "", out: { filename: string; part: string }[] = []) {
  const fname: string =
    node.dispositionParameters?.filename ?? node.dispositionParameters?.name ?? node.parameters?.name ?? ""
  const disp: string = (node.disposition ?? "").toLowerCase()
  if (fname && (disp === "attachment" || fname)) out.push({ filename: fname, part: pathStr || "1" })
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

async function downloadPart(client: ImapFlow, uid: string, part: string): Promise<Buffer> {
  const dl = await client.download(uid, part, { uid: true })
  const bufs: Buffer[] = []
  for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
  return Buffer.concat(bufs)
}

async function main() {
  const account = getCrawlEmailByAccount(listCrawlEmails()[0]!.account)!
  const since = new Date("2025-06-01T00:00:00Z")
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
  })

  const inserts: EmailValuationInsert[] = []
  await client.connect()
  try {
    for (const folder of getImapFolders(account)) {
      await client.mailboxOpen(folder)
      const uids = (await client.search({ since }, { uid: true })) || []
      type Candidate = {
        uid: number
        subject: string
        sentAt: Date
        senderEmail: string
        attachments: { filename: string; part: string }[]
      }
      const candidates: Candidate[] = []

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        const envelope = (msg as { envelope?: { subject?: string; from?: { address?: string }[] } }).envelope
        const subject = envelope?.subject ?? ""
        const structure = (msg as { bodyStructure?: unknown }).bodyStructure
        if (!structure) continue
        const attachments = collectAttachments(structure)
        const valuationAttachments = selectValuationAttachments(subject, attachments)
        const zipOnly = valuationAttachments.filter((a) => isValuationZipFilename(a.filename))
        if (zipOnly.length === 0) continue
        const sentAt = (msg as { internalDate?: Date }).internalDate ?? new Date()
        const senderEmail = envelope?.from?.[0]?.address ?? ""
        candidates.push({
          uid: (msg as { uid?: number }).uid ?? 0,
          subject,
          sentAt,
          senderEmail,
          attachments: zipOnly,
        })
      }

      console.log("zip valuation emails:", candidates.length)
      for (const c of candidates) {
        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(c.uid),
          sentAt: c.sentAt.toISOString(),
          subject: c.subject,
          senderEmail: c.senderEmail,
        }
        for (const att of c.attachments) {
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
        }
      }
    }
  } finally {
    await client.logout().catch(() => {})
  }

  console.log("records to upsert:", inserts.length)
  const result = await upsertEmailValuationRecords(inserts)
  console.log("saved:", result.recordsSaved, "holdings:", result.holdingsSaved)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
