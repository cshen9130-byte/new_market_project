import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { query } from "@/lib/db"
import { listCrawlEmails } from "@/lib/server/crawl-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OWN_COMPANY = "上海荣熙私募基金管理有限公司"
const EMAIL_RECORDS_FILE = path.join(process.cwd(), "data", "ops_email_parse_records.json")

/** Known counterparty investors seen in virtual-NAV mail (fallback when email scan is cold). */
const SEED_INVESTORS = ["上海明曜恒盈私募基金管理有限公司"]

type InvestorRow = { id: string; name: string }

let emailInvestorCache: { mtimeMs: number; names: string[] } | null = null

function push(out: InvestorRow[], seen: Set<string>, name: string | null | undefined, id?: string) {
  const trimmed = (name || "").trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  out.push({ id: id || trimmed, name: trimmed })
}

function extractInvestorsFromSubjects(subjects: string[]): string[] {
  const found = new Set<string>()
  for (const subject of subjects) {
    const matches = subject.matchAll(
      /_([^_《》【】\s]{4,80}?(?:私募基金管理有限公司|资产管理有限公司|投资管理有限公司))_/g,
    )
    for (const m of matches) {
      const name = m[1]?.trim()
      if (name) found.add(name)
    }
  }
  return Array.from(found)
}

async function loadInvestorNamesFromEmails(): Promise<string[]> {
  try {
    const stat = await fs.stat(EMAIL_RECORDS_FILE)
    if (emailInvestorCache && emailInvestorCache.mtimeMs === stat.mtimeMs) {
      return emailInvestorCache.names
    }
    const raw = await fs.readFile(EMAIL_RECORDS_FILE, "utf-8")
    const parsed = JSON.parse(raw) as { records?: { subject?: string }[] }
    const rows = parsed.records ?? []
    const subjects = rows
      .map((r) => r.subject || "")
      .filter((s) => /虚拟计提|虚拟净值/.test(s) && /有限公司/.test(s))
      .slice(0, 3000)
    const names = extractInvestorsFromSubjects(subjects)
    emailInvestorCache = { mtimeMs: stat.mtimeMs, names }
    return names
  } catch {
    return []
  }
}

async function loadManagedProductInvestors(): Promise<string[]> {
  try {
    const rows = await query<{ product_name: string; short_name: string | null }>(
      `SELECT
         m.product_name,
         c.short_name
       FROM managed_products m
       LEFT JOIN ops_managed_products_list_cache c ON c.managed_product_id = m.id
       WHERE m.product_name <> '合计'
       ORDER BY m.sequence_no ASC NULLS LAST
       LIMIT 80`,
    )
    return rows
      .map((row) => {
        const short = (row.short_name || row.product_name || "").trim()
        if (!short) return ""
        return `${OWN_COMPANY}－${short}`
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const keyword = (searchParams.get("keyword") || "").trim().toLowerCase()

    const out: InvestorRow[] = []
    const seen = new Set<string>()

    for (const row of await listCrawlEmails()) {
      push(out, seen, row.account, row.id)
    }

    for (const name of SEED_INVESTORS) {
      push(out, seen, name)
    }

    for (const name of await loadInvestorNamesFromEmails()) {
      push(out, seen, name)
    }

    for (const name of await loadManagedProductInvestors()) {
      push(out, seen, name)
    }

    const filtered = keyword
      ? out.filter((row) => row.name.toLowerCase().includes(keyword))
      : out

    return NextResponse.json({
      data: filtered.slice(0, 80),
      total: filtered.length,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
