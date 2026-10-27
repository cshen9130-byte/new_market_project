import {
  readAutoWeeklyReportFile,
} from "@/lib/server/auto-weekly-reports"
import { verifyReportDownloadToken } from "@/lib/server/fof-weekly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = (searchParams.get("id") || "").trim()
  const format = searchParams.get("format") === "pdf" ? "pdf" : "png"
  const inline = searchParams.get("inline") === "1" || searchParams.get("inline") === "true"
  const token = (searchParams.get("token") || "").trim()

  if (!reportId || !token || !verifyReportDownloadToken(reportId, format, token)) {
    return Response.json({ error: "无效的下载令牌" }, { status: 403 })
  }

  try {
    const { buffer, fileName, contentType } = readAutoWeeklyReportFile(reportId, format)
    const encoded = encodeURIComponent(fileName)
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${inline && format === "png" ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败"
    return Response.json({ error: message }, { status: 404 })
  }
}
