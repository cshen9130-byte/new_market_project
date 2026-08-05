import { NextResponse } from "next/server"
import {
  DEFAULT_SPLICE_FUNDS,
  normalizeSpliceFunds,
  type CustomFundNavGenerationRule,
} from "@/lib/custom-fund-nav-rules-types"
import {
  assertCustomFundNavRuleAccess,
  getCustomFundNavGenerationRule,
} from "@/lib/server/custom-fund-nav-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const code = (searchParams.get("code") || "").trim()
    if (!code) {
      return NextResponse.json({ error: "missing_code" }, { status: 400 })
    }

    const fund = assertCustomFundNavRuleAccess(code, currentUserId(req) || undefined)
    if (!fund) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const rule = getCustomFundNavGenerationRule(code)
    const defaultRule: CustomFundNavGenerationRule = {
      rule_type: "splice",
      start_date: "",
      funds: DEFAULT_SPLICE_FUNDS.map((row) => ({ ...row })),
      annual_return_rate: "",
      mom_product_name: "",
      mom_fixed_item: "",
      mom_non_fixed_item: "",
      mom_extra_dates: [],
      updated_at: "",
    }
    const resolved = rule ?? defaultRule
    return NextResponse.json({
      rule: {
        ...resolved,
        funds: normalizeSpliceFunds(resolved.funds, resolved.start_date),
      },
    })
  } catch (err) {
    console.error("[custom-funds/nav-rules GET]", err)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
