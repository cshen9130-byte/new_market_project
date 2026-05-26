import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { invalidateVectorStoreCache } from "@/lib/server/knowledge-chat"

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
    const folderPath: string | null = body?.folderPath ?? null

    await invalidateVectorStoreCache(folderPath)

    return NextResponse.json({ ok: true, clearedFolder: folderPath || "全部资料" })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
