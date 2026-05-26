import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { collectKnowledgeBaseDocuments, normalizeKnowledgeBasePath, isKnowledgeBaseChatSupported } from "@/lib/server/knowledge-base"
import { getDiskIndexInfo } from "@/lib/server/knowledge-chat"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const scope = searchParams.get("scope") ?? null
    const normalized = normalizeKnowledgeBasePath(scope)

    // Collect all indexable files currently on disk for this scope
    let allFiles: { relativePath: string; size: number; updatedAt: string }[] = []
    try {
      const docs = await collectKnowledgeBaseDocuments(normalized || "")
      allFiles = docs.map((d) => ({ relativePath: d.relativePath, size: d.size, updatedAt: d.updatedAt }))
    } catch {
      // If the folder doesn't exist yet, allFiles stays empty
    }

    const diskInfo = getDiskIndexInfo(normalized)
    const indexedSet = new Set(diskInfo.indexedFiles)

    const notIndexed = allFiles.filter((f) => !indexedSet.has(f.relativePath)).map((f) => f.relativePath)
    const indexed = allFiles.filter((f) => indexedSet.has(f.relativePath)).map((f) => f.relativePath)

    // Files in disk index that are no longer on disk (stale entries)
    const stale = diskInfo.indexedFiles.filter((p) => !allFiles.find((f) => f.relativePath === p))

    return NextResponse.json({
      scope: normalized || "",
      // Disk index summary
      diskIndex: {
        exists: diskInfo.exists,
        indexedDocuments: diskInfo.indexedDocuments,
        indexedChunks: diskInfo.indexedChunks,
        updatedAt: diskInfo.updatedAt,
        model: diskInfo.model,
      },
      // Coverage vs. files currently on disk
      coverage: {
        totalOnDisk: allFiles.length,
        indexed: indexed.length,
        notIndexed: notIndexed.length,
        stale: stale.length,
        percentIndexed: allFiles.length > 0 ? Math.round((indexed.length / allFiles.length) * 100) : 0,
      },
      // File lists (capped to avoid huge payloads)
      notIndexedFiles: notIndexed.slice(0, 200),
      staleFiles: stale.slice(0, 50),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
