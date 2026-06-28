import { NextResponse } from "next/server"
import {
  getFundValuationCalendarSummary,
  listFundValuationEmailRecords,
} from "@/lib/server/fund-valuation-allocation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao: raw } = await params
    const url = new URL(req.url)

    if (url.searchParams.get("view") === "calendar") {
      const summary = await getFundValuationCalendarSummary(raw)
      return NextResponse.json(summary)
    }

    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")))
    const offset = (page - 1) * pageSize

    const { records, total } = await listFundValuationEmailRecords(raw, { limit: pageSize, offset })

    return NextResponse.json({
      records: records.map((r) => ({
        id: r.id,
        sentAt: r.sent_at,
        subject: r.subject,
        attachmentFilename: r.attachment_filename,
        productCode: r.product_code,
        fundName: r.fund_name,
        valuationDate: r.valuation_date,
        unitNav: r.unit_nav,
        cumulativeNav: r.cumulative_nav,
        netAsset: r.net_asset,
        holdingsCount: r.holdings_count,
        source: r.source,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    console.error("[valuation/records]", message, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
