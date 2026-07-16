/**
 * One-time SQX078 gap fill: 【虚拟净值】 emails between 2026-05-30 and 2026-06-14.
 * Fast — single product, no FOF/valuation rebuilds.
 *
 * Usage (on server):
 *   cd ~/new_market_project
 *   npx tsx scripts/ma/_backfill_sqx078_gap.ts
 *
 * Scans preferred mailboxes (ch_c7h8, cwsj, custodiandata) by default.
 * Set SQX078_GAP_ACCOUNT=ch_c7h8@163.com to limit to one mailbox.
 */
import { loadProjectEnvFiles, configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const BEIAN = "SQX078"
const GAP_START = "2026-05-30"
const GAP_END = "2026-06-14"
const SINCE = new Date("2026-05-29T00:00:00+08:00")
/** Underscore or space after code — GJDF uses both. */
const SUBJECT_RE = /【虚拟净值】\s*SQX078(?:[\s_])/u

const PREFERRED_ACCOUNTS = ["ch_c7h8@163.com", "cwsj@hengyifund.cn", "custodiandata@citics.com"]

type AttachmentInfo = { filename: string; part: string }

type EmailNavInsert = {
  crawlEmailAccount: string
  emailUid: string
  sentAt: string
  subject: string
  senderEmail: string
  navDate: string
  nav: number | null
  cumulativeNav: number | null
  adjustedNav: number | null
  productCode: string
  fundName: string
  source: string
  attachmentFilename: string
}

type CrawlEmailAccount = {
  account: string
  pass: string
  imapHost: string
  imapPort: number
  imapFolders?: string[]
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function collectAttachments(structure: unknown, prefix = ""): AttachmentInfo[] {
  if (!structure || typeof structure !== "object") return []
  const node = structure as {
    disposition?: string
    dispositionParameters?: { filename?: string }
    parameters?: { name?: string }
    childNodes?: unknown[]
    part?: string
  }
  const out: AttachmentInfo[] = []
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? ""
  const part = prefix || node.part || "1"
  if (node.disposition === "attachment" && filename) {
    out.push({ filename, part })
  }
  const children = node.childNodes ?? []
  for (let i = 0; i < children.length; i++) {
    const childPart = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
    out.push(...collectAttachments(children[i], childPart))
  }
  return out
}

function collectTextParts(structure: unknown, prefix = ""): { part: string; mime: string }[] {
  if (!structure || typeof structure !== "object") return []
  const node = structure as {
    type?: string
    subtype?: string
    childNodes?: unknown[]
    part?: string
  }
  const out: { part: string; mime: string }[] = []
  const mime = `${node.type ?? "text"}/${node.subtype ?? "plain"}`
  const part = prefix || node.part || "1"
  if (node.type === "text" && (node.subtype === "plain" || node.subtype === "html")) {
    out.push({ part, mime })
  }
  const children = node.childNodes ?? []
  for (let i = 0; i < children.length; i++) {
    const childPart = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
    out.push(...collectTextParts(children[i], childPart))
  }
  return out
}

function subjectNavDate(subject: string): string | null {
  const m = subject.match(/(\d{4}-\d{2}-\d{2})\s*$/)
  return m?.[1] ?? null
}

function inGap(navDate: string | null | undefined): boolean {
  if (!navDate) return false
  return navDate >= GAP_START && navDate <= GAP_END
}

async function resolveAccounts(): Promise<CrawlEmailAccount[]> {
  const { getCrawlEmailByAccount, listCrawlEmails } = await import("@/lib/server/crawl-emails")
  const mode = (process.env.SQX078_GAP_ACCOUNT ?? "all").trim()
  if (mode.toLowerCase() === "all") {
    const out: CrawlEmailAccount[] = []
    const seen = new Set<string>()
    for (const acct of PREFERRED_ACCOUNTS) {
      const row = getCrawlEmailByAccount(acct)
      if (row?.pass?.trim()) {
        out.push(row)
        seen.add(row.account.trim().toLowerCase())
      }
    }
    for (const pub of listCrawlEmails()) {
      const key = pub.account.trim().toLowerCase()
      if (seen.has(key)) continue
      const row = getCrawlEmailByAccount(pub.account)
      if (row?.pass?.trim()) {
        out.push(row)
        seen.add(key)
      }
    }
    return out
  }

  const row = getCrawlEmailByAccount(mode)
  if (row?.pass?.trim()) return [row]
  throw new Error(`Mailbox not configured: ${mode}`)
}

async function fetchSqx078GapFromMailbox(account: CrawlEmailAccount): Promise<EmailNavInsert[]> {
  const { ImapFlow } = await import("imapflow")
  const { getImapFolders } = await import("@/lib/server/crawl-emails")
  const { extractNavData } = await import("@/lib/server/email-nav-extract")
  const { extractNavTableFromBuffer, selectNavTableAttachments } = await import(
    "@/lib/server/email-nav-attachment"
  )

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 180_000,
  })

  client.on("error", (err: Error) => {
    console.error(`[${account.account}] IMAP socket:`, err.message)
  })

  const navRecords: EmailNavInsert[] = []
  let matchedSubjects = 0

  const downloadPart = async (uid: number, part: string): Promise<Buffer> => {
    const dl = await client.download(String(uid), part, { uid: true })
    const bufs: Buffer[] = []
    for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
    return Buffer.concat(bufs)
  }

  await client.connect()
  try {
    for (const folder of getImapFolders(account)) {
      await client.mailboxOpen(folder)
      const uids = (await client.search({ since: SINCE }, { uid: true })) || []
      console.log(`[${account.account}/${folder}] since ${SINCE.toISOString().slice(0, 10)}: ${uids.length} uids`)
      if (uids.length === 0) continue

      // Phase 1: envelope-only scan — avoid downloading bodyStructure for thousands of emails.
      type MatchMeta = {
        uid: number
        subject: string
        sentAt: Date
        senderEmail: string
      }
      const matches: MatchMeta[] = []

      for await (const msg of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const envelope = (msg as { envelope?: { subject?: string; date?: Date; from?: { address?: string }[] } }).envelope
        const subject = envelope?.subject ?? ""
        if (!SUBJECT_RE.test(subject)) continue

        const subjectDate = subjectNavDate(subject)
        if (subjectDate && (subjectDate < GAP_START || subjectDate > GAP_END)) continue

        matchedSubjects++
        const uid = (msg as { uid?: number }).uid ?? 0
        const sentAt = (msg as { internalDate?: Date }).internalDate ?? envelope?.date ?? new Date()
        const senderEmail = envelope?.from?.[0]?.address?.trim() ?? ""
        matches.push({ uid, subject, sentAt, senderEmail })
      }

      console.log(`[${account.account}/${folder}] gap subject matches: ${matches.length}`)
      if (matches.length === 0) continue

      // Phase 2: download body + attachments one UID at a time (avoids batch socket timeout).
      for (const meta of matches) {
        let structure: unknown
        try {
          for await (const msg of client.fetch(
            meta.uid,
            { uid: true, bodyStructure: true },
            { uid: true },
          )) {
            structure = (msg as { bodyStructure?: unknown }).bodyStructure
          }
        } catch (err) {
          console.error(`[${account.account}] UID ${meta.uid} fetch failed:`, err instanceof Error ? err.message : err)
          continue
        }
        if (!structure) continue

        const uid = meta.uid
        const attachments = collectAttachments(structure)
        const textParts = collectTextParts(structure)
        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(uid),
          sentAt: meta.sentAt.toISOString(),
          subject: meta.subject,
          senderEmail: meta.senderEmail,
        }

        const chunks: string[] = [meta.subject]
        for (const { part, mime } of textParts) {
          try {
            const buf = await downloadPart(uid, part)
            const text = buf.toString("utf-8")
            chunks.push(mime.includes("text/html") ? stripHtml(text) : text)
          } catch {
            // skip part
          }
        }
        const bodyText = chunks.join("\n")

        const navDates = new Set<string>()
        for (const att of selectNavTableAttachments(meta.subject, attachments)) {
          try {
            const buf = await downloadPart(uid, att.part)
            for (const row of extractNavTableFromBuffer(buf, att.filename, meta.subject)) {
              if (!row.navDate || !inGap(row.navDate)) continue
              navDates.add(row.navDate)
              navRecords.push({
                ...emailMeta,
                nav: row.nav,
                navDate: row.navDate,
                cumulativeNav: row.cumulativeNav,
                adjustedNav: row.adjustedNav,
                productCode: BEIAN,
                fundName: row.fundName ?? "特夫郁金香全量化私募证券投资基金",
                source: "attachment_nav_table",
                attachmentFilename: att.filename,
              })
            }
          } catch {
            // skip attachment
          }
        }

        const bodyNav = extractNavData(meta.subject, bodyText)
        if (bodyNav?.navDate && inGap(bodyNav.navDate) && !navDates.has(bodyNav.navDate)) {
          navRecords.push({
            ...emailMeta,
            nav: bodyNav.nav,
            navDate: bodyNav.navDate,
            cumulativeNav: bodyNav.cumulativeNav,
            adjustedNav: bodyNav.adjustedNav,
            productCode: BEIAN,
            fundName: bodyNav.fundName ?? "特夫郁金香全量化私募证券投资基金",
            source: bodyNav.source,
            attachmentFilename: "",
          })
        }
      }
    }
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }

  console.log(`[${account.account}] matched SQX078 virtual subjects: ${matchedSubjects}, parsed rows: ${navRecords.length}`)
  return navRecords
}

async function main() {
  const { query } = await import("@/lib/db")
  const { upsertEmailNavRecords } = await import("@/lib/server/email-nav-pg")
  const {
    loadPrivateFundLegacyNavRows,
    loadEmailNavSeries,
    mergeNavSeriesWithEmail,
  } = await import("@/lib/server/email-nav-query")

  const before = await query<{ nav_date: string; nav: string; cumulative_nav: string }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
       AND nav_date BETWEEN $2::date AND $3::date
     ORDER BY nav_date`,
    [BEIAN, GAP_START, GAP_END],
  )
  console.log("existing gap rows:", before)

  const accounts = await resolveAccounts()
  if (accounts.length === 0) throw new Error("No crawl mailboxes with passwords configured")
  console.log("mailboxes:", accounts.map((a) => a.account).join(", "))

  const allRows: EmailNavInsert[] = []
  for (const account of accounts) {
    console.log(`\nscanning ${account.account}…`)
    try {
      const rows = await fetchSqx078GapFromMailbox(account)
      allRows.push(...rows)
    } catch (err) {
      console.error(`[${account.account}] IMAP error:`, err instanceof Error ? err.message : err)
    }
  }

  const byDate = new Map<string, EmailNavInsert>()
  for (const row of allRows) {
    if (!row.navDate || !inGap(row.navDate)) continue
    if (row.nav == null || row.nav <= 0) continue
    byDate.set(row.navDate, row)
  }
  const deduped = [...byDate.values()].sort((a, b) => a.navDate.localeCompare(b.navDate))
  console.log(`\nparsed ${deduped.length} gap rows:`, deduped.map((r) => ({
    date: r.navDate,
    unit: r.nav,
    cum: r.cumulativeNav,
  })))

  if (deduped.length === 0) {
    console.log("No gap emails found — nothing to insert.")
    return
  }

  const saved = await upsertEmailNavRecords(deduped)
  console.log("upserted:", saved)

  const after = await query<{ nav_date: string; nav: string; cumulative_nav: string }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
       AND nav_date BETWEEN $2::date AND $3::date
     ORDER BY nav_date`,
    [BEIAN, GAP_START, GAP_END],
  )
  console.log("gap rows after upsert:", after)

  const legacy = await loadPrivateFundLegacyNavRows(
    BEIAN,
    "特夫郁金香全量化私募证券投资基金",
    "特夫郁金香全量化",
  )
  const email = await loadEmailNavSeries(
    BEIAN,
    "特夫郁金香全量化私募证券投资基金",
    "特夫郁金香全量化",
  )
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const window = merged.filter((r) => r.price_date >= "2026-05-25" && r.price_date <= "2026-06-20")
  console.log("\nmerged series (May 25 – Jun 20):")
  for (const r of window) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
