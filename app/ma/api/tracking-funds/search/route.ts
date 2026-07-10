import { NextResponse } from "next/server"
import { searchTrackingFunds } from "@/lib/server/fund-picker-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json([])
  }

  try {
    const rows = await searchTrackingFunds(q, 20)
    return NextResponse.json(rows)
  } catch (err) {
    console.error("[tracking-funds/search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
