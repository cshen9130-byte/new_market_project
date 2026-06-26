import { NextResponse } from "next/server"
import { loadFundNavRange, resolveFundNames } from "@/lib/server/fund-nav-series"

export const dynamic = "force-dynamic"

// GET /ma/api/tracking-funds/nav-range?beian_hao=XXX&product_name=YYY
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const names = await resolveFundNames(beian_hao, product_name)
  const range = await loadFundNavRange(beian_hao, names.product_name, names.short_name)
  return NextResponse.json(range)
}
