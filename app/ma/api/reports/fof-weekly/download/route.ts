import { NextResponse } from "next/server"
import {
  readFofWeeklyReportFile,
  verifyReportDownloadToken,
} from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = (searchParams.get("id") || "").trim()
  const format = searchParams.get("format") === "pdf" ? "pdf" : "png"
  const token = (searchParams.get("token") || "").trim()

  if (!reportId || !token || !verifyReportDownloadToken(reportId, format, token)) {
    return NextResponse.json({ error: "无效下载链接" }, { status: 403 })
  }

  try {
    const { buffer, fileName, contentType } = await readFofWeeklyReportFile(reportId, format)
    const encoded = encodeURIComponent(fileName)
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
