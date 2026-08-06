import { NextResponse } from "next/server"
import { getAshareSectorOverview } from "@/lib/server/ashare-sector-overview"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const boardType = searchParams.get("type")
  const days = parseInt(searchParams.get("days") || "1", 10)
  const sort = searchParams.get("sort") || "change"
  const date = searchParams.get("date")

  try {
    const data = await getAshareSectorOverview({ boardType, days, sort, date })
    if (!data.boards.length) {
      return NextResponse.json(
        { error: data.note || "No sector overview data", ...data },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
