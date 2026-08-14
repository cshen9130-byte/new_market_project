import { NextResponse } from "next/server"
import { needsHtmlPreview } from "@/lib/server/fund-contract-materials"
import {
  readElementExtractJobFilePayload,
  readElementExtractJobPreview,
} from "@/lib/server/fund-element-extract-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const jobId = parseInt(id, 10)
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "无效的任务 ID" }, { status: 400 })
    }

    const file = await readElementExtractJobFilePayload(jobId)
    if (!file) {
      return NextResponse.json({ error: "合同文件不存在" }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const download = searchParams.get("download") === "1"
    const preview = searchParams.get("preview") === "1" || (!download && needsHtmlPreview(file.filename))

    if (preview) {
      const previewContent = await readElementExtractJobPreview(jobId)
      if (previewContent) {
        return new NextResponse(previewContent.content, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": previewContent.contentType,
          },
        })
      }
    }

    const encoded = encodeURIComponent(file.filename)
    const disposition = download
      ? `attachment; filename*=UTF-8''${encoded}`
      : `inline; filename*=UTF-8''${encoded}`

    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(file.buffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[ops/fund-elements/jobs/file GET]", err)
    return NextResponse.json({ error: "读取合同文件失败" }, { status: 500 })
  }
}
