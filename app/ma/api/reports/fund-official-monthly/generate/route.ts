import { NextResponse } from "next/server"
import path from "path"
import { getRequestUser } from "@/lib/server/users"
import { tryRegisterOfficialSharedReport } from "@/lib/server/official-shared-reports"
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

    const user = await getRequestUser(req)
    tryRegisterOfficialSharedReport({
      reportId: result.reportId,
      section: "monthly",
      source: "fund_official_monthly_generate",
      title: result.reportTitle,
      templateId: "monthly-fund-official",
      templateName: "表格版",
      typeLabel: "月报",
      product_name: body.product_name,
      beian_hao: body.beian_hao,
      periodStart: result.monthStart,
      periodEnd: result.monthEnd,
      tmpDir: path.join(process.cwd(), ".tmp", "fund-official-monthly-reports", result.reportId),
      ownerUserId: user?.id,
      ownerName: user?.name || user?.email,
      formats: ["png", "pdf"],
    })

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
