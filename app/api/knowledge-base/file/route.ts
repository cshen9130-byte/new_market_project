import { promises as fs } from "fs"
import { NextResponse } from "next/server"
import { deleteKnowledgeBaseFile, getKnowledgeBaseFile, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function encodeFileName(fileName: string) {
  return encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const relativePath = normalizeKnowledgeBasePath(searchParams.get("path"))
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }

    const download = searchParams.get("download") === "1"
    const file = await getKnowledgeBaseFile(relativePath)
    const buffer = await fs.readFile(file.absolutePath)

    return new NextResponse(buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeFileName(file.name)}`,
        "Content-Length": String(buffer.byteLength),
        "Content-Type": file.mimeType,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再删除文件" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const relativePath = normalizeKnowledgeBasePath(searchParams.get("path"))
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }

    await deleteKnowledgeBaseFile(relativePath, currentUser.id)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const message = error?.message || String(error)
    const status = message.includes("只有上传者可以删除") || message.includes("缺少归属信息") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}