import { NextResponse } from "next/server"
import { buildFuturesWeeklyReviewPreview } from "@/lib/server/jy-weekly-review-futures"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const weekEnd = (searchParams.get("week_end") || "").trim() || defaultWeeklyReviewWeekEnd()
    const preview = await buildFuturesWeeklyReviewPreview(weekEnd)
    return NextResponse.json(preview)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/futures/preview]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}