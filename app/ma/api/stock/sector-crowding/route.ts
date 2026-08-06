import { NextResponse } from "next/server"
import { getAshareSectorCrowding } from "@/lib/server/ashare-sector-crowding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const boardType = searchParams.get("type")
  const boardName = searchParams.get("board") || searchParams.get("name")
  const days = parseInt(searchParams.get("days") || "365", 10)
  const hotTopN = parseInt(searchParams.get("top_n") || "10", 10)
  const autoBackfill = searchParams.get("backfill") !== "0"

  try {
    const data = await getAshareSectorCrowding({
      boardType,
      boardName,
      days,
      hotTopN,
      autoBackfill,
    })
    const hasShare = data.series.some((s) => s.amount_share != null)
    if (!hasShare) {
      return NextResponse.json(
        {
          error: data.note || "No sector amount history for this board",
          ...data,
        },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
