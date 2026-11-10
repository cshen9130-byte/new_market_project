import { NextResponse } from "next/server"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
} from "@/lib/ma/auto-weekly-templates"
import {
  listTeamAutoWeeklyTemplateSubscriptions,
  setTeamAutoWeeklyTemplates,
} from "@/lib/server/auto-weekly-reports"
import { getRequestUser } from "@/lib/server/users"
import type { User } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!canAccessPfInvestmentPool(user as User | null)) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 })
  }

  const products = await listTeamAutoWeeklyTemplateSubscriptions()
  return NextResponse.json({
    templates: AUTO_WEEKLY_TEMPLATE_OPTIONS,
    defaultTemplateId: AUTO_WEEKLY_TEMPLATE_ID,
    data: products,
    total: products.length,
  })
}

/**
 * Body:
 *   { product_name: string, beian_hao?: string | null, templateId: string }
 *   or { templateId: string, products: Array<{ product_name: string, beian_hao?: string | null }> }
 */
export async function PATCH(req: Request) {
  const user = await getRequestUser(req)
  if (!canAccessPfInvestmentPool(user as User | null)) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 })
  }

  let body: {
    product_name?: string
    beian_hao?: string | null
    templateId?: string
    products?: Array<{ product_name?: string; beian_hao?: string | null }>
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const templateId = (body.templateId || "").trim()
  if (!templateId) {
    return NextResponse.json({ error: "templateId 必填" }, { status: 400 })
  }

  const targets = Array.isArray(body.products)
    ? body.products.map((row) => ({
        product_name: (row.product_name || "").trim(),
        beian_hao: row.beian_hao ?? null,
      }))
    : body.product_name
      ? [{ product_name: body.product_name.trim(), beian_hao: body.beian_hao ?? null }]
      : []

  if (targets.length === 0) {
    return NextResponse.json({ error: "product_name 或 products 必填" }, { status: 400 })
  }

  try {
    const result = setTeamAutoWeeklyTemplates(targets, templateId)
    const products = await listTeamAutoWeeklyTemplateSubscriptions()
    return NextResponse.json({
      ok: true,
      template: result.template,
      updated: result.updated,
      data: products,
      total: products.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status =
      message.includes("不支持") || message.includes("不能为空") || message.includes("请选择")
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
