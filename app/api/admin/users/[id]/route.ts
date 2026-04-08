import { NextResponse } from "next/server"
import { deleteUser, getUserById, updateUser } from "@/lib/server/users"

type RouteContext = {
  params: Promise<{ id: string }>
}

async function requireAdmin(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  const user = userId ? await getUserById(userId) : null
  return user?.role === "admin" ? user : null
}

export async function PUT(_req: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin(_req)
    if (!admin) return NextResponse.json({ error: "无权限" }, { status: 403 })
    const { id } = await params
    const body = await _req.json()
    const user = await updateUser(id, body || {})
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin(_req)
    if (!admin) return NextResponse.json({ error: "无权限" }, { status: 403 })
    const { id } = await params
    await deleteUser(id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
