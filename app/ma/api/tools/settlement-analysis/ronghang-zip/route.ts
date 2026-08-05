import { NextResponse } from "next/server"

import { isRonghangArchiveFilename } from "@/lib/server/ronghang-archive"
import { analyzeRonghangZipBuffer } from "@/lib/server/ronghang-zip-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一个 ZIP/RAR 结算单压缩包。" }, { status: 400 })
    }

    if (!isRonghangArchiveFilename(file.name)) {
      return NextResponse.json(
        { error: "仅支持 .zip / .rar 文件（例如融航结算单 data.zip）。" },
        { status: 400 },
      )
    }

    const maxBytes = 80 * 1024 * 1024
    if (file.size > maxBytes) {
      return NextResponse.json({ error: "压缩包过大，请控制在 80MB 以内。" }, { status: 400 })
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const report = await analyzeRonghangZipBuffer(fileBuffer, file.name)
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : "融航结算单压缩包分析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
