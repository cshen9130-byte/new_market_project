import { NextResponse } from "next/server"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"
import { buildPublicEnhancedWeeklyPerformance } from "@/lib/server/public-enhanced-weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const weekEnd = new URL(req.url).searchParams.get("week_end")?.trim() || defaultWeeklyReviewWeekEnd()
    const performance = await buildPublicEnhancedWeeklyPerformance(weekEnd)
    return NextResponse.json(performance)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/public-enhanced/performance]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
