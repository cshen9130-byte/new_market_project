/**
 * Ingest 【上海众量】代表产品历史净值 attachments (UID 3125 / 3220).
 *
 * Usage: npx tsx scripts/ma/_ingest_zhongliang_history_nav.ts
 */
import { ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()

function decodeFetchedImapPart(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf) return buf
  const head = buf.subarray(0, Math.min(buf.length, 80)).toString("ascii").replace(/\s+/g, "")
  if (/^(?:UEsDB|0M8R4K)/.test(head)) {
    return Buffer.from(buf.toString("ascii").replace(/\s+/g, ""), "base64")
  }
  return buf
}

function collectAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: { filename: string; part: string }[] = [],
): { filename: string; part: string }[] {
  const fname: string =
    node.dispositionParameters?.filename
    ?? node.dispositionParameters?.name
    ?? node.parameters?.name
    ?? ""
  if (fname) out.push({ filename: fname, part: pathStr || "1" })
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachments(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

async function main() {
  const { getCrawlEmailByAccount } = await import("@/lib/server/crawl-emails")
  const { createSafeImapFlow, closeImapFlow } = await import("@/lib/server/imap-flow-safe")
  const { formatSenderEmail, formatReceiverEmail } = await import("@/lib/server/email-envelope")
  const { selectNavTableAttachments, extractNavTableFromBuffer } = await import(
    "@/lib/server/email-nav-attachment"
  )
  const { upsertEmailNavRecords } = await import("@/lib/server/email-nav-pg")
  type EmailNavInsert = import("@/lib/server/email-nav-pg").EmailNavInsert
  const { invalidateDetailNavCache, refreshDetailNavCacheForFunds } = await import(
    "@/lib/server/fund-detail-nav-cache-pg"
  )
  const { query } = await import("@/lib/db")

  const account = await getCrawlEmailByAccount("data@jinyuasset.com")
  if (!account?.pass?.trim()) throw new Error("data@jinyuasset.com crawl mailbox not configured")

  const uids = ["3125", "3220"]
  const navRecords: EmailNavInsert[] = []

  for (const uid of uids) {
    const client = createSafeImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.account, pass: account.pass },
      logger: false,
      connectionTimeout: 20_000,
      greetingTimeout: 10_000,
      socketTimeout: 180_000,
      label: account.account,
    })
    await client.connect()
    try {
      await client.mailboxOpen("INBOX")
      const msg = await client.fetchOne(
        uid,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )
      if (!msg) {
        console.log(uid, "not found")
        continue
      }
      const envelope = msg.envelope
      const subject = envelope?.subject ?? ""
      const attachments = collectAttachments(msg.bodyStructure)
      const selected = selectNavTableAttachments(subject, attachments)
      console.log(uid, subject, "selected", selected.map((a) => a.filename))
      if (selected.length === 0) continue

      const sentAt = (msg.internalDate ?? envelope?.date ?? new Date()).toISOString()
      const senderEmail = formatSenderEmail(envelope?.from)
      const receiverEmail = formatReceiverEmail(envelope)

      const parts = selected.map((a) => a.part)
      const bodyMsg = await client.fetchOne(uid, { uid: true, bodyParts: parts }, { uid: true })
      const bodyParts = (bodyMsg as { bodyParts?: Map<string, Buffer> }).bodyParts
      for (const att of selected) {
        let buf = bodyParts?.get(att.part) ?? bodyParts?.get(String(att.part)) ?? null
        if (!buf?.length) {
          console.log("  missing part, streaming", att.filename, att.part)
          const dl = await client.download(uid, att.part, { uid: true })
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
          buf = Buffer.concat(chunks)
        }
        buf = decodeFetchedImapPart(buf)
        const rows = extractNavTableFromBuffer(buf, att.filename, subject)
        console.log(
          "  ",
          att.filename,
          "bytes",
          buf.length,
          "rows",
          rows.length,
          rows[0]?.fundName,
          rows[0]?.productCode,
          rows[0]?.navDate,
          rows.at(-1)?.navDate,
        )
        for (const row of rows) {
          if (!row.navDate) continue
          navRecords.push({
            crawlEmailAccount: account.account,
            emailUid: uid,
            sentAt,
            subject,
            senderEmail,
            receiverEmail,
            attachmentFilename: att.filename,
            ...row,
          })
        }
      }
    } finally {
      await closeImapFlow(client)
    }
  }

  const saved = await upsertEmailNavRecords(navRecords)
  const codes = [...new Set(navRecords.map((r) => (r.productCode ?? "").trim().toUpperCase()).filter(Boolean))]
  const names = [...new Set(navRecords.map((r) => (r.fundName ?? "").trim()).filter(Boolean))]
  console.log("upserted", saved, "codes", codes, "names", names)

  if (codes.length > 0) {
    const invalidated = await invalidateDetailNavCache(codes)
    console.log("cache_invalidated", invalidated)
    const identities = await query<{ beian_hao: string; product_name: string }>(
      `SELECT DISTINCT UPPER(BTRIM(product_code)) AS beian_hao,
              COALESCE(NULLIF(BTRIM(fund_name), ''), UPPER(BTRIM(product_code))) AS product_name
       FROM ops_email_nav_records
       WHERE UPPER(BTRIM(product_code)) = ANY($1::text[])
         AND NULLIF(BTRIM(fund_name), '') IS NOT NULL`,
      [codes],
    )
    const refreshed = await refreshDetailNavCacheForFunds(
      identities.map((row) => ({
        beian_hao: row.beian_hao,
        product_name: row.product_name,
        short_name: null,
      })),
    )
    console.log("cache_refreshed", refreshed)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
