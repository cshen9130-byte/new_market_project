import { NextResponse } from "next/server"
import path from "path"
import { promises as fs } from "fs"
import AdmZip from "adm-zip"
import { getKnowledgeBaseStorageRoot, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_ZIP_BYTES = 512 * 1024 * 1024 // 512 MB

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rawPath = searchParams.get("path") || ""
    const normalized = normalizeKnowledgeBasePath(rawPath)
    if (!normalized) {
      return NextResponse.json({ ok: false, error: "请提供有效的文件夹路径" }, { status: 400 })
    }

    const storageRoot = getKnowledgeBaseStorageRoot()
    const absPath = path.join(storageRoot, normalized)

    // Security: ensure the resolved path is inside the storage root
    const resolvedAbs = path.resolve(absPath)
    const resolvedRoot = path.resolve(storageRoot)
    if (!resolvedAbs.startsWith(resolvedRoot + path.sep) && resolvedAbs !== resolvedRoot) {
      return NextResponse.json({ ok: false, error: "路径不合法" }, { status: 400 })
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(resolvedAbs)
    } catch {
      return NextResponse.json({ ok: false, error: "文件夹不存在" }, { status: 404 })
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ ok: false, error: "目标不是文件夹" }, { status: 400 })
    }

    // Size guard: walk tree and sum file sizes before zipping
    async function sumDirectorySize(dirPath: string): Promise<number> {
      let total = 0
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const childPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          total += await sumDirectorySize(childPath)
        } else if (entry.isFile()) {
          const s = await fs.stat(childPath)
          total += s.size
        }
        if (total > MAX_ZIP_BYTES) break
      }
      return total
    }

    const totalSize = await sumDirectorySize(resolvedAbs)
    if (totalSize > MAX_ZIP_BYTES) {
      return NextResponse.json(
        { ok: false, error: `文件夹过大（超过 ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB），无法打包下载` },
        { status: 413 }
      )
    }

    const folderName = path.basename(resolvedAbs)
    const zip = new AdmZip()
    zip.addLocalFolder(resolvedAbs, folderName)
    const buffer = zip.toBuffer()

    const safeFileName = encodeURIComponent(`${folderName}.zip`)
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`,
        "Content-Length": String(buffer.length),
      },
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}
