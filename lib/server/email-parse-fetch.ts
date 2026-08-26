import type { ImapFlow } from "imapflow"
import {
  getCrawlEmailByAccount,
  getCrawlEmailById,
  getImapFolders,
  listCrawlEmails,
  persistCrawlEmailAccount,
  type CrawlEmailAccount,
} from "@/lib/server/crawl-emails"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import {
  formatReceiverEmail,
  formatSenderEmail,
  type EnvelopeAddress,
} from "@/lib/server/email-envelope"
import {
  countRecordsMissingSender,
  getRecordsNeedingSender,
  maxSentAtByCrawlAccount,
  patchSenderEmails,
  replaceEmailParseRecords,
  type EmailParseRecord,
  type ParseStepStatus,
} from "@/lib/server/email-parse-records"
import {
  extractNavData,
  extractNavHistoryFromBody,
  isCmsMultiProductNavIncomplete,
} from "@/lib/server/email-nav-extract"
import {
  extractNavFromCiticsAnnouncementPdf,
  extractNavTableFromBuffer,
  isNavTableZipFilename,
  selectNavTableAttachments,
} from "@/lib/server/email-nav-attachment"
import {
  extractNavFromValuationBuffer,
  extractValuationFromBuffer,
  extractValuationFromEmailBody,
  selectValuationAttachments,
} from "@/lib/server/email-valuation-attachment"
import {
  expandNavTableZipBuffer,
  expandValuationZipBuffer,
  isValuationZipFilename,
  zipInnerAttachmentKey,
} from "@/lib/server/email-valuation-zip"
import {
  hasConfirmAttachment,
  selectConfirmAttachments,
} from "@/lib/server/email-confirm-attachment"
import { parseConfirmSlipFromBuffer } from "@/lib/server/email-confirm-parse"
import {
  ensureEmailConfirmTable,
  upsertEmailConfirmRecords,
  type EmailConfirmInsert,
} from "@/lib/server/email-confirm-pg"
import { upsertEmailNavRecords, type EmailNavInsert } from "@/lib/server/email-nav-pg"
import {
  upsertEmailValuationRecords,
  type EmailValuationInsert,
} from "@/lib/server/email-valuation-pg"
import { refreshManagedProductsNavAndListCache } from "@/lib/server/email-nav-latest-pg"
import {
  markAccountScanCompleted,
  bootstrapEmailParseCursorIfMissing,
  resolveAccountScanSince,
  type EmailParseScanMode,
} from "@/lib/server/email-parse-cursor"

export type EmailParseFetchResult = {
  emailsScanned: number
  /** Fund-related UIDs already in NAV/估值表 tables — body/attachments not re-downloaded. */
  emailsSkippedKnown: number
  /** Fund-related UIDs whose bodies/attachments were downloaded this run. */
  emailsDownloaded: number
  recordsFound: number
  navSaved: number
  valuationSaved: number
  valuationHoldingsSaved: number
  /** 确认单/确认函 PDFs saved */
  confirmSaved: number
  /** 估值表 unit NAV copied into ops_email_nav_records */
  custodyValuationNavBackfilled: number
  valuationLatestHoldingsRefreshed: number
  valuationMetricsRefreshed: number
  underlyingMarketRefreshed: number
  managedFofUnderlyingRefreshed: number
  /** New rows auto-added to fof_underlying_summary (运维/投资 FOF底层汇总) */
  opsFofUnderlyingAdded: number
  /** New rows auto-added to fof_underlying_detail (投资 FOF底层明细) */
  detailFofUnderlyingAdded: number
  managedProductsValuationSynced: number
  fofUnderlyingMarketSynced: number
  navLatestRefreshed: number
  /** Product codes / names touched by this parse (for light cache patches). */
  touchedFunds: { productCode: string; fundName: string }[]
  errors: string[]
  /** True when no explicit --days lookback was passed (checkpoint-based scan). */
  incremental: boolean
  scanByAccount: Record<string, { since: string; mode: EmailParseScanMode }>
}

const FUND_EMAIL_RE =
  /净值|估值|私募|基金份额|业绩报酬|虚拟净值|台账|份额明细|投资者明细|清盘|核算|证券投资基金|确认单|确认函|交易确认|成交确认|申购确认|赎回确认|认购确认|基金成立|产品材料|代表性产品|净值序列|历史净值/u

// ImapFlow defaults (connectionTimeout=90s, greetingTimeout=16s, socketTimeout=300s)
// let a single slow/unresponsive mail server block this call for minutes per
// operation. Since this runs inside the shared Next.js server process on an
// hourly-ish cron, a stuck IMAP call can starve web traffic for a long time
// with no automatic recovery. Fail faster instead.
const IMAP_CONNECTION_TIMEOUT_MS = 20_000
const IMAP_GREETING_TIMEOUT_MS = 10_000
// Citics 【净值公告】 zips can be multi-year NAV histories; 60s idle killed SGC823.
const IMAP_SOCKET_TIMEOUT_MS = 180_000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError")
  }
}

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
  if (hasConfirmAttachment(subject, attachments)) return true
  return attachments.some((a) => {
    const lower = a.filename.toLowerCase()
    const nameHit = FUND_EMAIL_RE.test(a.filename)
    return (
      ((lower.endsWith(".xlsx") || lower.endsWith(".xls")) && nameHit)
      || (lower.endsWith(".pdf") && nameHit)
      || (lower.endsWith(".zip") && (nameHit || isNavTableZipFilename(a.filename, subject)))
    )
  })
}

function hasTableNav(body: string): boolean {
  const text = body.replace(/\s+/g, " ")
  if (/产品代码\s+产品名称\s+净值日期/u.test(body)) return /\d+\.\d{2,8}/.test(text)
  if (/产品代码\s+产品名称/u.test(body) && /\d{4}年\d{1,2}月\d{1,2}日/u.test(body)) {
    return /\d+\.\d{2,8}/.test(text)
  }
  if (/产品代码\s+产品名称/u.test(body) && /20\d{2}-\d{2}-\d{2}/u.test(body)) {
    return /\d+\.\d{2,8}/.test(text)
  }
  if (/试算后单位净值/u.test(body) && /20\d{2}-\d{2}-\d{2}/u.test(body)) {
    return /\d+\.\d{2,8}/.test(text)
  }
  // Zhongtai/中泰 虚拟净值: 业务日期 YYYYMMDD + 单位净值 (no 净值日期 label).
  if (/业务日期/u.test(body) && /单位净值/u.test(body) && /20\d{6}/u.test(body)) {
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
  // Citics 【基金虚拟净值表现估值】 is a virtual-NAV mail, not a custody 估值表.
  if (!/虚拟净值表现估[算值]/u.test(subject) && /估值表|估值/i.test(subject)) return true
  return attachments.some((a) => {
    if (/虚拟净值表现估[算值]/u.test(a.filename)) return false
    return /估值表|估值|专用表/i.test(a.filename) || /\.zip$/i.test(a.filename)
  })
}

function hasLedger(subject: string, attachments: AttachmentInfo[]): boolean {
  if (/台账|份额明细|投资者明细|持有人明细/i.test(subject)) return true
  return attachments.some((a) => /台账|份额明细|投资者明细|持有人明细/i.test(a.filename))
}

function statusFor(predicate: boolean, relevant: boolean): ParseStepStatus {
  if (!relevant) return "失败"
  return predicate ? "成功" : "失败"
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
    valuationStatus: valuationRelevant ? "失败" : "失败",
    ledgerStatus: statusFor(ledgerRelevant, ledgerRelevant),
    parsedAt: new Date().toISOString(),
  }
}

type FetchMailboxResult = {
  parseRecords: Omit<EmailParseRecord, "id">[]
  navRecords: EmailNavInsert[]
  valuationRecords: EmailValuationInsert[]
  confirmRecords: EmailConfirmInsert[]
  skippedKnown: number
  downloaded: number
}

/** Stable key so IMAP UID reuse (new mail, same uid) is not skipped as "already parsed". */
function processedEmailKey(uid: string, subject: string): string {
  return `${String(uid).trim()}\0${subject.trim()}`
}

/**
 * Emails safe to skip on checkpoint polls: already stored as NAV/估值表 for the
 * same UID+subject. Parse-record-only rows are retried (extractor fixes), and
 * UID reuse with a different subject is re-downloaded.
 */
async function loadKnownProcessedEmailKeys(account: string): Promise<Set<string>> {
  const known = new Set<string>()
  const { query } = await import("@/lib/db")
  const navRows = await query<{
    email_uid: string
    subject: string | null
    n_codes: string | number
  }>(
    `SELECT email_uid, subject,
            COUNT(DISTINCT NULLIF(BTRIM(product_code), '')) AS n_codes
     FROM ops_email_nav_records
     WHERE lower(BTRIM(crawl_email_account)) = lower(BTRIM($1))
       AND NULLIF(BTRIM(email_uid), '') IS NOT NULL
     GROUP BY email_uid, subject`,
    [account],
  ).catch(() => [] as { email_uid: string; subject: string | null; n_codes: string | number }[])

  const incomplete = new Set<string>()
  for (const row of navRows) {
    const uid = String(row.email_uid).trim()
    if (!uid) continue
    const key = processedEmailKey(uid, row.subject ?? "")
    const nCodes = Number(row.n_codes ?? 0)
    // 等N个产品 mails ingested under the old single-product unique key must be
    // re-downloaded until every product_code is stored.
    if (isCmsMultiProductNavIncomplete(row.subject ?? "", nCodes)) {
      incomplete.add(key)
      continue
    }
    known.add(key)
  }

  const otherRows = await query<{ email_uid: string; subject: string | null }>(
    `SELECT email_uid, subject
     FROM (
       SELECT email_uid, subject FROM ops_email_valuation_records
       WHERE lower(BTRIM(crawl_email_account)) = lower(BTRIM($1))
       UNION
       SELECT email_uid, subject FROM ops_email_confirm_records
       WHERE lower(BTRIM(crawl_email_account)) = lower(BTRIM($1))
     ) t
     WHERE NULLIF(BTRIM(email_uid), '') IS NOT NULL`,
    [account],
  ).catch(async () => {
    return query<{ email_uid: string; subject: string | null }>(
      `SELECT email_uid, subject FROM ops_email_valuation_records
       WHERE lower(BTRIM(crawl_email_account)) = lower(BTRIM($1))
         AND NULLIF(BTRIM(email_uid), '') IS NOT NULL`,
      [account],
    ).catch(() => [] as { email_uid: string; subject: string | null }[])
  })
  for (const row of otherRows) {
    const uid = String(row.email_uid).trim()
    if (!uid) continue
    const key = processedEmailKey(uid, row.subject ?? "")
    if (incomplete.has(key)) continue
    known.add(key)
  }
  return known
}

async function downloadPart(client: ImapFlow, uid: string, part: string): Promise<Buffer> {
  // Tencent Exmail hangs on ImapFlow streaming download() for ~2MB 净值公告 zips.
  // fetchOne BODY[part] returns the wire bytes (often still base64).
  const msg = await client.fetchOne(
    String(uid),
    { uid: true, bodyParts: [part] },
    { uid: true },
  )
  const parts = (msg as { bodyParts?: Map<string, Buffer> }).bodyParts
  const raw = parts?.get(part) ?? parts?.get(String(part))
  if (!raw?.length) throw new Error(`empty IMAP part ${part}`)
  return decodeFetchedImapPart(raw)
}

function decodeFetchedImapPart(buf: Buffer): Buffer {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf) return buf
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return buf
  const head = buf.subarray(0, Math.min(buf.length, 80)).toString("ascii").replace(/\s+/g, "")
  if (/^(?:UEsDB|JVBERi|0M8R4K)/.test(head)) {
    return Buffer.from(buf.toString("ascii").replace(/\s+/g, ""), "base64")
  }
  return buf
}

async function fetchMailbox(
  account: CrawlEmailAccount,
  since: Date,
  errors: string[],
  signal?: AbortSignal,
  knownEmailKeys: Set<string> = new Set(),
): Promise<FetchMailboxResult> {
  throwIfAborted(signal)
  if (!account.pass?.trim()) {
    errors.push(`${account.account}: 未配置授权码`)
    return {
      parseRecords: [],
      navRecords: [],
      valuationRecords: [],
      confirmRecords: [],
      skippedKnown: 0,
      downloaded: 0,
    }
  }

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

  const parseRecords: Omit<EmailParseRecord, "id">[] = []
  const navRecords: EmailNavInsert[] = []
  const valuationRecords: EmailValuationInsert[] = []
  const confirmRecords: EmailConfirmInsert[] = []
  let skippedKnown = 0
  let downloaded = 0

  const folders = getImapFolders(account)

  await client.connect()
  try {
    for (const folder of folders) {
      throwIfAborted(signal)
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
        receiverEmail: string
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
          envelope?: {
            subject?: string
            date?: Date
            from?: EnvelopeAddress[]
            to?: EnvelopeAddress[]
            cc?: EnvelopeAddress[]
            bcc?: EnvelopeAddress[]
          }
        }).envelope
        const subject = envelope?.subject ?? ""
        const senderEmail = formatSenderEmail(envelope?.from)
        const receiverEmail = formatReceiverEmail(envelope)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const structure = (msg as any).bodyStructure
        if (!structure) continue

        const attachments = collectAttachments(structure)
        if (!isFundRelated(subject, attachments)) continue

        const textParts = collectTextParts(structure)
        const sentAt = (msg as { internalDate?: Date }).internalDate ?? envelope?.date ?? new Date()
        const uid = (msg as { uid?: number }).uid ?? 0

        candidates.push({
          uid,
          subject,
          sentAt,
          senderEmail,
          receiverEmail,
          structure,
          attachments,
          textParts,
        })
      }

      // ── Step 2: download body/attachments only for NEW fund-related emails ──
      // Known UIDs already have NAV/估值表 rows; keep envelope scan for discovery but
      // skip the expensive download so empty 5-minute polls finish in seconds.
      for (const { uid, subject, sentAt, senderEmail, receiverEmail, attachments, textParts } of candidates) {
        throwIfAborted(signal)
        if (knownEmailKeys.has(processedEmailKey(String(uid), subject))) {
          skippedKnown++
          continue
        }
        downloaded++
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
        const parseRecordIdx = parseRecords.length - 1

        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(uid),
          sentAt: sentAt.toISOString(),
          subject,
          senderEmail,
          receiverEmail,
        }

        const navKeysFromAttachments = new Set<string>()
        const navDatesFromAttachments = new Set<string>()
        let hasNavTableAttachment = false
        const attachmentNavKey = (productCode: string | null | undefined, navDate: string) =>
          `${(productCode ?? "").trim().toUpperCase()}|${navDate}`
        for (const att of selectNavTableAttachments(subject, attachments)) {
          hasNavTableAttachment = true
          try {
            const buf = await downloadPart(client, String(uid), att.part)
            const payloads: Array<{ storedFilename: string; parseFilename: string; buffer: Buffer }> =
              isNavTableZipFilename(att.filename, subject)
                ? expandNavTableZipBuffer(buf, att.filename).map((inner) => ({
                    storedFilename: zipInnerAttachmentKey(att.filename, inner.filename),
                    parseFilename: inner.filename,
                    buffer: inner.buffer,
                  }))
                : [{ storedFilename: att.filename, parseFilename: att.filename, buffer: buf }]

            if (payloads.length === 0 && isNavTableZipFilename(att.filename, subject)) {
              errors.push(`${account.account} UID ${uid} nav zip ${att.filename}: empty zip`)
              continue
            }

            for (const payload of payloads) {
              // Skip valuation workbooks accidentally packed into a 补发 zip.
              if (/估值表/i.test(payload.parseFilename)) continue
              const rows = /\.pdf$/i.test(payload.parseFilename)
                ? await extractNavFromCiticsAnnouncementPdf(
                    payload.buffer,
                    payload.parseFilename,
                    subject,
                  )
                : extractNavTableFromBuffer(
                    payload.buffer,
                    payload.parseFilename,
                    subject,
                  )
              for (const row of rows) {
                if (!row.navDate) continue
                navDatesFromAttachments.add(row.navDate)
                navKeysFromAttachments.add(attachmentNavKey(row.productCode, row.navDate))
                navRecords.push({
                  ...emailMeta,
                  ...row,
                  attachmentFilename: payload.storedFilename,
                })
              }
            }
          } catch (e) {
            errors.push(
              `${account.account} UID ${uid} attachment ${att.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }

        const valuationAttachments = selectValuationAttachments(subject, attachments)
        let valuationSavedForEmail = false
        for (const att of valuationAttachments) {
          try {
            const buf = await downloadPart(client, String(uid), att.part)
            const payloads: Array<{ storedFilename: string; parseFilename: string; buffer: Buffer }> = isValuationZipFilename(
              att.filename,
            )
              ? expandValuationZipBuffer(buf, att.filename).map((inner) => ({
                  storedFilename: zipInnerAttachmentKey(att.filename, inner.filename),
                  parseFilename: inner.filename,
                  buffer: inner.buffer,
                }))
              : [{ storedFilename: att.filename, parseFilename: att.filename, buffer: buf }]

            if (payloads.length === 0) {
              errors.push(`${account.account} UID ${uid} valuation ${att.filename}: empty zip`)
              continue
            }

            for (const payload of payloads) {
              const extracted = extractValuationFromBuffer(
                payload.buffer,
                payload.parseFilename,
                subject,
                senderEmail,
              )
              if (extracted) {
                valuationSavedForEmail = true
                valuationRecords.push({
                  ...emailMeta,
                  attachmentFilename: payload.storedFilename,
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
              } else if (!isValuationZipFilename(att.filename)) {
                errors.push(
                  `${account.account} UID ${uid} valuation ${payload.parseFilename}: no holdings parsed`,
                )
              }

              // When no 净值表 in this email, copy unit NAV from each 估值表 (including zip inner files).
              if (!hasNavTableAttachment) {
                const navRow =
                  extracted?.unitNav != null
                    ? {
                        nav: extracted.unitNav,
                        navDate: extracted.valuationDate,
                        cumulativeNav: extracted.cumulativeNav,
                        productCode: extracted.productCode,
                        fundName: extracted.fundName,
                        source: "attachment_valuation_table" as const,
                      }
                    : extractNavFromValuationBuffer(payload.buffer, payload.parseFilename, subject)
                if (
                  navRow?.navDate
                  && navRow.nav != null
                  && !navDatesFromAttachments.has(navRow.navDate)
                ) {
                  navDatesFromAttachments.add(navRow.navDate)
                  navRecords.push({
                    ...emailMeta,
                    ...navRow,
                    attachmentFilename: payload.storedFilename,
                  })
                }
              }
            }
          } catch (e) {
            errors.push(
              `${account.account} UID ${uid} valuation ${att.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }

        if (!valuationSavedForEmail && hasValuation(subject, attachments)) {
          const bodyExtracted = extractValuationFromEmailBody(bodyText, subject, senderEmail)
          if (bodyExtracted) {
            valuationSavedForEmail = true
            valuationRecords.push({
              ...emailMeta,
              attachmentFilename: "",
              productCode: bodyExtracted.productCode,
              fundName: bodyExtracted.fundName,
              valuationDate: bodyExtracted.valuationDate,
              unitNav: bodyExtracted.unitNav,
              cumulativeNav: bodyExtracted.cumulativeNav,
              custodyBalance: bodyExtracted.custodyBalance,
              netAssetValue: bodyExtracted.netAssetValue,
              paidInCapital: bodyExtracted.paidInCapital,
              totalAsset: bodyExtracted.totalAsset,
              totalLiability: bodyExtracted.totalLiability,
              custodian: bodyExtracted.custodian,
              netAsset: bodyExtracted.netAssetValue,
              underlyingHoldings: bodyExtracted.underlyingHoldings,
              holdingsCount: bodyExtracted.holdingsCount,
              source: bodyExtracted.source,
              summary: bodyExtracted.analysis.summary,
              holdings: bodyExtracted.analysis.portfolio_data,
            })
          }
        }

        if (hasValuation(subject, attachments) && parseRecordIdx >= 0) {
          parseRecords[parseRecordIdx].valuationStatus = valuationSavedForEmail ? "成功" : "失败"
        }

        for (const att of selectConfirmAttachments(subject, attachments)) {
          try {
            const buf = await downloadPart(client, String(uid), att.part)
            if (!buf.length) {
              errors.push(`${account.account} UID ${uid} confirm ${att.filename}: empty attachment`)
              continue
            }
            const parsed = await parseConfirmSlipFromBuffer(buf, att.filename, subject)
            confirmRecords.push({
              ...emailMeta,
              attachmentFilename: att.filename,
              buffer: buf,
              parsed,
            })
          } catch (e) {
            errors.push(
              `${account.account} UID ${uid} confirm ${att.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }

        const navHistory = extractNavHistoryFromBody(subject, bodyText)
        if (navHistory.length > 0) {
          for (const row of navHistory) {
            if (!row.navDate) continue
            // Skip only when the same product+date was already taken from the attachment
            // (CMS multi-product mails share dates across funds).
            if (navKeysFromAttachments.has(attachmentNavKey(row.productCode, row.navDate))) continue
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
                ? navKeysFromAttachments.has(attachmentNavKey(navData.productCode, navData.navDate))
                  || (navDatesFromAttachments.has(navData.navDate) && !navData.productCode)
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
    await closeImapFlow(client, { force: Boolean(signal?.aborted) })
  }

  return { parseRecords, navRecords, valuationRecords, confirmRecords, skippedKnown, downloaded }
}

export async function fetchEmailParseRecords(options?: {
  crawlEmailId?: string
  /** Explicit lookback for all mailboxes. Omit for nightly incremental (checkpoint-based). */
  days?: number
  /** Skip precomputed managed-product refresh (caller may run it in background). */
  skipNavLatestRefresh?: boolean
  /**
   * Intraday / checkpoint-poll mode: upsert NAV + 估值表 only.
   * Skips full rebuilds of holdings/metrics/FOF underlying (~thousands of funds).
   * Already-stored UID+subject NAV/估值表 pairs are not re-downloaded.
   */
  light?: boolean
  /** When aborted, stop IMAP/DB work promptly (scheduled ETL yield). */
  signal?: AbortSignal
}): Promise<EmailParseFetchResult> {
  const errors: string[] = []
  const incremental = options?.days == null
  const light = options?.light === true
  const signal = options?.signal

  throwIfAborted(signal)

  try {
    await ensureEmailConfirmTable()
  } catch (e) {
    errors.push(`初始化确认单表失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  const accounts: CrawlEmailAccount[] = []
  if (options?.crawlEmailId) {
    const one = await getCrawlEmailById(options.crawlEmailId)
    if (!one) throw new Error("抓取邮箱不存在")
    accounts.push(one)
  } else {
    for (const pub of await listCrawlEmails()) {
      const full = await getCrawlEmailByAccount(pub.account)
      if (full?.pass?.trim()) accounts.push(full)
    }
  }

  if (accounts.length === 0) {
    const configured = await listCrawlEmails()
    if (configured.length === 0) {
      throw new Error("请先在「抓取邮箱设置」中添加抓取邮箱")
    }
    throw new Error("抓取邮箱未配置授权码，请编辑邮箱并填写授权码")
  }

  const allParseRecords: Omit<EmailParseRecord, "id">[] = []
  const allNavRecords: EmailNavInsert[] = []
  const allValuationRecords: EmailValuationInsert[] = []
  const allConfirmRecords: EmailConfirmInsert[] = []
  let emailsScanned = 0
  let emailsSkippedKnown = 0
  let emailsDownloaded = 0
  // Track every account we attempted so records from un-attempted accounts
  // are preserved even if this run errors out for a particular mailbox.
  const scannedAccounts: string[] = accounts.map((a) => a.account)
  const scanSinceByAccount = new Map<string, Date>()
  const scanByAccount: Record<string, { since: string; mode: EmailParseScanMode }> = {}

  const historySentAt = maxSentAtByCrawlAccount(scannedAccounts)
  for (const account of accounts) {
    bootstrapEmailParseCursorIfMissing(
      account.account,
      historySentAt.get(account.account.trim().toLowerCase()) ?? null,
    )
  }

  for (const account of accounts) {
    throwIfAborted(signal)
    const acctKey = account.account.trim().toLowerCase()
    if (!account.pass?.trim()) {
      errors.push(`${account.account}: 未配置授权码`)
      continue
    }

    const { since, mode } = resolveAccountScanSince(account.account, options?.days)
    scanSinceByAccount.set(acctKey, since)
    scanByAccount[account.account] = { since: since.toISOString().slice(0, 10), mode }

    try {
      // Light/checkpoint polls skip re-download of UID+subject already stored as NAV/估值表.
      // Full/manual runs re-parse so repairs and attachment fixes still apply.
      const knownEmailKeys = light
        ? await loadKnownProcessedEmailKeys(account.account)
        : new Set<string>()
      const { parseRecords, navRecords, valuationRecords, confirmRecords, skippedKnown, downloaded } =
        await fetchMailbox(account, since, errors, signal, knownEmailKeys)
      emailsScanned += skippedKnown + downloaded
      emailsSkippedKnown += skippedKnown
      emailsDownloaded += downloaded
      allParseRecords.push(...parseRecords)
      allNavRecords.push(...navRecords)
      allValuationRecords.push(...valuationRecords)
      allConfirmRecords.push(...confirmRecords)
      // Persist credentials to shared DB after every successful scan so that
      // accounts added on any machine are automatically saved for all others.
      persistCrawlEmailAccount(account).catch(() => {})

      let maxSentAt: Date | null = null
      for (const row of parseRecords) {
        const sentAt = new Date(row.sentAt)
        if (!maxSentAt || sentAt > maxSentAt) maxSentAt = sentAt
      }
      // Only advance lastParsedSentAt when we actually parsed new mail. Skipped-known
      // polls still update lastScanCompletedAt via markAccountScanCompleted.
      markAccountScanCompleted(account.account, { mode, maxSentAt })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${account.account}: ${msg}`)
    }
  }

  throwIfAborted(signal)
  replaceEmailParseRecords(allParseRecords, scannedAccounts, scanSinceByAccount)

  let navSaved = 0
  try {
    throwIfAborted(signal)
    navSaved = await upsertEmailNavRecords(allNavRecords)
  } catch (e) {
    errors.push(`保存净值数据失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  let valuationSaved = 0
  let valuationHoldingsSaved = 0
  let confirmSaved = 0
  let valuationLatestHoldingsRefreshed = 0
  let valuationMetricsRefreshed = 0
  let underlyingMarketRefreshed = 0
  let managedFofUnderlyingRefreshed = 0
  let opsFofUnderlyingAdded = 0
  let detailFofUnderlyingAdded = 0
  let custodyValuationNavBackfilled = 0
  try {
    const valuationResult = await upsertEmailValuationRecords(allValuationRecords)
    valuationSaved = valuationResult.recordsSaved
    valuationHoldingsSaved = valuationResult.holdingsSaved
  } catch (e) {
    errors.push(`保存估值表数据失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    confirmSaved = await upsertEmailConfirmRecords(allConfirmRecords)
  } catch (e) {
    errors.push(`保存确认单失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Scoped custody NAV backfill: recent window for light/intraday, full history otherwise.
  // Skip on empty light polls — nothing new to copy into ops_email_nav_records.
  const lightHadNewRows =
    allNavRecords.length > 0 || allValuationRecords.length > 0 || allConfirmRecords.length > 0
  if (!light || lightHadNewRows) {
    try {
      const { backfillCustodyValuationNavFromRecords } = await import(
        "@/lib/server/email-valuation-nav-backfill"
      )
      const lookbackDays = light
        ? Math.max(options?.days ?? 3, 3)
        : undefined
      const sinceDate = lookbackDays != null
        ? (() => {
            const d = new Date()
            d.setUTCHours(0, 0, 0, 0)
            d.setUTCDate(d.getUTCDate() - lookbackDays)
            return d.toISOString().slice(0, 10)
          })()
        : undefined
      const backfill = await backfillCustodyValuationNavFromRecords(
        sinceDate ? { sinceDate } : undefined,
      )
      custodyValuationNavBackfilled = backfill.navBackfilled
    } catch (e) {
      errors.push(`估值表净值回填失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (!light) {
    try {
      const { refreshFundLatestValuationHoldings } = await import(
        "@/lib/server/email-valuation-holdings-pg"
      )
      valuationLatestHoldingsRefreshed = await refreshFundLatestValuationHoldings()
    } catch (e) {
      errors.push(`刷新最新估值持仓失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const { refreshEmailValuationMetricsLatest } = await import(
        "@/lib/server/email-valuation-metrics-pg"
      )
      const metrics = await refreshEmailValuationMetricsLatest()
      valuationMetricsRefreshed = metrics.fundMetricsRefreshed
      underlyingMarketRefreshed = metrics.underlyingMarketRefreshed
    } catch (e) {
      errors.push(`刷新估值指标快照失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const { refreshManagedFofUnderlying } = await import("@/lib/server/managed-fof-underlying-pg")
      managedFofUnderlyingRefreshed = await refreshManagedFofUnderlying()
    } catch (e) {
      errors.push(`刷新在管产品FOF底层持仓失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const { autoAddFofUnderlyingToTables } = await import(
        "@/lib/server/fof-underlying-auto-add-pg"
      )
      const autoAddResult = await autoAddFofUnderlyingToTables()
      opsFofUnderlyingAdded = autoAddResult.opsFofUnderlyingAdded
      detailFofUnderlyingAdded = autoAddResult.detailFofUnderlyingAdded
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Permission errors are expected until the DB grants are applied — don't surface
      // this as a user-visible failure since all core parsing steps have already completed.
      if (!msg.includes("permission denied")) {
        errors.push(`自动补充FOF底层产品失败: ${msg}`)
      } else {
        console.warn("[autoAddFofUnderlying] skipped — missing INSERT grant on FOF tables:", msg)
      }
    }
  }

  let navLatestRefreshed = 0
  let managedProductsValuationSynced = 0
  let fofUnderlyingMarketSynced = 0
  if (!options?.skipNavLatestRefresh && !light) {
    try {
      const { listCache, managedProductsValuationSynced: mpSync, fofUnderlyingMarketSynced: fofSync } =
        await refreshManagedProductsNavAndListCache()
      navLatestRefreshed = listCache
      managedProductsValuationSynced = mpSync
      fofUnderlyingMarketSynced = fofSync
    } catch (e) {
      errors.push(`刷新在管产品邮件净值失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const touchedByCode = new Map<string, { productCode: string; fundName: string }>()
  for (const row of [...allNavRecords, ...allValuationRecords]) {
    const productCode = (row.productCode ?? "").trim().toUpperCase()
    const fundName = (row.fundName ?? "").trim()
    if (!productCode && !fundName) continue
    const key = productCode || `name:${fundName}`
    if (!touchedByCode.has(key)) {
      touchedByCode.set(key, { productCode, fundName })
    }
  }

  return {
    emailsScanned,
    emailsSkippedKnown,
    emailsDownloaded,
    recordsFound: allParseRecords.length,
    navSaved,
    valuationSaved,
    valuationHoldingsSaved,
    confirmSaved,
    custodyValuationNavBackfilled,
    valuationLatestHoldingsRefreshed,
    valuationMetricsRefreshed,
    underlyingMarketRefreshed,
    managedFofUnderlyingRefreshed,
    opsFofUnderlyingAdded,
    detailFofUnderlyingAdded,
    managedProductsValuationSynced,
    fofUnderlyingMarketSynced,
    navLatestRefreshed,
    touchedFunds: [...touchedByCode.values()],
    errors,
    incremental,
    scanByAccount,
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
    const account = await getCrawlEmailByAccount(accountName)
    if (!account?.pass?.trim()) {
      errors.push(`${accountName}: 未配置授权码，无法补全发件邮箱`)
      continue
    }

    const client = createSafeImapFlow({
      host: account.imapHost,
      port: account.imapPort || 993,
      secure: true,
      auth: { user: account.account, pass: account.pass },
      logger: false,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
      label: accountName,
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
      await closeImapFlow(client)
    }
  }

  const updated = patchSenderEmails(patches)
  return { updated, errors }
}

export function needsSenderBackfill(): boolean {
  return countRecordsMissingSender() > 0
}
