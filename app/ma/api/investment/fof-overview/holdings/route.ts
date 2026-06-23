import { NextResponse } from "next/server"
import { listUnderlyingHoldings } from "@/lib/server/managed-fof-underlying-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** FOF products (在管产品) holding a specific FOF底层 fund. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const productName = (searchParams.get("product_name") || "").trim()
    const beianHao = (searchParams.get("beian_hao") || "").trim() || null

    if (!productName && !beianHao) {
      return NextResponse.json({ error: "product_name or beian_hao required" }, { status: 400 })
    }

    const { rows, totalQuantity, totalMarketValue } = await listUnderlyingHoldings({
      beianHao,
      productName: productName || beianHao || "",
    })

    return NextResponse.json({
      data: rows.map((r) => ({
        id: r.id,
        fofProductName: r.fof_product_name,
        valuationDate: r.valuation_date,
        quantity: r.quantity,
        marketValue: r.market_value,
        marketWeight: r.market_weight,
      })),
      totalQuantity,
      totalMarketValue,
    })
  } catch (err) {
    console.error("[investment/fof-overview/holdings]", err)
    return NextResponse.json({ error: "Failed to load holdings" }, { status: 500 })
  }
}
