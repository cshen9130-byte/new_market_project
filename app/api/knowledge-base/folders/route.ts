import { NextResponse } from "next/server"
import { createKnowledgeBaseFolder, deleteKnowledgeBaseFolder, moveKnowledgeBaseFolder, normalizeKnowledgeBasePath, renameKnowledgeBaseFolder } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"
import { syncVectorStoreForScope } from "@/lib/server/knowledge-chat"
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

    const parentFolder = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : ""
    // Re-sync incrementally without clearing unrelated scopes.
    void Promise.allSettled([syncVectorStoreForScope(""), syncVectorStoreForScope(parentFolder)])

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
    // Then re-sync incrementally without wiping unrelated scopes.
    await pgRenamePathPrefix(relativePath, renamed.relativePath)

    const oldParent = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : ""
    const newParent = renamed.relativePath.includes("/") ? renamed.relativePath.slice(0, renamed.relativePath.lastIndexOf("/")) : ""
    const warmScopes = Array.from(new Set(["", oldParent, newParent, renamed.relativePath]))
    void Promise.allSettled(warmScopes.map((scope) => syncVectorStoreForScope(scope)))

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

    // Keep embeddings when moving by rewriting PG path prefixes in-place.
    await pgRenamePathPrefix(sourcePath, moved.relativePath)

    const oldParent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : ""
    const newParent = moved.relativePath.includes("/") ? moved.relativePath.slice(0, moved.relativePath.lastIndexOf("/")) : ""
    const warmScopes = Array.from(new Set(["", oldParent, newParent, moved.relativePath]))
    void Promise.allSettled(warmScopes.map((scope) => syncVectorStoreForScope(scope)))

    return NextResponse.json({ ok: true, folder: moved })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}