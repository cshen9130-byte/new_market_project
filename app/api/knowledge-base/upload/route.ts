import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  normalizeKnowledgeBasePath,
  saveKnowledgeBaseFile,
  saveKnowledgeBaseFileWithRelativePath,
  deduplicateKnowledgeBaseFolder,
} from "@/lib/server/knowledge-base"
import { startEmbedJob } from "@/lib/server/knowledge-chat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再上传文件" }, { status: 401 })
    }

    const form = await req.formData()
    const folderPath = normalizeKnowledgeBasePath(String(form.get("folderPath") || ""))
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File)
    const relativePaths = form.getAll("relativePaths").map((entry) => String(entry || ""))

    if (files.length > 0) {
      if (relativePaths.length !== files.length) {
        return NextResponse.json({ ok: false, error: "批量上传参数不匹配" }, { status: 400 })
      }

      const savedFiles = await Promise.all(
        files.map((file, index) =>
          saveKnowledgeBaseFileWithRelativePath(folderPath, relativePaths[index] || file.name, file, {
            ownerId: currentUser.id,
            ownerName: currentUser.name,
            ownerEmail: currentUser.email,
          }),
        ),
      )

      // Deduplicate the folder after saving — remove content-identical files.
      // No cache invalidation needed: getOrBuildVectorStore handles deleted files
      // incrementally (it filters removed files from baseRows using the deleted set).
      const dedup = await deduplicateKnowledgeBaseFolder(folderPath || "")

      // Start tracked background embedding for the target folder only.
      // Root scope is rebuilt lazily (incrementally) on next chat query.
      startEmbedJob(folderPath)

      return NextResponse.json({ ok: true, files: savedFiles, dedupDeleted: dedup.deleted.length })
    }

    const file = form.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请选择文件" }, { status: 400 })
    }

    const savedFile = await saveKnowledgeBaseFile(folderPath, file, {
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerEmail: currentUser.email,
    })
    // Start tracked background embedding for the target folder only.
    // Root scope is rebuilt lazily (incrementally) on next chat query.
    startEmbedJob(folderPath)
    return NextResponse.json({ ok: true, file: savedFile })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}