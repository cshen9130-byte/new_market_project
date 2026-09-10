import { NextResponse } from "next/server"
import { getUserById, rotateUserApiKey } from "@/lib/server/users"

export async function POST(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }
    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    }
    const api_key = await rotateUserApiKey(userId)
    return NextResponse.json({ ok: true, api_key, user: { ...user, api_key } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "服务器错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
