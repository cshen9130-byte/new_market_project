import { NextResponse } from "next/server"
import {
  buildReportDownloadToken,
  getFofWeeklyReportJobStatus,
  type FofWeeklyReportResult,
} from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function enrichResult(result: FofWeeklyReportResult) {
  return {
    ...result,
    previewUrl: `/ma/api/reports/fof-weekly/preview?id=${result.reportId}`,
    download: {
      png: `/ma/api/reports/fof-weekly/download?id=${result.reportId}&format=png&token=${buildReportDownloadToken(result.reportId, "png")}`,
      pdf: `/ma/api/reports/fof-weekly/download?id=${result.reportId}&format=pdf&token=${buildReportDownloadToken(result.reportId, "pdf")}`,
    },
  }
}

export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim()
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 })
  }

  try {
    const status = await getFofWeeklyReportJobStatus(id)
    return NextResponse.json({
      ...status,
      result: status.result ? enrichResult(status.result) : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
