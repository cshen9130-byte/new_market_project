import { NextResponse } from "next/server"
import { normalizeKnowledgeBasePath, setKnowledgeBaseEntryLocked } from "@/lib/server/knowledge-base"
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

    const body = await req.json().catch(() => ({}))
    const relativePath = normalizeKnowledgeBasePath(body?.path)
    const locked = Boolean(body?.locked)

    if (!relativePath) {
      return NextResponse.json({ ok: false, error: "缺少文件路径" }, { status: 400 })
    }

    await setKnowledgeBaseEntryLocked(relativePath, locked, currentUser.id, currentUser.role === "admin", { name: currentUser.name, email: currentUser.email })

    return NextResponse.json({ ok: true, locked })
  } catch (error: any) {
    const message = error?.message || String(error)
    const status = message.includes("只有上传者或管理员") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
