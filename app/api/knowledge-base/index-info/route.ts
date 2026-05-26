import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getKnowledgeBaseStorageRoot, normalizeKnowledgeBasePath, isKnowledgeBaseChatSupported } from "@/lib/server/knowledge-base"
import { getDiskIndexInfo } from "@/lib/server/knowledge-chat"
import fs from "fs/promises"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024

/** Lightweight recursive file scan — stat only, no file reading. */
async function scanIndexableFiles(
  absoluteDir: string,
  relativeDir: string,
  results: { relativePath: string; size: number }[],
) {
  let entries
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await scanIndexableFiles(path.join(absoluteDir, entry.name), relativePath, results)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!isKnowledgeBaseChatSupported(ext)) continue
      try {
        const stat = await fs.stat(path.join(absoluteDir, entry.name))
        if (stat.size <= MAX_CHAT_FILE_BYTES) {
          results.push({ relativePath, size: stat.size })
        }
      } catch {
        // skip unreadable
      }
    }
  }
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

    // Fast stat-only scan — no file content reads
    const root = getKnowledgeBaseStorageRoot()
    const targetDir = normalized ? path.join(root, normalized) : root
    const allFiles: { relativePath: string; size: number }[] = []
    await scanIndexableFiles(targetDir, normalized || "", allFiles)

    const diskInfo = await getDiskIndexInfo(normalized)
    const indexedSet = new Set(diskInfo.indexedFiles)

    const notIndexed = allFiles.filter((f) => !indexedSet.has(f.relativePath)).map((f) => f.relativePath)
    const indexed = allFiles.filter((f) => indexedSet.has(f.relativePath)).map((f) => f.relativePath)
    const stale = diskInfo.indexedFiles.filter((p) => !allFiles.find((f) => f.relativePath === p))

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
        notIndexed: notIndexed.length,
        stale: stale.length,
        percentIndexed: allFiles.length > 0 ? Math.round((indexed.length / allFiles.length) * 100) : 0,
      },
      notIndexedFiles: notIndexed.slice(0, 200),
      staleFiles: stale.slice(0, 50),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

