import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { normalizeKnowledgeBasePath } from "@/lib/server/knowledge-base"
import { startEmbedJob, getEmbedJobStatus } from "@/lib/server/knowledge-chat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const folderPath = normalizeKnowledgeBasePath(body?.folderPath ?? null)

    // Don't start a new job if one is already running for this scope
    const existing = getEmbedJobStatus(folderPath)
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return NextResponse.json({ ok: true, started: false, message: "向量化任务已在运行中" })
    }

    startEmbedJob(folderPath)
    return NextResponse.json({ ok: true, started: true, scope: folderPath || "全部资料" })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
