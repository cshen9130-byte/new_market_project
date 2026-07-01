import { NextResponse } from "next/server"
import { isValidReportId, readProductMonthlyReportPreview } from "@/lib/server/product-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = (searchParams.get("id") || "").trim()

  if (!isValidReportId(reportId)) {
    return NextResponse.json({ error: "无效的报告 ID" }, { status: 400 })
  }

  try {
    const buffer = await readProductMonthlyReportPreview(reportId)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "预览失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
