import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getUserTokenStats, getRecentTokenRecords } from "@/lib/server/token-usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500)

    const userStats = getUserTokenStats()
    const recentRecords = getRecentTokenRecords(limit)
    const totalTokens = userStats.reduce((s, u) => s + u.totalTokens, 0)
    const totalRequests = userStats.reduce((s, u) => s + u.requestCount, 0)

    return NextResponse.json({ ok: true, userStats, recentRecords, totalTokens, totalRequests })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
