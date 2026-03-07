import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getKnowledgeBaseStorageDisplayPath, listKnowledgeBaseTree } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    const tree = await listKnowledgeBaseTree(currentUser?.id)
    return NextResponse.json({
      ok: true,
      rootPath: getKnowledgeBaseStorageDisplayPath(),
      tree,
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}