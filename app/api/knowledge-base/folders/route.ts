import { NextResponse } from "next/server"
import { createKnowledgeBaseFolder, deleteKnowledgeBaseFolder, moveKnowledgeBaseFolder, normalizeKnowledgeBasePath, renameKnowledgeBaseFolder } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"
import { invalidateVectorStoreCache, syncVectorStoreForScope } from "@/lib/server/knowledge-chat"
import { pgRenamePathPrefix } from "@/lib/server/knowledge-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再创建文件夹" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "请输入文件夹名称" }, { status: 400 })
    }

    const folder = await createKnowledgeBaseFolder(relativePath, {
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerEmail: currentUser.email,
    })
    return NextResponse.json({ ok: true, folder })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再删除文件夹" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "请提供文件夹路径" }, { status: 400 })
    }

    await deleteKnowledgeBaseFolder(relativePath, currentUser.id, currentUser.role === "admin")

    // Folder deletion can affect multiple nested scopes; clear all caches then warm root.
    await invalidateVectorStoreCache()
    void syncVectorStoreForScope("")

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再重命名文件夹" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    const newName = String(body?.newName || "").trim()

    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "请提供文件夹路径" }, { status: 400 })
    }
    if (!newName) {
      return NextResponse.json({ ok: false, error: "请输入新的文件夹名称" }, { status: 400 })
    }

    const renamed = await renameKnowledgeBaseFolder(relativePath, newName, currentUser.id, currentUser.role === "admin")

    // Migrate all PG index rows to the new path in-place (preserves embeddings).
    // Then evict only the affected in-memory scopes so they reload from PG on next query.
    await pgRenamePathPrefix(relativePath, renamed.relativePath)
    await invalidateVectorStoreCache(relativePath)
    await invalidateVectorStoreCache(renamed.relativePath)

    return NextResponse.json({ ok: true, folder: renamed })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再移动文件夹" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const sourcePath = normalizeKnowledgeBasePath(body?.path)
    const destinationParent = body?.destinationParent == null ? null : normalizeKnowledgeBasePath(String(body.destinationParent))

    if (!sourcePath) {
      return NextResponse.json({ ok: false, error: "请提供文件夹路径" }, { status: 400 })
    }
    if (destinationParent === undefined) {
      return NextResponse.json({ ok: false, error: "请提供目标文件夹路径" }, { status: 400 })
    }

    const moved = await moveKnowledgeBaseFolder(sourcePath, destinationParent ?? "", currentUser.id, currentUser.role === "admin")

    await invalidateVectorStoreCache()
    void syncVectorStoreForScope("")

    return NextResponse.json({ ok: true, folder: moved })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}