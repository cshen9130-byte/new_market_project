import { NextResponse } from "next/server"
import { loadSectorMarketVol } from "@/lib/server/sector-market-vol"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 板块市场波动 — latest 20-day annualized vol of each market sector. */
export async function GET() {
  try {
    const payload = await loadSectorMarketVol()
    return NextResponse.json({ ok: true, ...payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : "sector market vol failed"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
