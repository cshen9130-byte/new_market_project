import { NextResponse } from "next/server"
import path from "path"
import { getRequestUser } from "@/lib/server/users"
import { tryRegisterOfficialSharedReport } from "@/lib/server/official-shared-reports"
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

    const user = await getRequestUser(req)
    tryRegisterOfficialSharedReport({
      reportId: result.reportId,
      section: "quarterly",
      source: "product_quarterly_generate",
      title: result.reportTitle,
      templateId: "quarterly-institutional",
      templateName: "机构投资者持有期季报",
      typeLabel: "季报",
      product_name: body.product_name,
      beian_hao: body.beian_hao,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      tmpDir: path.join(process.cwd(), ".tmp", "product-quarterly-reports", result.reportId),
      ownerUserId: user?.id,
      ownerName: user?.name || user?.email,
      formats: ["png", "pdf"],
    })

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
