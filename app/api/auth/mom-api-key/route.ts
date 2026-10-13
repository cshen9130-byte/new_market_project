import { NextResponse } from "next/server"
import { canAccessMomDataApi } from "@/lib/permissions"
import { getUserById, rotateUserMomApiKey } from "@/lib/server/users"

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
    if (!canAccessMomDataApi(user)) {
      return NextResponse.json({ error: "当前账户没有 MOM数据API 权限" }, { status: 403 })
    }
    const mom_api_key = await rotateUserMomApiKey(userId)
    return NextResponse.json({ ok: true, mom_api_key, user: { ...user, mom_api_key } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "服务器错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
