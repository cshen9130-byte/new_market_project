import { NextResponse } from "next/server"
import {
  buildFundOfficialMonthlyDownloadToken,
  generateFundOfficialMonthlyReport,
  type FundOfficialMonthlyReportRequest,
} from "@/lib/server/fund-official-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FundOfficialMonthlyReportRequest
    const result = await generateFundOfficialMonthlyReport(body)

    return NextResponse.json({
      ...result,
      previewUrl: `/ma/api/reports/fund-official-monthly/preview?id=${result.reportId}`,
      download: {
        png: `/ma/api/reports/fund-official-monthly/download?id=${result.reportId}&format=png&token=${buildFundOfficialMonthlyDownloadToken(result.reportId, "png")}`,
        pdf: `/ma/api/reports/fund-official-monthly/download?id=${result.reportId}&format=pdf&token=${buildFundOfficialMonthlyDownloadToken(result.reportId, "pdf")}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[fund-official-monthly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
