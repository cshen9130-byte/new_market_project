import { NextResponse } from "next/server"
import { addUser, getUserById, listUsers } from "@/lib/server/users"

async function requireAdmin(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  const user = userId ? await getUserById(userId) : null
  return user?.role === "admin" ? user : null
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "无权限" }, { status: 403 })
    const users = await listUsers()
    return NextResponse.json({ ok: true, users })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "无权限" }, { status: 403 })
    const body = await req.json()
    const { email, name, password, role } = body || {}
    if (!email || !name || !password) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 })
    }
    const user = await addUser({ email, name, password, role })
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
