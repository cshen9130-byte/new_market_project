import { NextResponse } from "next/server"
import AdmZip from "adm-zip"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { getUserById } from "@/lib/server/users"
import {
  normalizeKnowledgeBasePath,
  saveKnowledgeBaseFile,
  saveKnowledgeBaseFileWithRelativePath,
  deduplicateKnowledgeBaseFolder,
} from "@/lib/server/knowledge-base"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Temp directory for chunked uploads */
const CHUNK_TEMP_BASE = path.join(os.tmpdir(), "kb-upload-chunks")

async function assembleChunks(sessionId: string, totalChunks: number): Promise<Buffer> {
  const sessionDir = path.join(CHUNK_TEMP_BASE, sessionId)
  const parts: Buffer[] = []
  for (let i = 0; i < totalChunks; i++) {
    parts.push(await fs.readFile(path.join(sessionDir, `chunk_${i}`)))
  }
  // Clean up temp dir after reading
  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  return Buffer.concat(parts)
}

/** Max uncompressed size for a single file extracted from a ZIP (50 MB) */
const ZIP_MAX_EXTRACT_BYTES = 50 * 1024 * 1024

interface KnowledgeBaseFileOwner {
  ownerId: string
  ownerName: string
  ownerEmail: string
}

async function extractZipBuffer(
  buffer: Buffer,
  folderPath: string,
  owner: KnowledgeBaseFileOwner,
): Promise<{ saved: unknown[]; skipped: Array<{ name: string; reason: string }> }> {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  const saved: unknown[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  for (const entry of entries) {
    if (entry.isDirectory) continue

    // Security: sanitize the path inside the ZIP to prevent path traversal
    const rawPath = entry.entryName.replace(/\\/g, "/")
    let sanitizedPath: string
    try {
      sanitizedPath = normalizeKnowledgeBasePath(rawPath)
    } catch {
      skipped.push({ name: entry.entryName, reason: "路径不合法，已跳过" })
      continue
    }
    if (!sanitizedPath) continue

    const uncompressedSize = entry.header.size
    if (uncompressedSize > ZIP_MAX_EXTRACT_BYTES) {
      skipped.push({
        name: sanitizedPath,
        reason: `文件过大（${Math.round(uncompressedSize / 1024 / 1024)} MB，超过 ${ZIP_MAX_EXTRACT_BYTES / 1024 / 1024} MB），已跳过`,
      })
      continue
    }

    const data = entry.getData()
    const fileName = sanitizedPath.split("/").at(-1) ?? sanitizedPath
    const virtualFile = new File([data], fileName, { type: "application/octet-stream" })

    try {
      const node = await saveKnowledgeBaseFileWithRelativePath(folderPath, sanitizedPath, virtualFile, owner)
      saved.push(node)
    } catch (e: unknown) {
      skipped.push({ name: sanitizedPath, reason: (e as Error)?.message || "保存失败" })
    }
  }

  return { saved, skipped }
}

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
    const skipDedup = String(form.get("skipDedup") || "").toLowerCase() === "true"

    // ── Chunked upload ────────────────────────────────────────────────────────
    const chunkSessionId = String(form.get("chunkSessionId") || "").trim()
    const chunkIndexStr = form.get("chunkIndex")
    const totalChunksStr = form.get("totalChunks")
    if (chunkSessionId && chunkIndexStr !== null && totalChunksStr !== null) {
      const chunkIndex = parseInt(String(chunkIndexStr))
      const totalChunks = parseInt(String(totalChunksStr))
      const originalFileName = String(form.get("originalFileName") || files[0]?.name || "")
      const relPath = relativePaths[0] || originalFileName

      if (isNaN(chunkIndex) || isNaN(totalChunks) || !files[0]) {
        return NextResponse.json({ ok: false, error: "分块上传参数错误" }, { status: 400 })
      }
      // Prevent path traversal via session ID
      if (!/^[0-9a-f-]{36}$/i.test(chunkSessionId)) {
        return NextResponse.json({ ok: false, error: "非法的会话 ID" }, { status: 400 })
      }

      const sessionDir = path.join(CHUNK_TEMP_BASE, chunkSessionId)
      await fs.mkdir(sessionDir, { recursive: true })
      const chunkData = Buffer.from(await files[0].arrayBuffer())
      await fs.writeFile(path.join(sessionDir, `chunk_${chunkIndex}`), chunkData)

      // Not the last chunk — just acknowledge receipt
      if (chunkIndex < totalChunks - 1) {
        return NextResponse.json({ ok: true, partial: true })
      }

      // Last chunk — reassemble and process
      const assembled = await assembleChunks(chunkSessionId, totalChunks)
      const owner: KnowledgeBaseFileOwner = {
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        ownerEmail: currentUser.email,
      }

      if (originalFileName.toLowerCase().endsWith(".zip")) {
        const result = await extractZipBuffer(assembled, folderPath, owner)
        return NextResponse.json({ ok: true, files: result.saved, extractedSkipped: result.skipped })
      } else {
        const virtualFile = new File([assembled], path.basename(originalFileName), { type: "application/octet-stream" })
        const node = await saveKnowledgeBaseFileWithRelativePath(folderPath, relPath, virtualFile, owner)
        return NextResponse.json({ ok: true, files: [node] })
      }
    }
    // ── End chunked upload ────────────────────────────────────────────────────

    if (files.length > 0) {
      if (relativePaths.length !== files.length) {
        return NextResponse.json({ ok: false, error: "批量上传参数不匹配" }, { status: 400 })
      }

      const owner: KnowledgeBaseFileOwner = {
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        ownerEmail: currentUser.email,
      }

      const savedFiles: unknown[] = []
      const extractedSkipped: Array<{ name: string; reason: string }> = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const relPath = relativePaths[i] || file.name

        if (file.name.toLowerCase().endsWith(".zip")) {
          // Extract ZIP directly from buffer instead of saving the archive
          const buffer = Buffer.from(await file.arrayBuffer())
          const result = await extractZipBuffer(buffer, folderPath, owner)
          savedFiles.push(...result.saved)
          extractedSkipped.push(...result.skipped)
        } else {
          const node = await saveKnowledgeBaseFileWithRelativePath(folderPath, relPath, file, owner)
          savedFiles.push(node)
        }
      }

      let dedupDeleted = 0
      if (!skipDedup && files.length > 1) {
        // Deduplicate only for true multi-file uploads to avoid O(n) folder scans
        // on each per-file sequential upload request.
        const dedup = await deduplicateKnowledgeBaseFolder(folderPath || "")
        dedupDeleted = dedup.deleted.length
      }

      return NextResponse.json({ ok: true, files: savedFiles, dedupDeleted, extractedSkipped })
    }

    const file = form.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "请选择文件" }, { status: 400 })
    }

    const owner: KnowledgeBaseFileOwner = {
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerEmail: currentUser.email,
    }

    if (file.name.toLowerCase().endsWith(".zip")) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await extractZipBuffer(buffer, folderPath, owner)
      return NextResponse.json({ ok: true, files: result.saved, extractedSkipped: result.skipped })
    }

    const savedFile = await saveKnowledgeBaseFile(folderPath, file, owner)
    return NextResponse.json({ ok: true, file: savedFile })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}