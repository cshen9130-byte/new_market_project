import { NextResponse } from "next/server"
import { getAshareHotSectors } from "@/lib/server/ashare-hot-sectors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const top = parseInt(searchParams.get("top") || "15", 10)
  const forceRefresh = searchParams.get("refresh") === "1"

  try {
    const data = await getAshareHotSectors({ top, forceRefresh })
    if (!data.industry.length && !data.concept.length) {
      return NextResponse.json(
        { error: "No hot sector data. Check AkShare connectivity." },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
