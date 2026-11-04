import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { sourceFilesForBook } from "@/lib/server/account-risk-books"
import { runTraderProfile } from "@/lib/server/trader-profile-run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const ACCOUNT_RE = /^[A-Za-z0-9_-]{2,40}$/
const BOOK_RE = /^[a-z][a-z0-9_-]{2,40}$/

function bookIdOf(raw: string): string | null {
  const id = raw.startsWith("book:") ? raw.slice(5) : raw
  return BOOK_RE.test(id) ? id : null
}

async function accountInCfmmc(accountNo: string): Promise<string> {
  const found = await publicQuery<{ account_no: string }>(
    `SELECT account_no
     FROM public.cfmmc_daily_summary
     WHERE LOWER(account_no) = LOWER($1)
     LIMIT 1`,
    [accountNo],
  )
  return found.rows[0]?.account_no ?? ""
}

async function accountForBook(bookId: string): Promise<string> {
  const files = sourceFilesForBook(bookId).filter((f) => !f.endsWith("/%"))
  const like = bookId === "ungrouped" ? null : `${bookId}/%`
  if (files.length === 0 && !like) return ""
  const params: unknown[] = []
  const parts: string[] = []
  if (files.length > 0) {
    params.push(files)
    parts.push(`source_file = ANY($${params.length}::text[])`)
  }
  if (like) {
    params.push(like)
    parts.push(`source_file LIKE $${params.length}`)
  }
  const found = await publicQuery<{ account_no: string }>(
    `SELECT account_no
     FROM public.cfmmc_daily_summary
     WHERE ${parts.join(" OR ")}
     GROUP BY account_no
     ORDER BY COUNT(*) DESC, MAX(trade_date) DESC
     LIMIT 1`,
    params,
  )
  return found.rows[0]?.account_no ?? ""
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const rawAccount = (url.searchParams.get("account") || "").trim()
  const rawBook = (url.searchParams.get("book") || "").trim()

  let account = ""
  if (rawAccount && ACCOUNT_RE.test(rawAccount) && !rawAccount.toLowerCase().startsWith("book")) {
    account = await accountInCfmmc(rawAccount)
  }

  const bookRaw = rawBook || (rawAccount.toLowerCase().startsWith("book:") ? rawAccount : "")
  const bookId = bookRaw ? bookIdOf(bookRaw) : null
  if (!account && bookId) account = await accountForBook(bookId)

  if (!account || !ACCOUNT_RE.test(account)) {
    return NextResponse.json({ error: "请先选择一个已导入结算单的单账户" }, { status: 400 })
  }

  const forwarded = new URL(req.url)
  forwarded.searchParams.set("account", account)
  forwarded.searchParams.delete("book")
  return runTraderProfile(new Request(forwarded.toString(), { method: "GET" }), { source: "cfmmc" })
}
