import { NextResponse } from "next/server"
import type { FundSpliceEntry } from "@/lib/custom-fund-nav-rules-types"
import { assertCustomFundNavRuleAccess } from "@/lib/server/custom-fund-nav-rules"
import { suggestSpliceTailDate } from "@/lib/server/custom-fund-nav-generate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { code, start_date, fund1, fund2 } = body as {
    code?: string
    start_date?: string
    fund1?: Partial<FundSpliceEntry>
    fund2?: Partial<FundSpliceEntry>
  }

  const productCode = (code || "").trim()
  if (!productCode) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 })
  }

  const fund = assertCustomFundNavRuleAccess(productCode, currentUserId(req) || undefined)
  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const normalizeFund = (row: Partial<FundSpliceEntry> | undefined): FundSpliceEntry => ({
    fund_category: String(row?.fund_category ?? "私募基金"),
    product_name: String(row?.product_name ?? "").trim(),
    nav_source: String(row?.nav_source ?? "平台净值"),
    tail_nav_date: String(row?.tail_nav_date ?? "").trim(),
  })

  const result = await suggestSpliceTailDate(
    String(start_date ?? "").trim(),
    normalizeFund(fund1),
    normalizeFund(fund2),
  )

  if (!result.ok) {
    return NextResponse.json({ error: "suggest_failed", message: result.error }, { status: 400 })
  }

  return NextResponse.json(result)
}
