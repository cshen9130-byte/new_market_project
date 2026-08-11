import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { canAccessInstructionRecords } from "@/lib/server/instruction-records"
import { readInstructionAttachmentFile } from "@/lib/server/instruction-attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user || !canAccessInstructionRecords(user)) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { id } = await params
    const file = await readInstructionAttachmentFile(id)
    if (!file) {
      return NextResponse.json({ ok: false, error: "附件不存在" }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const download = searchParams.get("download") === "1"
    const encoded = encodeURIComponent(file.filename)
    const disposition = download
      ? `attachment; filename*=UTF-8''${encoded}`
      : `inline; filename*=UTF-8''${encoded}`

    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(file.buffer.length),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取附件失败"
    console.error("[instructions/attachments/file]", message, err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
