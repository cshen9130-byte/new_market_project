import { NextResponse } from "next/server"
import { resolveFundOfficialMonthlyNavRange } from "@/lib/server/fund-official-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const product_name = searchParams.get("product_name") ?? ""
    const beian_hao = searchParams.get("beian_hao") ?? ""
    if (!product_name.trim()) {
      return NextResponse.json({ error: "请选择产品" }, { status: 400 })
    }
    const range = await resolveFundOfficialMonthlyNavRange(product_name, beian_hao || undefined)
    return NextResponse.json(range)
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取净值区间失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
