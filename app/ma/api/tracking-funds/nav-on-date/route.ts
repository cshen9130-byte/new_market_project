import { NextResponse } from "next/server"
import { loadFundUnitNavOnOrBefore } from "@/lib/server/fund-nav-series"

export const dynamic = "force-dynamic"

// GET /ma/api/tracking-funds/nav-on-date?beian_hao=XXX&date=YYYY-MM-DD&product_name=YYY
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  const date = (searchParams.get("date") || "").trim().slice(0, 10)

  if (!beian_hao && !product_name) {
    return NextResponse.json({ error: "missing beian_hao or product_name" }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 })
  }

  const fundId = beian_hao || product_name
  try {
    const result = await loadFundUnitNavOnOrBefore(fundId, date, product_name || undefined)
    return NextResponse.json({
      unit_nav: result.nav,
      nav_date: result.price_date,
      exact: result.exact,
      requested_date: date,
    })
  } catch (err) {
    console.error("[tracking-funds/nav-on-date]", err)
    return NextResponse.json({ error: "failed to load nav" }, { status: 500 })
  }
}
