import { NextResponse } from "next/server"
import { canAccessPfInvestmentPool } from "@/lib/permissions"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
} from "@/lib/ma/auto-weekly-templates"
import {
  listTeamAutoWeeklyTemplateSubscriptions,
  setTeamAutoWeeklyTemplate,
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

/** Body: { product_name: string, beian_hao?: string | null, templateId: string } */
export async function PATCH(req: Request) {
  const user = await getRequestUser(req)
  if (!canAccessPfInvestmentPool(user as User | null)) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 })
  }

  let body: { product_name?: string; beian_hao?: string | null; templateId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const product_name = (body.product_name || "").trim()
  const templateId = (body.templateId || "").trim()
  if (!product_name) {
    return NextResponse.json({ error: "product_name 必填" }, { status: 400 })
  }
  if (!templateId) {
    return NextResponse.json({ error: "templateId 必填" }, { status: 400 })
  }

  try {
    const template = setTeamAutoWeeklyTemplate(
      { product_name, beian_hao: body.beian_hao ?? null },
      templateId,
    )
    const products = await listTeamAutoWeeklyTemplateSubscriptions()
    return NextResponse.json({
      ok: true,
      template,
      data: products,
      total: products.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes("不支持") || message.includes("不能为空") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
