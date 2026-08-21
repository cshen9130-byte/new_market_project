import { NextResponse } from "next/server"
import { queryLatestPositions } from "@/lib/server/cfmmc-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await queryLatestPositions()
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("cfmmc_positions") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, rows: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
