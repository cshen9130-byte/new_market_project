import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { recoverKnowledgeBaseOwnership } from "@/lib/server/knowledge-base-ownership-recover"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const currentUser = userId ? await getUserById(userId) : null
    if (!currentUser) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }
    if (currentUser.role !== "admin") {
      return NextResponse.json({ ok: false, error: "只有管理员可以恢复归属记录" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const dryRun = body?.dryRun === true
    const useNamePrefix = body?.useNamePrefix !== false

    const report = await recoverKnowledgeBaseOwnership({ dryRun, useNamePrefix })
    return NextResponse.json({ ok: true, report })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 })
  }
}
