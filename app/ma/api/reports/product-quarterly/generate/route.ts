import { NextResponse } from "next/server"
import {
  buildProductQuarterlyDownloadToken,
  generateProductQuarterlyReport,
  type ProductQuarterlyReportRequest,
} from "@/lib/server/product-quarterly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProductQuarterlyReportRequest
    const result = await generateProductQuarterlyReport(body)

    return NextResponse.json({
      ...result,
      previewUrl: `/ma/api/reports/product-quarterly/preview?id=${result.reportId}`,
      download: {
        png: `/ma/api/reports/product-quarterly/download?id=${result.reportId}&format=png&token=${buildProductQuarterlyDownloadToken(result.reportId, "png")}`,
        pdf: `/ma/api/reports/product-quarterly/download?id=${result.reportId}&format=pdf&token=${buildProductQuarterlyDownloadToken(result.reportId, "pdf")}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[product-quarterly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
