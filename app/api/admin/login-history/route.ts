import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { listLoginHistory } from "@/lib/server/login-history"

async function requireAdmin(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  const user = userId ? await getUserById(userId) : null
  return user?.role === "admin" ? user : null
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "无权限" }, { status: 403 })
    const url = new URL(req.url)
    const days = Number(url.searchParams.get("days") || "7")
    const limit = Number(url.searchParams.get("limit") || "200")
    const rows = await listLoginHistory({
      days: Number.isFinite(days) ? days : 7,
      limit: Number.isFinite(limit) ? limit : 200,
    })
    return NextResponse.json({ ok: true, rows })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "服务器错误"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
