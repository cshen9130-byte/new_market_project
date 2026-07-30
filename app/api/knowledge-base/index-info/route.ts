import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  normalizeKnowledgeBasePath,
  listKnowledgeBaseIndexableFiles,
  probeKnowledgeBaseChatExtract,
  knowledgeBaseChatExtractReasonLabel,
} from "@/lib/server/knowledge-base"
import { getDiskIndexInfo } from "@/lib/server/knowledge-chat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

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

    const allFiles = await listKnowledgeBaseIndexableFiles(normalized || "")

    const diskInfo = await getDiskIndexInfo(normalized)
    const indexedSet = new Set(diskInfo.indexedFiles)

    const missingOnDisk = allFiles.filter((f) => !indexedSet.has(f.relativePath))
    const indexed = allFiles.filter((f) => indexedSet.has(f.relativePath)).map((f) => f.relativePath)
    const stale = diskInfo.indexedFiles.filter((p) => !allFiles.find((f) => f.relativePath === p))

    const probes = await mapWithConcurrency(missingOnDisk, 4, async (f) => {
      const probe = await probeKnowledgeBaseChatExtract(f.relativePath)
      return { relativePath: f.relativePath, probe }
    })

    const unembeddableFiles = probes
      .filter((p) => p.probe.status !== "ok")
      .map((p) => ({ path: p.relativePath, reason: knowledgeBaseChatExtractReasonLabel(p.probe) }))
    const pendingEmbedFiles = probes.filter((p) => p.probe.status === "ok").map((p) => p.relativePath)

    const embeddableTotal = indexed.length + pendingEmbedFiles.length
    const percentIndexed =
      embeddableTotal > 0 ? Math.round((indexed.length / embeddableTotal) * 100) : allFiles.length === 0 ? 100 : 0

    return NextResponse.json({
      scope: normalized || "",
      diskIndex: {
        exists: diskInfo.exists,
        indexedDocuments: diskInfo.indexedDocuments,
        indexedChunks: diskInfo.indexedChunks,
        updatedAt: diskInfo.updatedAt,
        model: diskInfo.model,
      },
      coverage: {
        totalOnDisk: allFiles.length,
        indexed: indexed.length,
        notIndexed: pendingEmbedFiles.length,
        unembeddable: unembeddableFiles.length,
        stale: stale.length,
        percentIndexed,
      },
      // Retryable: on disk, extractable, but not yet in PG index.
      notIndexedFiles: pendingEmbedFiles,
      unembeddableFiles,
      staleFiles: stale.slice(0, 50),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

