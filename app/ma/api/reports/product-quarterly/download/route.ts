import { NextResponse } from "next/server"
import {
  readProductQuarterlyReportFile,
  verifyProductQuarterlyDownloadToken,
} from "@/lib/server/product-quarterly-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const reportId = searchParams.get("id") ?? ""
  const format = searchParams.get("format") === "pdf" ? "pdf" : "png"
  const token = searchParams.get("token") ?? ""

  if (!reportId || !token || !verifyProductQuarterlyDownloadToken(reportId, format, token)) {
    return NextResponse.json({ error: "无效的下载链接" }, { status: 403 })
  }

  try {
    const { buffer, fileName, contentType } = await readProductQuarterlyReportFile(reportId, format)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "下载失败"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
