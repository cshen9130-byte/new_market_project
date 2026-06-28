import { NextResponse } from "next/server"
import { syncFundValuationEmailsFromMailbox } from "@/lib/server/fund-valuation-allocation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao: raw } = await params
    const body = await req.json().catch(() => ({})) as { days?: number }
    const days = typeof body.days === "number" && body.days > 0 ? body.days : undefined

    const result = await syncFundValuationEmailsFromMailbox(raw, { days })

    return NextResponse.json({
      ok: true,
      days: result.days,
      valuationSaved: result.valuationSaved,
      zipBatchSaved: result.zipBatchSaved,
      errors: result.errors,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "同步失败"
    console.error("[valuation/fetch-emails]", message, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
