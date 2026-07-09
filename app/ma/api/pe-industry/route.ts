import { NextResponse } from "next/server"
import { loadPeIndustryData } from "@/lib/server/pe-industry-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await loadPeIndustryData()
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "No PE industry stats available. Run pe_industry_stats_etl.py first." },
        { status: 503 },
      )
    }
    return NextResponse.json({ ok: true, ...data })
  } catch (error) {
    console.error("[pe-industry]", error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load PE industry data" },
      { status: 500 },
    )
  }
}
