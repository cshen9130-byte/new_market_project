import {
  readOfficialSharedReportFile,
  verifyOfficialSharedDownloadToken,
  type OfficialSharedFormat,
} from "@/lib/server/official-shared-reports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FORMATS = new Set<OfficialSharedFormat>(["png", "pdf", "pptx"])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const id = (url.searchParams.get("id") || "").trim()
  const format = (url.searchParams.get("format") || "").trim() as OfficialSharedFormat
  const token = (url.searchParams.get("token") || "").trim()
  const inline = url.searchParams.get("inline") === "1" || url.searchParams.get("inline") === "true"
  if (!id || !FORMATS.has(format) || !token || !verifyOfficialSharedDownloadToken(id, format, token)) {
    return Response.json({ error: "无效的下载令牌" }, { status: 403 })
  }

  try {
    const file = readOfficialSharedReportFile(id, format)
    const encoded = encodeURIComponent(file.fileName)
    return new Response(file.buffer, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${inline && format === "png" ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败"
    return Response.json({ error: message }, { status: 404 })
  }
}
