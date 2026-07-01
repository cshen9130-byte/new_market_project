import { NextResponse } from "next/server"
import { resolveProductMonthlyNavRange } from "@/lib/server/product-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const product_name = (searchParams.get("product_name") || "").trim()
  const beian_hao = (searchParams.get("beian_hao") || "").trim() || undefined

  if (!product_name) {
    return NextResponse.json({ error: "缺少 product_name" }, { status: 400 })
  }

  try {
    const range = await resolveProductMonthlyNavRange(product_name, beian_hao)
    return NextResponse.json(range)
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
