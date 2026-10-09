import { NextResponse } from "next/server"
import { normalizeWeeklyReviewPools } from "@/lib/ma/weekly-review-pools"
import {
  getFuturesWeeklyReviewJobStatus,
  prepareFuturesWeeklyReviewJob,
  runFuturesWeeklyReviewJob,
} from "@/lib/server/jy-weekly-review-futures"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { week_end?: string; pools?: unknown }
    const weekEnd = (body.week_end || "").trim() || defaultWeeklyReviewWeekEnd()
    const pools = normalizeWeeklyReviewPools(body.pools)
    const jobId = await prepareFuturesWeeklyReviewJob()
    setImmediate(() => {
      void runFuturesWeeklyReviewJob(jobId, weekEnd, pools)
    })
    return NextResponse.json({
      async: true,
      jobId,
      status: "pending",
      statusUrl: `/ma/api/tracking-funds/weekly-review/futures/generate?id=${jobId}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/futures/generate POST]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || ""
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })
  try {
    const status = await getFuturesWeeklyReviewJobStatus(id)
    return NextResponse.json({
      ...status,
      downloadUrl: status.status === "done"
        ? `/ma/api/tracking-funds/weekly-review/futures/download?id=${id}`
        : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}