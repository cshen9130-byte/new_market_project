import { promises as fs } from "fs"
import { NextResponse } from "next/server"
import { getKnowledgeBaseFile, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"

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