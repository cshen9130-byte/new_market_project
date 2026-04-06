import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getGraphVizData } from "@/lib/server/knowledge-chat"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const folderPath = searchParams.get("folderPath") || null

    const data = await getGraphVizData(folderPath)
    return NextResponse.json({ ok: true, ...data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
