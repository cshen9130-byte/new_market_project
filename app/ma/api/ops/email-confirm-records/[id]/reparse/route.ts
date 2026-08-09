import { NextResponse } from "next/server"
import { reparseEmailConfirmRecord } from "@/lib/server/email-confirm-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Force re-read the stored 确认单 PDF and refresh parsed fields.
 * Used by 产品运维确认 when selecting an email candidate so form fill
 * uses slip NAV/shares instead of product NAV lookup.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const record = await reparseEmailConfirmRecord(recordId)
    if (!record) {
      return NextResponse.json({ error: "确认单不存在" }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      data: record,
      extracted: {
        confirm_date: record.confirm_date,
        confirmed_amount: record.confirmed_amount,
        confirmed_shares: record.confirmed_shares,
        unit_nav: record.unit_nav,
        trade_fee: record.trade_fee,
        business_type: record.business_type,
      },
    })
  } catch (err) {
    console.error("[ops/email-confirm-records/reparse POST]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "重新解析确认单失败" },
      { status: 500 },
    )
  }
}
