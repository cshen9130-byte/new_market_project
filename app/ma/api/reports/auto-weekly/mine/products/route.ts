import { NextResponse } from "next/server"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
} from "@/lib/ma/auto-weekly-templates"
import {
  addMineWeeklyProduct,
  addMineWeeklyProductAndGenerate,
  listMineWeeklyProducts,
  removeMineWeeklyProduct,
  setMineWeeklyProductTemplate,
} from "@/lib/server/auto-weekly-mine-reports"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }
  const products = listMineWeeklyProducts(user.id)
  return NextResponse.json({
    data: products,
    total: products.length,
    templates: AUTO_WEEKLY_TEMPLATE_OPTIONS,
    defaultTemplateId: AUTO_WEEKLY_TEMPLATE_ID,
  })
}

/** Body: { product_name: string, beian_hao?: string | null, generate?: boolean } */
export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }

  let body: {
    product_name?: string
    beian_hao?: string | null
    templateId?: string | null
    generate?: boolean
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const product_name = (body.product_name || "").trim()
  if (!product_name) {
    return NextResponse.json({ error: "product_name 必填" }, { status: 400 })
  }

  const beian_hao = body.beian_hao ?? null
  const templateId = body.templateId ?? null
  const generate = body.generate !== false
  const creator = user.name || user.email || "我"

  try {
    if (generate) {
      const result = await addMineWeeklyProductAndGenerate(user.id, creator, {
        product_name,
        beian_hao,
        templateId,
      })
      return NextResponse.json({
        ok: true,
        product: result.product,
        etl: result.etl,
        products: listMineWeeklyProducts(user.id),
      })
    }

    const product = addMineWeeklyProduct(user.id, { product_name, beian_hao, templateId })
    return NextResponse.json({ ok: true, product, products: listMineWeeklyProducts(user.id) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

/** Body: { product_name: string, beian_hao?: string | null } */
export async function DELETE(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
  }

  let body: { product_name?: string; beian_hao?: string | null } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  const product_name = (body.product_name || "").trim()
  if (!product_name) {
    return NextResponse.json({ error: "product_name 必填" }, { status: 400 })
  }

  const removed = removeMineWeeklyProduct(user.id, {
    product_name,
    beian_hao: body.beian_hao ?? null,
  })
  return NextResponse.json({
    ok: removed,
    products: listMineWeeklyProducts(user.id),
  })
}

/** Body: { product_name: string, beian_hao?: string | null, templateId: string } */
export async function PATCH(req: Request) {
  const user = await getRequestUser(req)
  if (!user?.id) {
    return NextResponse.json({ error: "请先登录", code: "unauthorized" }, { status: 401 })
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
    const product = setMineWeeklyProductTemplate(
      user.id,
      { product_name, beian_hao: body.beian_hao ?? null },
      templateId,
    )
    return NextResponse.json({
      ok: true,
      product,
      products: listMineWeeklyProducts(user.id),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status =
      message.includes("不支持") || message.includes("不能为空") || message.includes("未加入")
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
