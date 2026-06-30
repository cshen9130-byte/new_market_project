import { NextResponse } from "next/server"
import { resolveFofWeeklyProductNavRange } from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const product_name = (searchParams.get("product_name") || "").trim()
  const beian_hao = (searchParams.get("beian_hao") || "").trim()

  if (!product_name) {
    return NextResponse.json({ error: "missing product_name" }, { status: 400 })
  }

  try {
    const range = await resolveFofWeeklyProductNavRange(product_name, beian_hao || undefined)
    return NextResponse.json(range)
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
