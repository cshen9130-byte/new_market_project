import { NextResponse } from "next/server"
import {
  getEmailConfirmRecordById,
  readEmailConfirmFile,
} from "@/lib/server/email-confirm-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isFinite(recordId)) {
      return NextResponse.json({ error: "无效的记录 ID" }, { status: 400 })
    }

    const record = await getEmailConfirmRecordById(recordId)
    if (!record) {
      return NextResponse.json({ error: "确认单不存在" }, { status: 404 })
    }

    const file = await readEmailConfirmFile(record)
    if (!file) {
      return NextResponse.json({ error: "确认单文件不存在" }, { status: 404 })
    }

    const encoded = encodeURIComponent(file.filename)
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Content-Length": String(file.buffer.length),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取确认单失败"
    console.error("[ops/email-confirm-records/file]", message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
