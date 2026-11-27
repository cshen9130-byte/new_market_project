import { NextResponse } from "next/server"
import { buildExternalRankWeekCompare } from "@/lib/server/external-rank-week"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const weekEnd = url.searchParams.get("week_end") || ""
    const compare = await buildExternalRankWeekCompare(weekEnd)
    return NextResponse.json(compare)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[external-rank/compare]", err)
    const missing = message.includes("还没有")
    return NextResponse.json({ error: message }, { status: missing ? 404 : 500 })
  }
}
