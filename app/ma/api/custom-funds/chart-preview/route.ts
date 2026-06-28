import { NextResponse } from "next/server"
import { assertCustomFundAccess, listCustomFundNavSeries } from "@/lib/server/custom-fund-nav"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get("code") || "").trim()
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") || "90", 10) || 90))
  if (!code) {
    return NextResponse.json({ fund: [], bench: [], name: "" })
  }

  const userId = String(req.headers.get("x-market-user-id") || "").trim() || undefined
  const fundMeta = assertCustomFundAccess(code, userId)
  if (!fundMeta) {
    return NextResponse.json({ fund: [], bench: [], name: "" })
  }

  const series = listCustomFundNavSeries(code).slice(-days)
  const fundPoints = series.map((row) => ({
    d: row.price_date,
    v: parseFloat(row.cum_nav_withdrawal || row.nav) || 0,
  }))

  return NextResponse.json({
    fund: fundPoints,
    bench: [],
    name: fundMeta.product_name,
  })
}
