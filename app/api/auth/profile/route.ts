import { NextResponse } from "next/server"
import { getUserById, updateUser, verifyLogin } from "@/lib/server/users"

export async function PUT(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    }

    const body = await req.json()
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : ""

    if (!name && !password) {
      return NextResponse.json({ error: "无更新内容" }, { status: 400 })
    }

    if (password) {
      if (!currentPassword) {
        return NextResponse.json({ error: "请输入当前密码" }, { status: 400 })
      }
      if (password.length < 6) {
        return NextResponse.json({ error: "新密码至少 6 位" }, { status: 400 })
      }
      const verified = await verifyLogin(user.email, currentPassword)
      if (!verified || verified.id !== userId) {
        const byName = await verifyLogin(user.name, currentPassword)
        if (!byName || byName.id !== userId) {
          return NextResponse.json({ error: "当前密码不正确" }, { status: 400 })
        }
      }
    }

    const updates: Partial<{ name: string; password: string }> = {}
    if (name) updates.name = name
    if (password) updates.password = password

    const updated = await updateUser(userId, updates)
    return NextResponse.json({ ok: true, user: updated })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "服务器错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
