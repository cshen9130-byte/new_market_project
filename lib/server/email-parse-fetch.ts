import { ImapFlow } from "imapflow"
import {
  getCrawlEmailByAccount,
  getCrawlEmailById,
  getImapFolders,
  listCrawlEmails,
  type CrawlEmailAccount,
} from "@/lib/server/crawl-emails"
import {
  countRecordsMissingSender,
  getRecordsNeedingSender,
  patchSenderEmails,
  replaceEmailParseRecords,
  type EmailParseRecord,
  type ParseStepStatus,
} from "@/lib/server/email-parse-records"
import { extractNavData, extractNavHistoryFromBody } from "@/lib/server/email-nav-extract"
import {
  extractNavTableFromBuffer,
  selectNavTableAttachments,
} from "@/lib/server/email-nav-attachment"
import { upsertEmailNavRecords, type EmailNavInsert } from "@/lib/server/email-nav-pg"

export type EmailParseFetchResult = {
  emailsScanned: number
  recordsFound: number
  navSaved: number
  errors: string[]
}

const FUND_EMAIL_RE =
  /净值|估值|私募|基金份额|业绩报酬|虚拟净值|台账|份额明细|投资者明细|清盘|核算|证券投资基金/u

type AttachmentInfo = { filename: string; part: string }

function collectAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function collectTextParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: { part: string; mime: string }[] = [],
): { part: string; mime: string }[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  const mime: string = (node.type ?? "").toLowerCase()
  const subtype: string = (node.subtype ?? "").toLowerCase()
  const fullMime = subtype ? `${mime}/${subtype}` : mime
  const disp: string = (node.disposition ?? "").toLowerCase()
  const isAttachment = disp === "attachment" || !!fname

  if (!isAttachment && (fullMime.includes("text/plain") || fullMime.includes("text/html"))) {
    out.push({ part: pathStr || "1", mime: fullMime })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectTextParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

function isFundRelated(subject: string, attachments: AttachmentInfo[]): boolean {
  if (FUND_EMAIL_RE.test(subject)) return true
  return attachments.some((a) => {
    const lower = a.filename.toLowerCase()
    return (lower.endsWith(".xlsx") || lower.endsWith(".xls")) && FUND_EMAIL_RE.test(a.filename)
  })
}

function hasTableNav(body: string): boolean {
  const text = body.replace(/\s+/g, " ")
  if (/产品代码\s+产品名称\s+净值日期/u.test(body)) return /\d+\.\d{2,8}/.test(text)
  if (/产品代码\s+产品名称/u.test(body) && /\d{4}年\d{1,2}月\d{1,2}日/u.test(body)) {
    return /\d+\.\d{2,8}/.test(text)
  }
  return /单位净值|基金份额净值|资产净值|虚拟净值|虚拟单位净值/.test(text) && /\d+\.\d{2,8}/.test(text) && /<table|┌|│|净值日期/u.test(body)
}

function hasPostTableNav(body: string): boolean {
  const plain = stripHtml(body)
  const afterTable = plain.split(/单位净值|基金份额净值/u).slice(1).join("")
  if (afterTable && /\d+\.\d{3,8}/.test(afterTable)) return true
  return /累计净值\s*[：:]\s*\d+\.\d{3,8}/u.test(plain)
}

function hasValuation(subject: string, attachments: AttachmentInfo[]): boolean {
  if (/估值表|估值/i.test(subject)) return true
  return attachments.some((a) => /估值表|估值|专用表/i.test(a.filename))
}

function hasLedger(subject: string, attachments: AttachmentInfo[]): boolean {
  if (/台账|份额明细|投资者明细|持有人明细/i.test(subject)) return true
  return attachments.some((a) => /台账|份额明细|投资者明细|持有人明细/i.test(a.filename))
}

function statusFor(predicate: boolean, relevant: boolean): ParseStepStatus {
  if (!relevant) return "失败"
  return predicate ? "成功" : "失败"
}

type EnvelopeAddress = { name?: string; address?: string; mailbox?: string; host?: string }

function formatSenderEmail(from: EnvelopeAddress[] | undefined): string {
  const first = from?.[0]
  if (!first) return ""
  if (first.address?.trim()) return first.address.trim()
  if (first.mailbox && first.host) return `${first.mailbox}@${first.host}`.trim()
  return (first.name ?? "").trim()
}

function parseEmailRecord(
  account: CrawlEmailAccount,
  uid: string,
  subject: string,
  sentAt: Date,
  senderEmail: string,
  body: string,
  attachments: AttachmentInfo[],
): Omit<EmailParseRecord, "id"> {
  const valuationRelevant = hasValuation(subject, attachments)
  const ledgerRelevant = hasLedger(subject, attachments)
  const navRelevant = /净值|虚拟净值|业绩报酬/u.test(subject) || /\.xlsx?$/i.test(attachments.map((a) => a.filename).join(" "))

  return {
    crawlEmailId: account.id,
    crawlEmailAccount: account.account,
    senderEmail,
    uid,
    sentAt: sentAt.toISOString(),
    subject,
    tableNavStatus: statusFor(hasTableNav(body), navRelevant),
    postTableNavStatus: statusFor(hasPostTableNav(body), navRelevant),
    valuationStatus: statusFor(valuationRelevant, valuationRelevant || navRelevant),
    ledgerStatus: statusFor(ledgerRelevant, ledgerRelevant),
    parsedAt: new Date().toISOString(),
  }
}

type FetchMailboxResult = {
  parseRecords: Omit<EmailParseRecord, "id">[]
  navRecords: EmailNavInsert[]
}

async function downloadPart(client: ImapFlow, uid: string, part: string): Promise<Buffer> {
  const dl = await client.download(uid, part, { uid: true })
  const bufs: Buffer[] = []
  for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
  return Buffer.concat(bufs)
}

async function fetchMailbox(
  account: CrawlEmailAccount,
  since: Date,
  errors: string[],
): Promise<FetchMailboxResult> {
  if (!account.pass?.trim()) {
    errors.push(`${account.account}: 未配置授权码`)
    return { parseRecords: [], navRecords: [] }
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
  })

  const parseRecords: Omit<EmailParseRecord, "id">[] = []
  const navRecords: EmailNavInsert[] = []

  const folders = getImapFolders(account)

  await client.connect()
  try {
    for (const folder of folders) {
      await client.mailboxOpen(folder)
      const uids = (await client.search({ since }, { uid: true })) || []
      if (uids.length === 0) continue

      // ── Step 1: batch-fetch envelopes + body structures for ALL matching UIDs ──
      // A single IMAP FETCH command instead of N individual round-trips.
      type Candidate = {
        uid: number
        subject: string
        sentAt: Date
        senderEmail: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        structure: any
        attachments: AttachmentInfo[]
        textParts: { part: string; mime: string }[]
      }
      const candidates: Candidate[] = []

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        const envelope = (msg as {
          envelope?: { subject?: string; date?: Date; from?: EnvelopeAddress[] }
        }).envelope
        const subject = envelope?.subject ?? ""
        const senderEmail = formatSenderEmail(envelope?.from)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const structure = (msg as any).bodyStructure
        if (!structure) continue

        const attachments = collectAttachments(structure)
        if (!isFundRelated(subject, attachments)) continue

        const textParts = collectTextParts(structure)
        const sentAt = (msg as { internalDate?: Date }).internalDate ?? envelope?.date ?? new Date()
        const uid = (msg as { uid?: number }).uid ?? 0

        candidates.push({ uid, subject, sentAt, senderEmail, structure, attachments, textParts })
      }

      // ── Step 2: download body text only for fund-related emails ──
      for (const { uid, subject, sentAt, senderEmail, attachments, textParts } of candidates) {
        const chunks: string[] = [subject]
        for (const { part, mime } of textParts) {
          try {
            const dl = await client.download(String(uid), part, { uid: true })
            const bufs: Buffer[] = []
            for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
            const text = Buffer.concat(bufs).toString("utf-8")
            chunks.push(mime.includes("text/html") ? stripHtml(text) : text)
          } catch (e) {
            errors.push(`${account.account} UID ${uid}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        const bodyText = chunks.join("\n")
        parseRecords.push(
          parseEmailRecord(account, String(uid), subject, sentAt, senderEmail, bodyText, attachments),
        )

        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(uid),
          sentAt: sentAt.toISOString(),
          subject,
          senderEmail,
        }

        const navDatesFromAttachments = new Set<string>()
        for (const att of selectNavTableAttachments(subject, attachments)) {
          try {
            const buf = await downloadPart(client, String(uid), att.part)
            const rows = extractNavTableFromBuffer(buf, att.filename, subject)
            for (const row of rows) {
              if (!row.navDate) continue
              navDatesFromAttachments.add(row.navDate)
              navRecords.push({
                ...emailMeta,
                ...row,
                attachmentFilename: att.filename,
              })
            }
          } catch (e) {
            errors.push(
              `${account.account} UID ${uid} attachment ${att.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }

        const navHistory = extractNavHistoryFromBody(subject, bodyText)
        if (navHistory.length > 0) {
          for (const row of navHistory) {
            if (!row.navDate) continue
            if (navDatesFromAttachments.has(row.navDate)) continue
            navRecords.push({
              ...emailMeta,
              ...row,
              attachmentFilename: "",
            })
          }
        } else {
          const navData = extractNavData(subject, bodyText)
          if (navData) {
            const skipTextNav =
              navData.navDate != null
                ? navDatesFromAttachments.has(navData.navDate)
                : navDatesFromAttachments.size > 0
            if (!skipTextNav) {
              navRecords.push({
                ...emailMeta,
                ...navData,
                attachmentFilename: "",
              })
            }
          }
        }
      }
    } // end for folder
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }

  return { parseRecords, navRecords }
}

export async function fetchEmailParseRecords(options?: {
  crawlEmailId?: string
  days?: number
}): Promise<EmailParseFetchResult> {
  const errors: string[] = []
  const since = new Date()
  since.setDate(since.getDate() - (options?.days ?? 31))

  const accounts: CrawlEmailAccount[] = []
  if (options?.crawlEmailId) {
    const one = getCrawlEmailById(options.crawlEmailId)
    if (!one) throw new Error("抓取邮箱不存在")
    accounts.push(one)
  } else {
    for (const pub of listCrawlEmails()) {
      const full = getCrawlEmailByAccount(pub.account)
      if (full?.pass?.trim()) accounts.push(full)
    }
  }

  if (accounts.length === 0) {
    const configured = listCrawlEmails()
    if (configured.length === 0) {
      throw new Error("请先在「抓取邮箱设置」中添加抓取邮箱")
    }
    throw new Error("抓取邮箱未配置授权码，请编辑邮箱并填写授权码")
  }

  const allParseRecords: Omit<EmailParseRecord, "id">[] = []
  const allNavRecords: EmailNavInsert[] = []
  let emailsScanned = 0

  for (const account of accounts) {
    try {
      const { parseRecords, navRecords } = await fetchMailbox(account, since, errors)
      emailsScanned += parseRecords.length
      allParseRecords.push(...parseRecords)
      allNavRecords.push(...navRecords)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${account.account}: ${msg}`)
    }
  }

  replaceEmailParseRecords(allParseRecords)

  let navSaved = 0
  try {
    navSaved = await upsertEmailNavRecords(allNavRecords)
  } catch (e) {
    errors.push(`保存净值数据失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    emailsScanned,
    recordsFound: allParseRecords.length,
    navSaved,
    errors,
  }
}

export async function backfillSenderEmails(options?: {
  items?: { crawlEmailAccount: string; uid: string }[]
}): Promise<{ updated: number; errors: string[] }> {
  const needing = options?.items?.length
    ? options.items.map((item) => ({
        crawlEmailAccount: item.crawlEmailAccount,
        uid: item.uid,
        crawlEmailId: "",
      }))
    : getRecordsNeedingSender()
  if (needing.length === 0) return { updated: 0, errors: [] }

  const errors: string[] = []
  const patches: { crawlEmailAccount: string; uid: string; senderEmail: string }[] = []
  const byAccount = new Map<string, string[]>()

  for (const row of needing) {
    const list = byAccount.get(row.crawlEmailAccount) ?? []
    list.push(row.uid)
    byAccount.set(row.crawlEmailAccount, list)
  }

  for (const [accountName, uids] of byAccount) {
    const account = getCrawlEmailByAccount(accountName)
    if (!account?.pass?.trim()) {
      errors.push(`${accountName}: 未配置授权码，无法补全发件邮箱`)
      continue
    }

    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.account, pass: account.pass },
      logger: false,
    })

    try {
      await client.connect()
      await client.mailboxOpen("INBOX")

      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(String(uid), { envelope: true })
          if (!msg) continue
          const sender = formatSenderEmail(
            (msg as { envelope?: { from?: EnvelopeAddress[] } }).envelope?.from,
          )
          if (sender) {
            patches.push({ crawlEmailAccount: accountName, uid: String(uid), senderEmail: sender })
          }
        } catch (e) {
          errors.push(`${accountName} UID ${uid}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      errors.push(`${accountName}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      try {
        await client.logout()
      } catch {
        // ignore
      }
    }
  }

  const updated = patchSenderEmails(patches)
  return { updated, errors }
}

export function needsSenderBackfill(): boolean {
  return countRecordsMissingSender() > 0
}
