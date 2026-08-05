import { NextResponse } from "next/server"
import {
  normalizeSpliceFunds,
  type CustomFundNavGenerationRule,
  type NavGenRuleType,
} from "@/lib/custom-fund-nav-rules-types"
import {
  assertCustomFundNavRuleAccess,
  clearCustomFundNavGenerationRule,
  saveCustomFundNavGenerationRule,
} from "@/lib/server/custom-fund-nav-rules"
import { generateCustomFundNavFromRule } from "@/lib/server/custom-fund-nav-generate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserId(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

function normalizeMomExtraDates(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const row = item as Partial<{ date: string; fixed_item: string; non_fixed_item: string }>
    return {
      date: String(row.date ?? "").trim(),
      fixed_item: String(row.fixed_item ?? "").trim(),
      non_fixed_item: String(row.non_fixed_item ?? "").trim(),
    }
  })
}

function isNumericValue(value: string): boolean {
  if (!value.trim()) return false
  return Number.isFinite(parseFloat(value))
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { code, action, rule } = body as {
    code?: string
    action?: "save" | "clear"
    rule?: Partial<CustomFundNavGenerationRule>
  }

  const productCode = (code || "").trim()
  if (!productCode) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 })
  }

  const fund = assertCustomFundNavRuleAccess(productCode, currentUserId(req) || undefined)
  if (!fund) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  if (action === "clear") {
    clearCustomFundNavGenerationRule(productCode)
    return NextResponse.json({ ok: true })
  }

  const ruleType = (rule?.rule_type ?? "splice") as NavGenRuleType
  const annualReturnRate = String(rule?.annual_return_rate ?? "").trim()
  const momProductName = String(rule?.mom_product_name ?? "").trim()
  const momFixedItem = String(rule?.mom_fixed_item ?? "").trim()
  const momNonFixedItem = String(rule?.mom_non_fixed_item ?? "").trim()
  const momExtraDates = normalizeMomExtraDates(rule?.mom_extra_dates)
  const funds = normalizeSpliceFunds(rule?.funds, String(rule?.start_date ?? "").trim())
  const startDate = String(
    ruleType === "splice"
      ? (funds[0]?.start_date || rule?.start_date || "")
      : (rule?.start_date ?? ""),
  ).trim()

  if (action === "save") {
    if (!startDate) {
      return NextResponse.json({ error: "missing_start_date" }, { status: 400 })
    }
    if (ruleType === "splice") {
      const active = funds.filter((f) => f.product_name)
      if (active.length < 2) {
        return NextResponse.json({ error: "missing_funds" }, { status: 400 })
      }
      for (let i = 0; i < active.length; i += 1) {
        if (!active[i].start_date) {
          return NextResponse.json({
            error: "missing_fund_dates",
            message: `请填写基金${i + 1}的开始日期`,
          }, { status: 400 })
        }
        if (i < active.length - 1 && !active[i].end_date) {
          return NextResponse.json({
            error: "missing_fund_dates",
            message: `请填写基金${i + 1}的结束日期`,
          }, { status: 400 })
        }
      }
    }
    if (ruleType === "fixed_income") {
      const rate = parseFloat(annualReturnRate)
      if (!annualReturnRate || Number.isNaN(rate)) {
        return NextResponse.json({ error: "missing_annual_return_rate" }, { status: 400 })
      }
    }
    if (ruleType === "mom_long") {
      if (!momProductName) {
        return NextResponse.json({ error: "missing_mom_product" }, { status: 400 })
      }
      if (!isNumericValue(momFixedItem) || !isNumericValue(momNonFixedItem)) {
        return NextResponse.json({ error: "missing_mom_adjustments" }, { status: 400 })
      }
    }
    const saved = saveCustomFundNavGenerationRule(productCode, {
      rule_type: ruleType,
      start_date: startDate,
      funds,
      annual_return_rate: annualReturnRate,
      mom_product_name: momProductName,
      mom_fixed_item: momFixedItem,
      mom_non_fixed_item: momNonFixedItem,
      mom_extra_dates: momExtraDates,
    })
    const generated = await generateCustomFundNavFromRule(productCode, saved)
    if (!generated.ok) {
      return NextResponse.json({ error: "generate_failed", message: generated.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true, rule: saved, generated_count: generated.count })
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 })
}
