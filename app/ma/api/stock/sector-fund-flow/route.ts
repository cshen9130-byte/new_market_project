import { NextResponse } from "next/server"
import { getAshareSectorFundFlow } from "@/lib/server/ashare-sector-fund-flow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const boardType = searchParams.get("type")
  const days = parseInt(searchParams.get("days") || "120", 10)
  const limit = parseInt(searchParams.get("limit") || "8", 10)
  const preset = searchParams.get("preset") || "top"
  const focus = searchParams.get("focus")

  try {
    const data = await getAshareSectorFundFlow({
      boardType,
      days,
      limit,
      preset,
      focus,
    })
    if (!data.boards.length) {
      return NextResponse.json(
        { error: data.note || "No sector fund-flow data", ...data },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
