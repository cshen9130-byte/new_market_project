import { NextResponse } from "next/server"
import { askKnowledgeBaseQuestion } from "@/lib/server/knowledge-chat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const answer = await askKnowledgeBaseQuestion({
      question: String(body?.question || ""),
      folderPath: body?.folderPath,
    })

    return NextResponse.json({ ok: true, ...answer })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}