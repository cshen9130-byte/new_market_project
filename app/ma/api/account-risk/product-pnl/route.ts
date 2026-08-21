import { NextResponse } from "next/server"
import { queryProductPnl } from "@/lib/server/cfmmc-etl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get("date") ?? undefined
    const rows = await queryProductPnl(date)
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("cfmmc_product_pnl") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, rows: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
