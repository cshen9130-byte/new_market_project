import { NextResponse } from "next/server"
import { buildPublicEnhancedWeeklyPreview } from "@/lib/server/public-enhanced-weekly-review"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const weekEnd = new URL(req.url).searchParams.get("week_end")?.trim() || defaultWeeklyReviewWeekEnd()
    const preview = await buildPublicEnhancedWeeklyPreview(weekEnd)
    return NextResponse.json(preview)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/public-enhanced/preview]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
