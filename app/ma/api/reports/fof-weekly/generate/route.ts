import { NextResponse } from "next/server"
import {
  buildReportDownloadToken,
  generateFofWeeklyReport,
  type FofWeeklyReportRequest,
} from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FofWeeklyReportRequest
    const result = await generateFofWeeklyReport(body)

    return NextResponse.json({
      ...result,
      previewUrl: `/ma/api/reports/fof-weekly/preview?id=${result.reportId}`,
      download: {
        png: `/ma/api/reports/fof-weekly/download?id=${result.reportId}&format=png&token=${buildReportDownloadToken(result.reportId, "png")}`,
        pdf: `/ma/api/reports/fof-weekly/download?id=${result.reportId}&format=pdf&token=${buildReportDownloadToken(result.reportId, "pdf")}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[fof-weekly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
