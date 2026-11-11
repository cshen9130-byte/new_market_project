import { NextResponse } from "next/server"
import path from "path"
import { getRequestUser } from "@/lib/server/users"
import { tryRegisterOfficialSharedReport } from "@/lib/server/official-shared-reports"
import {
  buildMonthlyReportDownloadToken,
  generateFofMonthlyReport,
  readFofMonthlyReportFile,
  type FofMonthlyReportRequest,
} from "@/lib/server/fof-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FofMonthlyReportRequest
    const result = await generateFofMonthlyReport(body)

    const user = await getRequestUser(req)
    tryRegisterOfficialSharedReport({
      reportId: result.reportId,
      section: "monthly",
      source: "fof_monthly_generate",
      title: result.reportTitle,
      templateId: body.report_layout === "review" ? "monthly-review" : "monthly-track-curve",
      templateName: body.report_layout === "review" ? "跟踪产品（马年版）" : "跟踪产品（超额版）",
      typeLabel: "月报",
      product_name: body.product_name,
      beian_hao: body.beian_hao,
      periodStart: result.monthStart,
      periodEnd: result.monthEnd,
      tmpDir: path.join(process.cwd(), ".tmp", "fof-monthly-reports", result.reportId),
      ownerUserId: user?.id,
      ownerName: user?.name || user?.email,
      formats: ["png", "pdf"],
    })

    // Inline preview so the dialog does not depend on a second request hitting the
    // same PM2 worker / tmp files (cluster mode can otherwise show a broken image).
    let previewDataUrl: string | undefined
    try {
      const png = await readFofMonthlyReportFile(result.reportId, "png")
      previewDataUrl = `data:image/png;base64,${png.buffer.toString("base64")}`
    } catch (previewErr) {
      console.warn("[fof-monthly/generate] inline preview unavailable:", previewErr)
    }

    return NextResponse.json({
      ...result,
      previewUrl: `/ma/api/reports/fof-monthly/preview?id=${result.reportId}`,
      previewDataUrl,
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
