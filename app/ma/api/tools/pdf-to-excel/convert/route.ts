import { convertUploadedPdf, parsePdfExcelMode, type PdfExcelSummary } from "@/lib/server/pdf-to-excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

const MAX_BYTES = 40 * 1024 * 1024

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

export async function POST(request: Request) {
  let fileBuffer: Buffer
  let fileName: string
  let mode: ReturnType<typeof parsePdfExcelMode>
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return jsonError("请先上传一个 PDF 文件。", 400)
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return jsonError("仅支持 PDF 文件。", 400)
    }
    fileBuffer = Buffer.from(await file.arrayBuffer())
    fileName = file.name
    mode = parsePdfExcelMode(formData.get("mode"))
  } catch {
    return jsonError("上传内容无法读取。", 400)
  }

  if (fileBuffer.length === 0 || fileBuffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return jsonError("文件不是有效的 PDF。", 400)
  }
  if (fileBuffer.length > MAX_BYTES) {
    return jsonError("PDF 不能超过 40MB。", 400)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      try {
        send({ type: "progress", percent: 4, message: "已收到文件，开始识别" })
        const summary: PdfExcelSummary = await convertUploadedPdf(fileBuffer, fileName, mode, (update) => {
          send({ type: "progress", percent: update.percent, message: update.message })
        })
        send({ type: "result", summary })
      } catch (error) {
        const message = error instanceof Error ? error.message : "PDF 提取失败。"
        send({ type: "error", error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  })
}
