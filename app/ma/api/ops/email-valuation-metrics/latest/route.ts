import { NextResponse } from "next/server"
import { listFundMetricsLatest } from "@/lib/server/email-valuation-metrics-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Latest 托管户余额 + 资产净值 per fund — for syncing to 在管产品. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const rows = await listFundMetricsLatest({
      productCode: url.searchParams.get("productCode") ?? undefined,
      fundName: url.searchParams.get("fundName") ?? undefined,
    })

    return NextResponse.json({
      records: rows.map((r) => ({
        productCode: r.product_code,
        fundName: r.fund_name,
        valuationDate: r.valuation_date,
        unitNav: r.unit_nav,
        cumulativeNav: r.cumulative_nav,
        custodyBalance: r.custody_balance,
        netAssetValue: r.net_asset_value,
        totalAsset: r.total_asset,
        totalLiability: r.total_liability,
        refreshedAt: r.refreshed_at,
      })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
