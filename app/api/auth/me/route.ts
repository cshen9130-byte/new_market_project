import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }
    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, user })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "服务器错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
