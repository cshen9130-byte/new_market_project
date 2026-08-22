/**
 * Request-scoped 监控中心 资金账号 / named-book filter for 单账户 APIs.
 * Empty / "all" = every imported account (组合汇总).
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { publicQuery } from "@/lib/db"
import { sourceFilesForBook } from "@/lib/server/account-risk-books"
import { listImportBooks } from "@/lib/server/account-risk-books"
import { publicCfmmcConfig } from "@/lib/server/account-risk-import"

type Scope = { account: string | null; book: string | null }
const als = new AsyncLocalStorage<Scope>()
const ACCOUNT_RE = /^[A-Za-z0-9_-]{4,32}$/
const BOOK_RE = /^[a-z][a-z0-9_-]{2,40}$/

function parseScope(req: Request): Scope {
  try {
    const url = new URL(req.url)
    const rawAccount = (url.searchParams.get("account") || req.headers.get("x-cfmmc-account") || "").trim()
    const rawBook = (url.searchParams.get("book") || req.headers.get("x-cfmmc-book") || "").trim()
    const book = rawBook && BOOK_RE.test(rawBook) ? rawBook : null
    const account = !book && rawAccount && rawAccount !== "all" && rawAccount !== "*" && ACCOUNT_RE.test(rawAccount)
      ? rawAccount
      : null
    return { account, book }
  } catch {
    return { account: null, book: null }
  }
}

export function getCfmmcAccount(): string | null {
  return als.getStore()?.account ?? null
}

export function getCfmmcBook(): string | null {
  return als.getStore()?.book ?? null
}

export function withCfmmcAccount<H extends (req: Request) => Promise<Response>>(handler: H): H {
  return (async (req: Request) => als.run(parseScope(req), () => handler(req))) as H
}

/** `account_no = $n` or TRUE. Pushes onto params. */
export function accountEq(params: unknown[], col = "account_no"): string {
  const a = getCfmmcAccount()
  if (!a) return "TRUE"
  params.push(a)
  return `${col} = $${params.length}`
}

/** ` AND account_no = $n` or "". Pushes onto params. */
export function andAccount(params: unknown[], col = "account_no"): string {
  const a = getCfmmcAccount()
  if (!a) return ""
  params.push(a)
  return ` AND ${col} = $${params.length}`
}

/** Filter rows that came from a named import book's files. */
export function andSourceBook(params: unknown[], col = "source_file"): string {
  const book = getCfmmcBook()
  if (!book) return ""
  const files = sourceFilesForBook(book)
  if (files.length === 0) return " AND FALSE"
  params.push(files)
  const n = params.length
  if (book === "ungrouped") return ` AND ${col} = ANY($${n}::text[])`
  params.push(`${book}/%`)
  return ` AND (${col} = ANY($${n}::text[]) OR ${col} LIKE $${n + 1})`
}

export function scopeWhere(params: unknown[], accountCol = "account_no", fileCol = "source_file"): string {
  const acct = accountEq(params, accountCol)
  return `${acct}${andSourceBook(params, fileCol)}`
}

/** ` AND account_no = $n AND source_file …` or "". */
export function andScope(params: unknown[], accountCol = "account_no", fileCol = "source_file"): string {
  return `${andAccount(params, accountCol)}${andSourceBook(params, fileCol)}`
}

export type CfmmcAccountOption = {
  accountNo: string
  label: string
  clientName: string | null
  companyName: string | null
  fromDate: string | null
  toDate: string | null
  equity: number
  imported: boolean
  linked: boolean
  kind?: "account" | "book"
}

function fileBase(rel: string): string {
  const n = rel.replace(/\\/g, "/")
  const i = n.lastIndexOf("/")
  return i >= 0 ? n.slice(i + 1) : n
}

/** 资金账号 whose settlement files already belong to a user-named book. */
async function accountNosCoveredByNamedBooks(): Promise<Set<string>> {
  const named = listImportBooks().filter((b) => b.id !== "ungrouped" && b.files.length > 0)
  if (named.length === 0) return new Set()
  const prefixes = named.map((b) => `${b.id}/`)
  const exact = new Set<string>()
  for (const b of named) {
    for (const f of sourceFilesForBook(b.id)) {
      if (f.endsWith("%")) continue
      const n = f.replace(/\\/g, "/")
      exact.add(n)
      exact.add(fileBase(n))
    }
  }
  const rows = await publicQuery(`
    SELECT account_no, source_file
    FROM public.cfmmc_daily_summary
    WHERE source_file IS NOT NULL AND TRIM(source_file) <> ''
  `).catch(() => ({ rows: [] }))
  const covered = new Set<string>()
  for (const r of rows.rows as { account_no: string; source_file: string }[]) {
    const accountNo = String(r.account_no ?? "").trim()
    const src = String(r.source_file ?? "").replace(/\\/g, "/")
    if (!accountNo || !src) continue
    if (exact.has(src) || exact.has(fileBase(src)) || prefixes.some((p) => src.startsWith(p))) {
      covered.add(accountNo)
    }
  }
  return covered
}

export async function listCfmmcAccounts(): Promise<CfmmcAccountOption[]> {
  const imported = await publicQuery(`
    SELECT s.account_no,
           NULLIF(TRIM(s.client_name), '') AS client_name,
           NULLIF(TRIM(s.company_name), '') AS company_name,
           e.from_date, e.to_date,
           s.client_equity::text AS equity
    FROM public.cfmmc_daily_summary s
    JOIN (
      SELECT account_no,
             MIN(trade_date)::text AS from_date,
             MAX(trade_date)::text AS to_date
      FROM public.cfmmc_daily_summary
      GROUP BY account_no
    ) e ON e.account_no = s.account_no AND s.trade_date::text = e.to_date
    ORDER BY s.account_no
  `).catch(() => ({ rows: [] }))

  const hiddenAccounts = await accountNosCoveredByNamedBooks()
  const linked = publicCfmmcConfig().accounts
  const linkedByUser = new Map(linked.map((a) => [a.userId.trim(), a]))

  const out: CfmmcAccountOption[] = []
  for (const book of listImportBooks()) {
    if (book.files.length === 0 && book.id === "ungrouped") continue
    out.push({
      accountNo: `book:${book.id}`,
      label: book.name,
      clientName: null,
      companyName: null,
      fromDate: book.createdAt.slice(0, 10),
      toDate: null,
      equity: 0,
      imported: book.files.length > 0,
      linked: false,
      kind: "book",
    })
  }
  const seen = new Set<string>()
  for (const r of imported.rows as {
    account_no: string
    client_name: string | null
    company_name: string | null
    from_date: string | null
    to_date: string | null
    equity: string | null
  }[]) {
    const accountNo = String(r.account_no ?? "").trim()
    if (!accountNo || hiddenAccounts.has(accountNo)) continue
    seen.add(accountNo)
    const link = linkedByUser.get(accountNo)
    out.push({
      accountNo,
      label: link?.label?.trim() || r.client_name || accountNo,
      clientName: r.client_name,
      companyName: r.company_name,
      fromDate: r.from_date,
      toDate: r.to_date,
      equity: Number(r.equity) || 0,
      imported: true,
      linked: !!link,
      kind: "account",
    })
  }
  for (const a of linked) {
    const accountNo = a.userId.trim()
    if (!accountNo || seen.has(accountNo) || hiddenAccounts.has(accountNo)) continue
    out.push({
      accountNo,
      label: a.label?.trim() || accountNo,
      clientName: null,
      companyName: null,
      fromDate: a.lastFetchDate,
      toDate: a.lastFetchDate,
      equity: 0,
      imported: false,
      linked: true,
    })
  }
  return out
}
