import { NextResponse } from "next/server"
import { listFundLatestValuationHoldings } from "@/lib/server/email-valuation-holdings-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function mapHolding(row: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"][number]) {
  return {
    id: row.id,
    valuationRecordId: row.valuation_record_id,
    productCode: row.product_code,
    fundName: row.fund_name,
    valuationDate: row.valuation_date,
    subjectCode: row.subject_code,
    originalSubjectCode: row.original_subject_code,
    subjectName: row.subject_name,
    symbol: row.symbol,
    rowKind: row.row_kind,
    direction: row.direction,
    exchange: row.exchange,
    assetClass: row.asset_class,
    currency: row.currency,
    fxRate: row.fx_rate,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    cost: row.cost,
    signedCost: row.signed_cost,
    price: row.price,
    marketValue: row.market_value,
    signedMarketValue: row.signed_market_value,
    unrealizedPnl: row.unrealized_pnl,
    costWeight: row.cost_weight,
    marketWeight: row.market_weight,
    isLeaf: row.is_leaf,
    includeInDetail: row.include_in_detail,
    includeInAnalysis: row.include_in_analysis,
    extra: row.extra,
    refreshedAt: row.refreshed_at,
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const page = Number(url.searchParams.get("page") ?? "1")
    const pageSize = Number(url.searchParams.get("pageSize") ?? "500")
    const offset = Math.max(0, (page - 1) * pageSize)

    const { holdings, total } = await listFundLatestValuationHoldings({
      productCode: url.searchParams.get("productCode") ?? undefined,
      fundName: url.searchParams.get("fundName") ?? undefined,
      rowKind: url.searchParams.get("rowKind") ?? undefined,
      includeAnalysisOnly: url.searchParams.get("analysisOnly") === "true",
      limit: pageSize,
      offset,
    })

    const valuationDate = holdings[0]?.valuation_date ?? null

    return NextResponse.json({
      holdings: holdings.map(mapHolding),
      total,
      page,
      pageSize,
      valuationDate,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
