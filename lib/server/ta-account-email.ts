import * as XLSX from "xlsx"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"
import {
  getCrawlEmailByAccount,
  getCrawlEmailById,
  listCrawlEmails,
  type CrawlEmailAccount,
} from "@/lib/server/crawl-emails"
import {
  appendParseLog,
  replaceCrawledRows,
  type ParsedTaRow,
} from "@/lib/server/ta-accounts"

export type TaAccountFetchResult = {
  emailsScanned: number
  recordsFound: number
  inserted: number
  updated: number
  linked: number
  log: string[]
  errors: string[]
}

const TA_ACCOUNT_RE = /^[A-Z]{1,2}\d{10,14}$/
const FUND_SUFFIX_RE = /(?:私募证券投资基金|证券投资基金)$/
const CUSTOMER_NAME_CAPTURE =
  /([\u4e00-\u9fffA-Za-z0-9（）()·\-—－]+(?:私募证券投资基金|证券投资基金))/u

type BodyPart = { part: string; filename: string; mime: string }
type ParsedCandidate = ParsedTaRow & { score: number }

function collectTextParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: BodyPart[] = [],
): BodyPart[] {
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
    out.push({ part: pathStr || "1", filename: fname || fullMime, mime: fullMime })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectTextParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

function collectSpreadsheetParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: BodyPart[] = [],
): BodyPart[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  const disp: string = (node.disposition ?? "").toLowerCase()
  if (fname && (disp === "attachment" || fname)) {
    const lower = fname.toLowerCase()
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      out.push({ part: pathStr || "1", filename: fname, mime: "application/vnd.ms-excel" })
    }
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectSpreadsheetParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
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

function cleanCustomerName(raw: string): string {
  return raw
    .replace(/\s*基金代码.*$/u, "")
    .replace(/\s*净值日期.*$/u, "")
    .replace(/^[：:\s]+/u, "")
    .replace(/\s+/g, "")
    .trim()
}

function isValidCustomerName(name: string): boolean {
  if (!name || name.length < 6) return false
  if (name.includes("基金代码") || name.includes("净值日期") || name.includes("虚拟业绩")) return false
  if (!FUND_SUFFIX_RE.test(name)) return false
  return true
}

function scoreTaAccount(ta: string): number {
  // S580* = 客户/FOF 在托管行的 TA 账号；S188* 常见于虚拟业绩报酬附件中的底层基金账号
  if (/^S580\d{8}$/.test(ta)) return 110
  if (/^S\d{11}$/.test(ta)) return 70
  if (/^S\d{10,14}$/.test(ta)) return 60
  if (/^JA\d{10,14}$/i.test(ta)) return 20
  return 50
}

function pickBestTaAccount(accounts: string[]): string {
  const unique = [...new Set(accounts.map((a) => a.trim().toUpperCase()).filter((a) => TA_ACCOUNT_RE.test(a)))]
  unique.sort((a, b) => scoreTaAccount(b) - scoreTaAccount(a))
  return unique[0] ?? ""
}

function scanSpreadsheetForTaAccounts(buf: Buffer): string[] {
  const accounts: string[] = []
  try {
    const wb = XLSX.read(buf, { type: "buffer" })
    for (const sheetName of wb.SheetNames) {
      const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" })
      for (const row of rows) {
        for (const cell of row) {
          const s = String(cell).trim().toUpperCase()
          if (TA_ACCOUNT_RE.test(s)) accounts.push(s)
        }
      }
    }
  } catch {
    // ignore bad workbook
  }
  return accounts
}

function parseVirtualFeeSubject(subject: string): string | null {
  const m = subject.match(/^虚拟业绩报酬_(.+?)_[A-Z0-9]+_.+_\d{4}-\d{2}-\d{2}/u)
  const name = cleanCustomerName(m?.[1] ?? "")
  return isValidCustomerName(name) ? name : null
}

function parseEstimateSubject(subject: string): string | null {
  const m = subject.match(/【基金虚拟净值表现估[算值]】[^_]+_.+_\d{4}-\d{2}-\d{2}_(.+)$/u)
  const name = cleanCustomerName(m?.[1] ?? "")
  return isValidCustomerName(name) ? name : null
}

function parseTaVirtualNavBracketCustomer(subject: string): string | null {
  for (const m of subject.matchAll(/【([^】]+)】/gu)) {
    const inner = cleanCustomerName(m[1] ?? "")
    const fundMatch = inner.match(CUSTOMER_NAME_CAPTURE)
    const candidate = fundMatch?.[1] ?? inner
    if (isValidCustomerName(candidate)) return candidate
  }
  return null
}

/** 国泰海通 TA虚拟净值：客户姓名 + 交易账号(S) 或 基金账号(JA，低优先级) */
function parseTaVirtualNavBody(subject: string, body: string): ParsedCandidate | null {
  const text = body.replace(/\r/g, "\n")
  let customerName = ""

  const customerPatterns = [
    /客户姓名\s*[：:]\s*([^\n]+?)(?=\s*基金名称|\s*基金代码|\n|$)/u,
    /客户名称\s*[：:]\s*([^\n]+?)(?=\s*基金名称|\s*基金代码|\n|$)/u,
    /客户姓名\s+((?:[\u4e00-\u9fffA-Za-z0-9（）()·\-—－]+)?(?:私募证券投资基金|证券投资基金))/u,
  ]
  for (const re of customerPatterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const candidate = cleanCustomerName(m[1])
      if (isValidCustomerName(candidate)) {
        customerName = candidate
        break
      }
    }
  }
  if (!customerName) customerName = parseTaVirtualNavBracketCustomer(subject) ?? ""

  const taAccounts: string[] = []
  const taPatterns = [
    /交易账号\s*[：:]\s*([A-Z]{1,2}\d{10,14})/giu,
    /交易账号\s+([A-Z]{1,2}\d{10,14})/giu,
    /基金账号\s*[：:]\s*([A-Z]{1,2}\d{10,14})/giu,
    /基金账号\s+([A-Z]{1,2}\d{10,14})/giu,
    /基金账号([A-Z]{1,2}\d{10,14})/giu,
  ]
  for (const re of taPatterns) {
    for (const m of text.matchAll(re)) {
      if (m[1]) taAccounts.push(m[1].trim().toUpperCase())
    }
  }

  const taAccount = pickBestTaAccount(taAccounts)
  if (!isValidCustomerName(customerName) || !taAccount) return null

  return {
    customerName,
    taAccount,
    score: 30 + scoreTaAccount(taAccount),
  }
}

function isRelevantEmail(subject: string): boolean {
  return (
    subject.includes("TA虚拟净值") ||
    subject.startsWith("虚拟业绩报酬_") ||
    /【基金虚拟净值表现估[算值]】/u.test(subject)
  )
}

function mergeCandidates(candidates: ParsedCandidate[]): ParsedTaRow[] {
  const byCustomer = new Map<string, ParsedCandidate>()
  for (const row of candidates) {
    const existing = byCustomer.get(row.customerName)
    if (!existing || row.score > existing.score) {
      byCustomer.set(row.customerName, row)
    }
  }
  return [...byCustomer.values()]
    .map(({ customerName, taAccount }) => ({ customerName, taAccount }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName, "zh-CN"))
}

async function fetchMailbox(
  account: CrawlEmailAccount,
  log: string[],
  errors: string[],
): Promise<{ parsed: ParsedTaRow[]; emailsScanned: number }> {
  if (!account.pass?.trim()) {
    errors.push(`${account.account}: 未配置授权码`)
    return { parsed: [], emailsScanned: 0 }
  }

  const client = createSafeImapFlow({
    host: account.imapHost,
    port: account.imapPort || 993,
    secure: true,
    auth: { user: account.account, pass: account.pass },
    logger: false,
    label: account.account,
  })

  const candidates: ParsedCandidate[] = []
  let emailsScanned = 0

  try {
    await client.connect()
    await client.mailboxOpen("INBOX")
    const since = new Date()
    since.setDate(since.getDate() - 180)

    const uids = (await client.search({ since })) || []
    log.push(`${account.account}: 最近 180 天共 ${uids.length} 封邮件`)

    for (const uid of uids) {
      const envMsg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true })
      const envelope = (envMsg as { envelope?: { subject?: string } }).envelope
      const subject = envelope?.subject ?? ""
      if (!isRelevantEmail(subject)) continue

      emailsScanned++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structure = (envMsg as any).bodyStructure
      if (!structure) continue

      if (subject.startsWith("虚拟业绩报酬_")) {
        const customerName = parseVirtualFeeSubject(subject)
        if (!customerName) continue
        const sheets = collectSpreadsheetParts(structure)
        const accounts: string[] = []
        for (const { part } of sheets) {
          try {
            const dl = await client.download(String(uid), part)
            const bufs: Buffer[] = []
            for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
            accounts.push(...scanSpreadsheetForTaAccounts(Buffer.concat(bufs)))
          } catch (e) {
            errors.push(`${account.account} UID ${uid}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        const taAccount = pickBestTaAccount(accounts)
        if (taAccount) {
          candidates.push({ customerName, taAccount, score: 100 + scoreTaAccount(taAccount) })
        }
        continue
      }

      if (/【基金虚拟净值表现估[算值]】/u.test(subject)) {
        const customerName = parseEstimateSubject(subject)
        if (!customerName) continue
        const sheets = collectSpreadsheetParts(structure)
        const accounts: string[] = []
        for (const { part } of sheets) {
          try {
            const dl = await client.download(String(uid), part)
            const bufs: Buffer[] = []
            for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
            accounts.push(...scanSpreadsheetForTaAccounts(Buffer.concat(bufs)))
          } catch (e) {
            errors.push(`${account.account} UID ${uid}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        const taAccount = pickBestTaAccount(accounts)
        if (taAccount) {
          candidates.push({ customerName, taAccount, score: 140 + scoreTaAccount(taAccount) })
        }
        continue
      }

      if (subject.includes("TA虚拟净值")) {
        const textParts = collectTextParts(structure)
        const chunks: string[] = [subject]
        for (const { part, mime } of textParts) {
          try {
            const dl = await client.download(String(uid), part)
            const bufs: Buffer[] = []
            for await (const chunk of dl.content) bufs.push(Buffer.from(chunk))
            const buf = Buffer.concat(bufs)
            if (mime.includes("text/html")) chunks.push(stripHtml(buf.toString("utf-8")))
            else chunks.push(buf.toString("utf-8"))
          } catch (e) {
            errors.push(`${account.account} UID ${uid}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        const row = parseTaVirtualNavBody(subject, chunks.join("\n"))
        if (row) candidates.push(row)
      }
    }
  } finally {
    await closeImapFlow(client)
  }

  return { parsed: mergeCandidates(candidates), emailsScanned }
}

export async function fetchTaAccountsFromEmails(crawlEmailId?: string): Promise<TaAccountFetchResult> {
  const log: string[] = []
  const errors: string[] = []
  let emailsScanned = 0
  let recordsFound = 0
  let inserted = 0

  const accounts: CrawlEmailAccount[] = []
  if (crawlEmailId) {
    const one = await getCrawlEmailById(crawlEmailId)
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

  for (const account of accounts) {
    try {
      const result = await fetchMailbox(account, log, errors)
      emailsScanned += result.emailsScanned
      recordsFound += result.parsed.length
      log.push(`${account.account}: 解析到 ${result.parsed.length} 条 TA 记录`)
      for (const row of result.parsed) {
        log.push(`  → ${row.customerName} / ${row.taAccount}`)
      }

      const replace = replaceCrawledRows(result.parsed, account.id)
      inserted += replace.inserted

      appendParseLog({
        crawlEmailAccount: account.account,
        fetchedAt: new Date().toISOString(),
        emailsScanned: result.emailsScanned,
        recordsFound: result.parsed.length,
        recordsInserted: replace.inserted,
        recordsUpdated: replace.removed,
        message:
          result.parsed.length > 0
            ? `解析 ${result.parsed.length} 条客户产品，替换邮箱抓取记录 ${replace.removed} 条`
            : "未在相关邮件中找到客户姓名/TA账号",
        details: log.slice(-30),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${account.account}: ${msg}`)
      log.push(`${account.account}: 抓取失败 — ${msg}`)
    }
  }

  return { emailsScanned, recordsFound, inserted, updated: 0, linked: 0, log, errors }
}
