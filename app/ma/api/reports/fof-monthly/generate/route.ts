import { NextResponse } from "next/server"
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
