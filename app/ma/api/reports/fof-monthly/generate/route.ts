import { NextResponse } from "next/server"
import {
  buildMonthlyReportDownloadToken,
  generateFofMonthlyReport,
  type FofMonthlyReportRequest,
} from "@/lib/server/fof-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FofMonthlyReportRequest
    const result = await generateFofMonthlyReport(body)

    return NextResponse.json({
      ...result,
      previewUrl: `/ma/api/reports/fof-monthly/preview?id=${result.reportId}`,
      download: {
        png: `/ma/api/reports/fof-monthly/download?id=${result.reportId}&format=png&token=${buildMonthlyReportDownloadToken(result.reportId, "png")}`,
        pdf: `/ma/api/reports/fof-monthly/download?id=${result.reportId}&format=pdf&token=${buildMonthlyReportDownloadToken(result.reportId, "pdf")}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[fof-monthly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
