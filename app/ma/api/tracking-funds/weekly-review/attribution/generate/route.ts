import { NextResponse } from "next/server"
import {
  defaultAttributionWeekEnd,
  getWeeklyAttributionJobStatus,
  prepareWeeklyAttributionJob,
  runWeeklyAttributionJob,
} from "@/lib/server/jy-weekly-attribution"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { week_end?: string }
    const weekEnd = (body.week_end || "").trim() || defaultAttributionWeekEnd()
    const jobId = await prepareWeeklyAttributionJob()
    setImmediate(() => {
      void runWeeklyAttributionJob(jobId, weekEnd)
    })
    return NextResponse.json({
      async: true,
      jobId,
      status: "pending",
      statusUrl: `/ma/api/tracking-funds/weekly-review/attribution/generate?id=${jobId}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/attribution/generate POST]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || ""
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })
  try {
    const status = await getWeeklyAttributionJobStatus(id)
    return NextResponse.json({
      ...status,
      downloadUrl: status.status === "done"
        ? `/ma/api/tracking-funds/weekly-review/attribution/download?id=${id}`
        : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
