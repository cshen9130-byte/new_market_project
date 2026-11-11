import { NextResponse } from "next/server"
import path from "path"
import { getRequestUser } from "@/lib/server/users"
import { tryRegisterOfficialSharedReport } from "@/lib/server/official-shared-reports"
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

    const user = await getRequestUser(req)
    tryRegisterOfficialSharedReport({
      reportId: result.reportId,
      section: "monthly",
      source: "product_monthly_generate",
      title: `产品月报（${result.endDate}）`,
      templateId: "monthly-pe-official",
      templateName: "低中高波三产品版",
      typeLabel: "月报",
      product_name: "低中高波三产品版",
      periodEnd: result.endDate,
      periodStart: result.endDate,
      tmpDir: path.join(process.cwd(), ".tmp", "product-monthly-reports", result.reportId),
      ownerUserId: user?.id,
      ownerName: user?.name || user?.email,
      formats: result.pdfFileName ? ["pptx", "pdf"] : ["pptx"],
    })

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
