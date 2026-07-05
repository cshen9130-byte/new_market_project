import { promises as fs } from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { CHAT_DOC_MAX_FILE_BYTES, CHAT_DOC_MAX_TEXT_CHARS } from "@/lib/ma/chat-documents"
import { getKnowledgeBaseFile, readFileDocumentText } from "@/lib/server/knowledge-base"
import { getServerStoragePath } from "@/lib/server/storage"

export const runtime = "nodejs"

async function extractFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase()
  if (!ext) throw new Error("无法识别文件类型")

  const tempDir = getServerStoragePath("chat-docs", "tmp")
  await fs.mkdir(tempDir, { recursive: true })
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const tempPath = path.join(tempDir, safeName)

  try {
    await fs.writeFile(tempPath, buffer)
    return (await readFileDocumentText(tempPath, ext)).trim()
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const relativePath = typeof body.relativePath === "string" ? body.relativePath.trim() : ""
    const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : ""
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "upload"

    let text = ""
    if (relativePath) {
      const file = await getKnowledgeBaseFile(relativePath)
      text = (await readFileDocumentText(file.absolutePath, file.extension)).trim()
    } else if (fileBase64) {
      const buffer = Buffer.from(fileBase64, "base64")
      if (buffer.byteLength > CHAT_DOC_MAX_FILE_BYTES) {
        return NextResponse.json({ error: "文件大小不能超过 15MB" }, { status: 400 })
      }
      text = await extractFromBuffer(buffer, fileName)
    } else {
      return NextResponse.json({ error: "缺少 relativePath 或 fileBase64" }, { status: 400 })
    }

    const truncated = text.length > CHAT_DOC_MAX_TEXT_CHARS
    return NextResponse.json({
      text: truncated ? text.slice(0, CHAT_DOC_MAX_TEXT_CHARS) : text,
      truncated,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
