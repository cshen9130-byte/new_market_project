/**
 * One-time SQX078 gap fill: 【虚拟净值】 emails between 2026-05-30 and 2026-06-14.
 * Fast — single product, no FOF/valuation rebuilds.
 *
 * Usage (on server):
 *   cd ~/new_market_project
 *   npx tsx scripts/ma/_backfill_sqx078_gap.ts
 *
 * Scans only ch_c7h8@163.com by default (~1–3 min). Set SQX078_GAP_ACCOUNT=all to scan every mailbox.
 */
import { loadProjectEnvFiles, configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const BEIAN = "SQX078"
const GAP_START = "2026-05-30"
const GAP_END = "2026-06-14"
const SINCE = new Date("2026-05-29T00:00:00+08:00")
const SUBJECT_RE = /【虚拟净值】\s*SQX078_/u

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
  const mode = (process.env.SQX078_GAP_ACCOUNT ?? "ch_c7h8@163.com").trim()
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
    socketTimeout: 60_000,
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
      if (uids.length === 0) continue

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      )) {
        const envelope = (msg as { envelope?: { subject?: string; date?: Date; from?: { address?: string }[] } }).envelope
        const subject = envelope?.subject ?? ""
        if (!SUBJECT_RE.test(subject)) continue

        const subjectDate = subjectNavDate(subject)
        if (subjectDate && (subjectDate < GAP_START || subjectDate > GAP_END)) continue

        matchedSubjects++
        const uid = (msg as { uid?: number }).uid ?? 0
        const structure = (msg as { bodyStructure?: unknown }).bodyStructure
        if (!structure) continue

        const sentAt = (msg as { internalDate?: Date }).internalDate ?? envelope?.date ?? new Date()
        const senderEmail = envelope?.from?.[0]?.address?.trim() ?? ""
        const attachments = collectAttachments(structure)
        const textParts = collectTextParts(structure)

        const chunks: string[] = [subject]
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

        const emailMeta = {
          crawlEmailAccount: account.account,
          emailUid: String(uid),
          sentAt: sentAt.toISOString(),
          subject,
          senderEmail,
        }

        const navDates = new Set<string>()
        for (const att of selectNavTableAttachments(subject, attachments)) {
          try {
            const buf = await downloadPart(uid, att.part)
            for (const row of extractNavTableFromBuffer(buf, att.filename, subject)) {
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

        const bodyNav = extractNavData(subject, bodyText)
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

  console.log(`[${account.account}] matched SQX078 virtual subjects: ${matchedSubjects}`)
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

  const allRows: EmailNavInsert[] = []
  for (const account of accounts) {
    console.log(`scanning ${account.account} since ${SINCE.toISOString().slice(0, 10)}…`)
    const rows = await fetchSqx078GapFromMailbox(account)
    allRows.push(...rows)
  }

  const byDate = new Map<string, EmailNavInsert>()
  for (const row of allRows) {
    if (!row.navDate || !inGap(row.navDate)) continue
    if (row.nav == null || row.nav <= 0) continue
    byDate.set(row.navDate, row)
  }
  const deduped = [...byDate.values()].sort((a, b) => a.navDate.localeCompare(b.navDate))
  console.log(`parsed ${deduped.length} gap rows:`, deduped.map((r) => ({
    date: r.navDate,
    unit: r.nav,
    cum: r.cumulativeNav,
  })))

  if (deduped.length === 0) {
    console.log("No gap emails found in mailbox — nothing to insert.")
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
