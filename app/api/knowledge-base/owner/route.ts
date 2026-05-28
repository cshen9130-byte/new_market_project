import { NextResponse } from "next/server"
import { normalizeKnowledgeBasePath, setKnowledgeBaseEntryOwner } from "@/lib/server/knowledge-base"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录后再操作" }, { status: 401 })
    }
    if (currentUser.role !== "admin") {
      return NextResponse.json({ ok: false, error: "只有管理员可以修改归属信息" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    const newOwnerId = String(body?.newOwnerId || "").trim()
    const newOwnerName = String(body?.newOwnerName || "").trim()
    const newOwnerEmail = String(body?.newOwnerEmail || "").trim()

    if (!relativePath) return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    if (!newOwnerId || !newOwnerName) return NextResponse.json({ ok: false, error: "缺少新归属用户信息" }, { status: 400 })

    await setKnowledgeBaseEntryOwner(relativePath, {
      ownerId: newOwnerId,
      ownerName: newOwnerName,
      ownerEmail: newOwnerEmail || undefined,
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}
