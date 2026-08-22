/**
 * Request-scoped 监控中心 资金账号 / named-book filter for 单账户 APIs.
 * Empty / "all" = every imported account (组合汇总).
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { bookSource, listImportBooks, sourceFilesForBook, type ImportBookSource } from "@/lib/server/account-risk-books"

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
  source?: ImportBookSource
  cfmmcUserId?: string | null
}

/** Imported books only, grouped by 拖入 / 邮箱 / 监控中心. No leftover 资金账号 stubs. */
export async function listCfmmcAccounts(): Promise<CfmmcAccountOption[]> {
  return listImportBooks()
    .filter((book) => book.files.length > 0)
    .map((book) => ({
      accountNo: `book:${book.id}`,
      label: book.name,
      clientName: null,
      companyName: null,
      fromDate: book.createdAt.slice(0, 10),
      toDate: null,
      equity: 0,
      imported: true,
      linked: false,
      kind: "book" as const,
      source: bookSource(book),
      cfmmcUserId: book.cfmmcUserId ?? null,
    }))
}
