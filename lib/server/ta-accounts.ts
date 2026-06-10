import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { query } from "@/lib/db"

export type TaAccountSource = "邮箱抓取" | "手动添加"
export type TaAccountLinkType = "fof" | "investor"

export type TaAccountRecord = {
  id: string
  customerName: string
  taAccount: string
  linkType: TaAccountLinkType | null
  fofRegisterNumber: string | null
  fofProductName: string | null
  investorName: string | null
  source: TaAccountSource
  crawlEmailId: string | null
  createdAt: string
  updatedAt: string
}

export type TaAccountPublic = TaAccountRecord

export type TaParseLog = {
  id: string
  crawlEmailAccount: string
  fetchedAt: string
  emailsScanned: number
  recordsFound: number
  recordsInserted: number
  recordsUpdated: number
  message: string
  details: string[]
}

const ACCOUNTS_FILE = path.join(process.cwd(), "data", "ops_ta_accounts.json")
const PARSE_LOGS_FILE = path.join(process.cwd(), "data", "ops_ta_parse_logs.json")

function readAccounts(): TaAccountRecord[] {
  if (!fs.existsSync(ACCOUNTS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8")) as TaAccountRecord[]
  } catch {
    return []
  }
}

function writeAccounts(rows: TaAccountRecord[]): void {
  const dir = path.dirname(ACCOUNTS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(rows, null, 2), "utf-8")
}

function readParseLogs(): TaParseLog[] {
  if (!fs.existsSync(PARSE_LOGS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(PARSE_LOGS_FILE, "utf-8")) as TaParseLog[]
  } catch {
    return []
  }
}

function writeParseLogs(rows: TaParseLog[]): void {
  const dir = path.dirname(PARSE_LOGS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PARSE_LOGS_FILE, JSON.stringify(rows.slice(0, 200), null, 2), "utf-8")
}

function accountKey(customerName: string, taAccount: string): string {
  return `${customerName.trim().toLowerCase()}|${taAccount.trim().toUpperCase()}`
}

export function listTaAccounts(q?: string): TaAccountPublic[] {
  const keyword = (q ?? "").trim().toLowerCase()
  let rows = readAccounts()
  if (keyword) {
    rows = rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(keyword) ||
        r.taAccount.toLowerCase().includes(keyword) ||
        (r.fofProductName ?? "").toLowerCase().includes(keyword),
    )
  }
  return rows.sort((a, b) => a.customerName.localeCompare(b.customerName, "zh-CN"))
}

export function getTaAccountById(id: string): TaAccountRecord | null {
  return readAccounts().find((r) => r.id === id) ?? null
}

export function createTaAccountManual(input: {
  customerName: string
  taAccount: string
}): TaAccountPublic {
  const customerName = input.customerName.trim()
  const taAccount = input.taAccount.trim()
  if (!customerName) throw new Error("客户名称不能为空")

  const rows = readAccounts()
  const key = accountKey(customerName, taAccount)
  const existing = rows.find((r) => accountKey(r.customerName, r.taAccount) === key)
  if (existing) throw new Error("该 TA 账号已存在")

  const now = new Date().toISOString()
  const row: TaAccountRecord = {
    id: randomUUID(),
    customerName,
    taAccount,
    linkType: null,
    fofRegisterNumber: null,
    fofProductName: null,
    investorName: null,
    source: "手动添加",
    crawlEmailId: null,
    createdAt: now,
    updatedAt: now,
  }
  rows.push(row)
  writeAccounts(rows)
  return row
}

export function updateTaAccount(
  id: string,
  patch: {
    linkType?: TaAccountLinkType | null
    fofRegisterNumber?: string | null
    fofProductName?: string | null
    investorName?: string | null
  },
): TaAccountPublic | null {
  const rows = readAccounts()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx === -1) return null

  const current = rows[idx]
  const next: TaAccountRecord = {
    ...current,
    updatedAt: new Date().toISOString(),
  }

  if ("linkType" in patch) {
    next.linkType = patch.linkType ?? null
    if (patch.linkType === "fof") {
      next.investorName = null
    } else if (patch.linkType === "investor") {
      next.fofRegisterNumber = null
      next.fofProductName = null
    } else if (patch.linkType == null) {
      next.fofRegisterNumber = null
      next.fofProductName = null
      next.investorName = null
    }
  }

  if ("fofRegisterNumber" in patch) next.fofRegisterNumber = patch.fofRegisterNumber ?? null
  if ("fofProductName" in patch) next.fofProductName = patch.fofProductName ?? null
  if ("investorName" in patch) next.investorName = patch.investorName ?? null

  rows[idx] = next
  writeAccounts(rows)
  return next
}

export function deleteTaAccount(id: string): boolean {
  const rows = readAccounts()
  const row = rows.find((r) => r.id === id)
  if (!row) return false
  if (row.source !== "手动添加") return false
  writeAccounts(rows.filter((r) => r.id !== id))
  return true
}

export type ParsedTaRow = {
  customerName: string
  taAccount: string
}

export type UpsertFromCrawlResult = {
  inserted: number
  updated: number
}

export type ReplaceCrawledResult = {
  inserted: number
  removed: number
}

/** Replace all email-crawled rows with freshly parsed data; keep manual entries. */
export function replaceCrawledRows(
  parsed: ParsedTaRow[],
  crawlEmailId: string,
): ReplaceCrawledResult {
  const rows = readAccounts()
  const manual = rows.filter((r) => r.source === "手动添加")
  const removed = rows.filter((r) => r.source === "邮箱抓取").length

  const byCustomer = new Map<string, ParsedTaRow>()
  for (const item of parsed) {
    const customerName = item.customerName.trim()
    const taAccount = item.taAccount.trim().toUpperCase()
    if (!customerName || !taAccount) continue
    byCustomer.set(customerName, { customerName, taAccount })
  }

  const now = new Date().toISOString()
  const crawled: TaAccountRecord[] = [...byCustomer.values()].map((item) => ({
    id: randomUUID(),
    customerName: item.customerName,
    taAccount: item.taAccount,
    linkType: null,
    fofRegisterNumber: null,
    fofProductName: null,
    investorName: null,
    source: "邮箱抓取" as const,
    crawlEmailId,
    createdAt: now,
    updatedAt: now,
  }))

  writeAccounts([...manual, ...crawled])
  return { inserted: crawled.length, removed }
}

/** Insert or update email-crawled rows; never overwrite manual entries. */
export function upsertCrawledRows(
  parsed: ParsedTaRow[],
  crawlEmailId: string,
): UpsertFromCrawlResult {
  const rows = readAccounts()
  const byKey = new Map(rows.map((r) => [accountKey(r.customerName, r.taAccount), r]))
  let inserted = 0
  let updated = 0
  const now = new Date().toISOString()

  for (const item of parsed) {
    const customerName = item.customerName.trim()
    const taAccount = item.taAccount.trim().toUpperCase()
    if (!customerName || !taAccount) continue

    const key = accountKey(customerName, taAccount)
    const existing = byKey.get(key)

    if (!existing) {
      const row: TaAccountRecord = {
        id: randomUUID(),
        customerName,
        taAccount,
        linkType: null,
        fofRegisterNumber: null,
        fofProductName: null,
        investorName: null,
        source: "邮箱抓取",
        crawlEmailId,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(row)
      byKey.set(key, row)
      inserted++
      continue
    }

    if (existing.source === "手动添加") continue

    existing.customerName = customerName
    existing.taAccount = taAccount
    existing.crawlEmailId = crawlEmailId
    existing.updatedAt = now
    updated++
  }

  writeAccounts(rows)
  return { inserted, updated }
}

let fofCache: { loadedAt: number; rows: { register_number: string; product_name: string }[] } | null = null

async function loadFofProducts(): Promise<{ register_number: string; product_name: string }[]> {
  const now = Date.now()
  if (fofCache && now - fofCache.loadedAt < 5 * 60_000) return fofCache.rows
  const rows = await query<{ register_number: string; product_name: string }>(
    `SELECT register_number, product_name FROM fof_mom_tracking ORDER BY product_name`,
  )
  fofCache = { loadedAt: now, rows }
  return rows
}

function normalizeFundLabel(name: string): string {
  return name
    .replace(/私募证券投资基金$/u, "")
    .replace(/证券投资基金$/u, "")
    .replace(/\s+/g, "")
    .trim()
}

function isEmailLike(name: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name.trim())
}

export async function matchFofForCustomerName(
  customerName: string,
): Promise<{ register_number: string; product_name: string } | null> {
  const trimmed = customerName.trim()
  if (!trimmed || isEmailLike(trimmed)) return null

  const fofs = await loadFofProducts()
  const normalizedCustomer = normalizeFundLabel(trimmed)

  let best: { register_number: string; product_name: string; score: number } | null = null

  for (const fof of fofs) {
    const normalizedFof = normalizeFundLabel(fof.product_name)
    let score = 0

    if (trimmed === fof.product_name) score = 100
    else if (normalizedCustomer === normalizedFof) score = 95
    else if (trimmed.includes(fof.product_name) || fof.product_name.includes(trimmed)) score = 90
    else if (
      normalizedCustomer.includes(normalizedFof) ||
      normalizedFof.includes(normalizedCustomer)
    ) {
      score = 80
    } else {
      const shorter =
        normalizedCustomer.length <= normalizedFof.length ? normalizedCustomer : normalizedFof
      const longer =
        normalizedCustomer.length > normalizedFof.length ? normalizedCustomer : normalizedFof
      if (shorter.length >= 6 && longer.startsWith(shorter)) score = 70
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { ...fof, score }
    }
  }

  return best && best.score >= 70 ? { register_number: best.register_number, product_name: best.product_name } : null
}

export async function autoLinkFofProducts(): Promise<number> {
  const rows = readAccounts()
  let linked = 0
  const now = new Date().toISOString()

  for (const row of rows) {
    if (row.linkType === "investor") continue
    if (row.fofRegisterNumber && row.fofProductName) continue

    const match = await matchFofForCustomerName(row.customerName)
    if (!match) continue

    row.linkType = "fof"
    row.fofRegisterNumber = match.register_number
    row.fofProductName = match.product_name
    row.updatedAt = now
    linked++
  }

  if (linked > 0) writeAccounts(rows)
  return linked
}

export function appendParseLog(log: Omit<TaParseLog, "id">): TaParseLog {
  const entry: TaParseLog = { id: randomUUID(), ...log }
  const logs = readParseLogs()
  logs.unshift(entry)
  writeParseLogs(logs)
  return entry
}

export function listParseLogs(limit = 50): TaParseLog[] {
  return readParseLogs().slice(0, limit)
}
