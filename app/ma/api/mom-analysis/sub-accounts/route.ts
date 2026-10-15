/**
 * Distinct MOM sub-accounts (rx000, rx319, …) from public.mom_daily_reports.
 * Read-only. Does not change the unfiltered MOM report.
 */
import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { accountNumericId } from "@/lib/ma/quant-accounts"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function labelScore(label: string): number {
  if (/^rx\d+$/.test(label)) return 3
  if (/^rx\d+$/i.test(label)) return 2
  if (/^rx/i.test(label)) return 1
  return 0
}

async function _GET() {
  try {
    const rows = await query<{ account: string; to_date: string | null }>(
      `SELECT TRIM("账户") AS account, MAX("交易日期")::text AS to_date
       FROM public.mom_daily_reports
       WHERE COALESCE(TRIM("账户"::text), '') <> ''
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
       GROUP BY TRIM("账户")`,
    )

    const byId = new Map<string, { account: string; toDate: string | null }>()
    for (const row of rows) {
      const id = accountNumericId(row.account)
      if (!id) continue
      const prev = byId.get(id)
      if (!prev || labelScore(row.account) > labelScore(prev.account)) {
        byId.set(id, { account: row.account, toDate: row.to_date })
      } else if (row.to_date && (!prev.toDate || row.to_date > prev.toDate)) {
        prev.toDate = row.to_date
      }
    }

    const accounts = [...byId.values()].sort((a, b) => {
      const diff = Number(accountNumericId(a.account)) - Number(accountNumericId(b.account))
      if (diff !== 0) return diff
      return a.account.localeCompare(b.account, "zh")
    })
    return NextResponse.json({ ok: true, accounts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist") || msg.includes("mom_daily_reports")) {
      return NextResponse.json({ ok: true, accounts: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("mom-sub-accounts", _GET)
