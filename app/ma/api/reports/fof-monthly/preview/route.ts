import { NextResponse } from "next/server"
import { isValidReportId, readFofMonthlyReportPreview } from "@/lib/server/fof-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = (searchParams.get("id") || "").trim()

  if (!isValidReportId(reportId)) {
    return NextResponse.json({ error: "无效的报告 ID" }, { status: 400 })
  }

  try {
    const buffer = await readFofMonthlyReportPreview(reportId)
    // Node Buffer → Uint8Array so Response body is reliable across Next/PM2 workers.
    return new Response(Uint8Array.from(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "预览失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
