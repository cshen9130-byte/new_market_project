import { NextResponse } from "next/server"
import { getUserById, listUsers } from "@/lib/server/users"
import {
  clientIpFromRequest,
  getDeployReadiness,
} from "@/lib/server/deploy-readiness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 })
    }

    const status = getDeployReadiness(clientIpFromRequest(req), user.id)
    const names = new Map((await listUsers()).map((u) => [u.id, u.name]))
    const otherActiveUsers5m = status.otherActiveUsers5m.map((u) => ({
      ...u,
      name: names.get(u.userId) || u.userId,
    }))
    return NextResponse.json({ ok: true, ...status, otherActiveUsers5m })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "服务器错误" },
      { status: 500 },
    )
  }
}
