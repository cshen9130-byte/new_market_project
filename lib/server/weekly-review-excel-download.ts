import { NextResponse } from "next/server"
import { normalizeWeeklyReviewPools } from "@/lib/ma/weekly-review-pools"
import {
  getLatestReadyWeeklyReviewWeek,
  readWeeklyReviewExcelCache,
  type WeeklyReviewExcelVariant,
} from "@/lib/server/weekly-review-excel-cache"

function xlsxResponse(buffer: Buffer, fileName: string): NextResponse {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  })
}

export async function serveCachedWeeklyReviewExcel(
  variant: WeeklyReviewExcelVariant,
  req: Request,
  readJobFile: (id: string) => Promise<{ buffer: Buffer; fileName: string }>,
): Promise<NextResponse> {
  const url = new URL(req.url)
  const id = (url.searchParams.get("id") || "").trim()
  if (id) {
    try {
      const { buffer, fileName } = await readJobFile(id)
      return xlsxResponse(buffer, fileName)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: message }, { status: 404 })
    }
  }

  const pools = normalizeWeeklyReviewPools(url.searchParams.get("pools"))
  let weekEnd = (url.searchParams.get("week_end") || "").trim().slice(0, 10)
  if (!weekEnd) {
    const ready = await getLatestReadyWeeklyReviewWeek(variant, pools)
    weekEnd = ready?.weekEnd || ""
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
    return NextResponse.json({ error: "missing week_end" }, { status: 400 })
  }
  try {
    const { buffer, fileName } = await readWeeklyReviewExcelCache(variant, weekEnd, pools)
    return xlsxResponse(buffer, fileName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
