import { NextResponse } from "next/server"
import { isValidReportId, readFofWeeklyReportPreview } from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = (searchParams.get("id") || "").trim()

  if (!isValidReportId(reportId)) {
    return NextResponse.json({ error: "无效的报告 ID" }, { status: 400 })
  }

  try {
    const buffer = await readFofWeeklyReportPreview(reportId)
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "预览失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
