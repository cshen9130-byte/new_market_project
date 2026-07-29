import { NextResponse } from "next/server"
import {
  buildReportDownloadToken,
  getFofWeeklyReportJobStatus,
  prepareFofWeeklyReportJob,
  runFofWeeklyReportJob,
  type FofWeeklyReportRequest,
  type FofWeeklyReportResult,
} from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FofWeeklyReportRequest
    const reportId = await prepareFofWeeklyReportJob()

    // Fire-and-forget on the long-lived PM2 process. Do NOT use next/server `after()`
    // here — some proxies keep the client request open until after() finishes.
    setImmediate(() => {
      void runFofWeeklyReportJob(reportId, body)
    })

    return NextResponse.json({
      async: true,
      reportId,
      status: "pending",
      statusUrl: `/ma/api/reports/fof-weekly/status?id=${reportId}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "报告生成失败"
    console.error("[fof-weekly/generate]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || ""
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
