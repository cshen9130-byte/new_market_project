import { NextResponse } from "next/server"
import { getAshareHotSectorHistory, type HotSectorBoardType } from "@/lib/server/ashare-hot-sectors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const typeParam = searchParams.get("type")
  const boardType: HotSectorBoardType = typeParam === "concept" ? "concept" : "industry"
  const days = parseInt(searchParams.get("days") || "20", 10)
  const topN = parseInt(searchParams.get("top_n") || searchParams.get("topN") || "10", 10)
  const limit = parseInt(searchParams.get("limit") || "15", 10)
  const autoBackfill = searchParams.get("backfill") !== "0"

  try {
    const data = await getAshareHotSectorHistory({
      boardType,
      days,
      topN,
      limit,
      autoBackfill,
    })
    if (!data.boards.length) {
      return NextResponse.json(
        {
          error: data.coverage_note || "No hot-sector history yet",
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
