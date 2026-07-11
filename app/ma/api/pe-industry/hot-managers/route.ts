import { NextRequest, NextResponse } from "next/server"
import type { PeIndustryStaffMetric } from "@/lib/pe-industry-data"
import { loadPeIndustryHotManagers } from "@/lib/server/pe-industry-hot-managers-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseMetric(value: string | null): PeIndustryStaffMetric {
  return value === "practitioner" ? "practitioner" : "full_time"
}

export async function GET(request: NextRequest) {
  try {
    const metric = parseMetric(request.nextUrl.searchParams.get("metric"))
    const data = await loadPeIndustryHotManagers(metric)
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "No hot manager stats available. Run amac_extra ETL to populate amac_manager_metrics_history." },
        { status: 503 },
      )
    }
    return NextResponse.json({ ok: true, ...data })
  } catch (error) {
    console.error("[pe-industry/hot-managers]", error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load hot manager data" },
      { status: 500 },
    )
  }
}
