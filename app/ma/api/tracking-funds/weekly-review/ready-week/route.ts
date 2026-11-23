import { NextResponse } from "next/server"
import { normalizeWeeklyReviewPools } from "@/lib/ma/weekly-review-pools"
import { resolveWeeklyReviewReadyWeek, type WeeklyReviewExcelVariant } from "@/lib/server/weekly-review-excel-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseVariant(raw: string | null): WeeklyReviewExcelVariant {
  if (raw === "futures" || raw === "public-enhanced") return raw
  return "equity"
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const variant = parseVariant(url.searchParams.get("variant"))
    const pools = normalizeWeeklyReviewPools(url.searchParams.get("pools"))
    const ready = await resolveWeeklyReviewReadyWeek(variant, pools)
    return NextResponse.json({
      week_start: ready.weekStart,
      week_end: ready.weekEnd,
      covered: ready.covered,
      total: ready.total,
      ready: ready.ready,
      file_ready: ready.fileReady,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[weekly-review/ready-week]", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
