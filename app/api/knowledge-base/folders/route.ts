import { NextResponse } from "next/server"
import { createKnowledgeBaseFolder, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "请输入文件夹名称" }, { status: 400 })
    }

    const folder = await createKnowledgeBaseFolder(relativePath)
    return NextResponse.json({ ok: true, folder })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}