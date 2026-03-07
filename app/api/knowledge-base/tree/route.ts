import { NextResponse } from "next/server"
import { getKnowledgeBaseStorageDisplayPath, listKnowledgeBaseTree } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const tree = await listKnowledgeBaseTree()
    return NextResponse.json({
      ok: true,
      rootPath: getKnowledgeBaseStorageDisplayPath(),
      tree,
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}