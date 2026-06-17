import { NextResponse } from "next/server"
import { listEmailValuationRecords } from "@/lib/server/email-valuation-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const page = Number(url.searchParams.get("page") ?? "1")
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20")
    const offset = Math.max(0, (page - 1) * pageSize)

    const { records, total } = await listEmailValuationRecords({
      productCode: url.searchParams.get("productCode") ?? undefined,
      fundName: url.searchParams.get("fundName") ?? undefined,
      valuationDateFrom: url.searchParams.get("valuationDateFrom") ?? undefined,
      valuationDateTo: url.searchParams.get("valuationDateTo") ?? undefined,
      limit: pageSize,
      offset,
    })

    return NextResponse.json({
      records: records.map((r) => ({
        id: r.id,
        crawlEmailAccount: r.crawl_email_account,
        emailUid: r.email_uid,
        sentAt: r.sent_at,
        subject: r.subject,
        senderEmail: r.sender_email,
        attachmentFilename: r.attachment_filename,
        productCode: r.product_code,
        fundName: r.fund_name,
        valuationDate: r.valuation_date,
        unitNav: r.unit_nav,
        cumulativeNav: r.cumulative_nav,
        totalAsset: r.total_asset,
        totalLiability: r.total_liability,
        netAsset: r.net_asset,
        holdingsCount: r.holdings_count,
        source: r.source,
        summary: r.summary,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
