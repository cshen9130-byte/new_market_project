import { NextResponse } from "next/server"
import {
  buildProductMonthlyDownloadToken,
  generateProductMonthlyReport,
  type ProductMonthlyReportRequest,
} from "@/lib/server/product-monthly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProductMonthlyReportRequest
    const result = await generateProductMonthlyReport(body)

    return NextResponse.json({
      ...result,
      previewUrl: result.pdfFileName
        ? `/ma/api/reports/product-monthly/preview?id=${result.reportId}`
        : null,
      download: {
        pptx: `/ma/api/reports/product-monthly/download?id=${result.reportId}&format=pptx&token=${buildProductMonthlyDownloadToken(result.reportId, "pptx")}`,
        pdf: result.pdfFileName
          ? `/ma/api/reports/product-monthly/download?id=${result.reportId}&format=pdf&token=${buildProductMonthlyDownloadToken(result.reportId, "pdf")}`
          : null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[product-monthly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
