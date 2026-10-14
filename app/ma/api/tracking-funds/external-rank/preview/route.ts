import { NextResponse } from "next/server"
import { buildExternalRankWeekPreview } from "@/lib/server/external-rank-week"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const weekEnd = new URL(req.url).searchParams.get("week_end") || ""
    const preview = await buildExternalRankWeekPreview(weekEnd)
    return NextResponse.json(preview)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[external-rank/preview]", err)
    const missing = message.includes("还没有")
    return NextResponse.json({ error: message }, { status: missing ? 404 : 500 })
  }
}
