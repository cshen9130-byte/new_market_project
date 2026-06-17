import { NextResponse } from "next/server"
import { getEmailValuationRecordById } from "@/lib/server/email-valuation-pg"
import { listValuationHoldingsByRecordId } from "@/lib/server/email-valuation-holdings-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const record = await getEmailValuationRecordById(recordId)
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    const detailOnly = new URL(_req.url).searchParams.get("detailOnly") !== "false"
    const normalizedHoldings = await listValuationHoldingsByRecordId(recordId, { detailOnly })

    return NextResponse.json({
      id: record.id,
      crawlEmailAccount: record.crawl_email_account,
      emailUid: record.email_uid,
      sentAt: record.sent_at,
      subject: record.subject,
      senderEmail: record.sender_email,
      attachmentFilename: record.attachment_filename,
      productCode: record.product_code,
      fundName: record.fund_name,
      valuationDate: record.valuation_date,
      unitNav: record.unit_nav,
      cumulativeNav: record.cumulative_nav,
      totalAsset: record.total_asset,
      totalLiability: record.total_liability,
      netAsset: record.net_asset,
      holdingsCount: record.holdings_count,
      source: record.source,
      summary: record.summary,
      holdings: record.holdings,
      normalizedHoldings,
      createdAt: record.created_at,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
