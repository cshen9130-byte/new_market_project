import { NextResponse } from "next/server"
import { isProductCategory, type ProductCategory } from "@/lib/ma/lookthrough-compliance-types"
import {
  resolveManagedProductIdByBeian,
  saveLookthroughProductCategories,
  type LookthroughCategoryItem,
} from "@/lib/server/lookthrough-product-categories"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUserName(req: Request, bodyName?: unknown): string {
  const header = String(req.headers.get("x-market-user-name") || "").trim()
  if (header) {
    try {
      return decodeURIComponent(header)
    } catch {
      return header
    }
  }
  return typeof bodyName === "string" ? bodyName.trim() : ""
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      items?: Array<{ product_id?: unknown; beian_hao?: unknown; category?: unknown }>
      beian_hao?: unknown
      category?: unknown
      user_name?: unknown
    }
    const items: LookthroughCategoryItem[] = []

    if (Array.isArray(body.items)) {
      for (const raw of body.items) {
        const productId = Number(raw.product_id)
        const category = String(raw.category ?? "")
        if (!Number.isFinite(productId) || productId <= 0 || !isProductCategory(category)) continue
        items.push({
          product_id: productId,
          beian_hao: typeof raw.beian_hao === "string" ? raw.beian_hao : null,
          category,
        })
      }
    } else if (typeof body.beian_hao === "string" && isProductCategory(String(body.category ?? ""))) {
      const beianHao = body.beian_hao.trim()
      const productId = await resolveManagedProductIdByBeian(beianHao)
      if (!productId) {
        return NextResponse.json({ error: "未找到对应在管产品，无法保存类别" }, { status: 404 })
      }
      items.push({
        product_id: productId,
        beian_hao: beianHao,
        category: String(body.category) as ProductCategory,
      })
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "没有可保存的类别设定" }, { status: 400 })
    }

    const saved = await saveLookthroughProductCategories(items, currentUserName(req, body.user_name))
    return NextResponse.json({ ok: true, saved })
  } catch (err) {
    console.error("[investment/lookthrough-compliance/categories]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
