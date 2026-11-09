import { NextResponse } from "next/server"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"
import {
  getPublicEnhancedWeeklyJobStatus,
  preparePublicEnhancedWeeklyJob,
  runPublicEnhancedWeeklyJob,
} from "@/lib/server/public-enhanced-weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { week_end?: string }
    const weekEnd = (body.week_end || "").trim() || defaultWeeklyReviewWeekEnd()
    const jobId = await preparePublicEnhancedWeeklyJob()
    setImmediate(() => {
      void runPublicEnhancedWeeklyJob(jobId, weekEnd)
    })
    return NextResponse.json({
      async: true,
      jobId,
      status: "pending",
      statusUrl: `/ma/api/tracking-funds/weekly-review/public-enhanced/generate?id=${jobId}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/public-enhanced/generate POST]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || ""
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })
  try {
    const status = await getPublicEnhancedWeeklyJobStatus(id)
    return NextResponse.json({
      ...status,
      downloadUrl: status.status === "done"
        ? `/ma/api/tracking-funds/weekly-review/public-enhanced/download?id=${id}`
        : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
