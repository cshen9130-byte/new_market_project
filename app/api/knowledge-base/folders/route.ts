import { NextResponse } from "next/server"
import { createKnowledgeBaseFolder, deleteKnowledgeBaseFolder, normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"
import { invalidateVectorStoreCache, syncVectorStoreForScope } from "@/lib/server/knowledge-chat"

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
    invalidateVectorStoreCache()
    void syncVectorStoreForScope("")

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}