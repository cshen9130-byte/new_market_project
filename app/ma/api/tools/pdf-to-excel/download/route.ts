import { NextResponse } from "next/server"

import { readPdfExcelDownload } from "@/lib/server/pdf-to-excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? ""
    const file = await readPdfExcelDownload(id)
    if (!file) {
      return NextResponse.json({ error: "提取结果已过期，请重新上传。" }, { status: 404 })
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
