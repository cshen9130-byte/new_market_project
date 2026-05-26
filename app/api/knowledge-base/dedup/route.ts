import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { normalizeKnowledgeBasePath, deduplicateKnowledgeBaseFolder } from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const folderPath = normalizeKnowledgeBasePath(body?.folderPath ?? null)

    const result = await deduplicateKnowledgeBaseFolder(folderPath || "")

    // No cache invalidation needed: getOrBuildVectorStore handles deleted files
    // incrementally. It compares fingerprints and filters deleted files from baseRows,
    // so only truly new/changed files get re-embedded on the next chat query or embed job.

    return NextResponse.json({
      ok: true,
      scope: folderPath || "全部资料",
      scanned: result.scanned,
      deleted: result.deleted.length,
      kept: result.kept.length,
      deletedFiles: result.deleted.slice(0, 100),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
