import { promises as fs } from "fs"
import { NextResponse } from "next/server"
import {
  deleteKnowledgeBaseFile,
  getKnowledgeBaseFile,
  normalizeKnowledgeBasePath,
  renameKnowledgeBaseFile,
  readKnowledgeBasePreviewContent,
} from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"
import { syncVectorStoreForScope } from "@/lib/server/knowledge-chat"
import { pgRenamePathPrefix } from "@/lib/server/knowledge-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function encodeFileName(fileName: string) {
  return encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const relativePath = normalizeKnowledgeBasePath(searchParams.get("path"))
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }

    const download = searchParams.get("download") === "1"
    const preview = searchParams.get("preview") === "1"

    if (preview) {
      const previewContent = await readKnowledgeBasePreviewContent(relativePath)
      return new NextResponse(previewContent.content, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": previewContent.contentType,
        },
      })
    }

    const file = await getKnowledgeBaseFile(relativePath)
    const buffer = await fs.readFile(file.absolutePath)

    return new NextResponse(buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeFileName(file.name)}`,
        "Content-Length": String(buffer.byteLength),
        "Content-Type": file.mimeType,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再删除文件" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const relativePath = normalizeKnowledgeBasePath(searchParams.get("path"))
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }

    await deleteKnowledgeBaseFile(relativePath, currentUser.id, currentUser.role === "admin")

    const parentFolder = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : ""
    // Warm incremental index for root and parent folder scope.
    void Promise.allSettled([syncVectorStoreForScope(""), syncVectorStoreForScope(parentFolder)])

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const message = error?.message || String(error)
    const status = message.includes("只有上传者可以删除") || message.includes("缺少归属信息") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再重命名文件" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    const newName = String(body?.newName || "").trim()

    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }
    if (!newName) {
      return NextResponse.json({ ok: false, error: "请输入新的文件名" }, { status: 400 })
    }

    const renamed = await renameKnowledgeBaseFile(relativePath, newName, currentUser.id, currentUser.role === "admin")

    // Keep embeddings by migrating path keys in PG instead of clearing all indexes.
    await pgRenamePathPrefix(relativePath, renamed.relativePath)

    const oldParent = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : ""
    const newParent = renamed.relativePath.includes("/") ? renamed.relativePath.slice(0, renamed.relativePath.lastIndexOf("/")) : ""
    const warmScopes = Array.from(new Set(["", oldParent, newParent]))
    void Promise.allSettled(warmScopes.map((scope) => syncVectorStoreForScope(scope)))

    return NextResponse.json({ ok: true, file: renamed })
  } catch (error: any) {
    const message = error?.message || String(error)
    const status = message.includes("只有上传者可以重命名") || message.includes("缺少归属信息") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}