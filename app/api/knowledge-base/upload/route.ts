import { NextResponse } from "next/server"
import { normalizeKnowledgeBasePath, saveKnowledgeBaseFile } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    const folderPath = normalizeKnowledgeBasePath(String(form.get("folderPath") || ""))

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请选择文件" }, { status: 400 })
    }

    const savedFile = await saveKnowledgeBaseFile(folderPath, file)
    return NextResponse.json({ ok: true, file: savedFile })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}