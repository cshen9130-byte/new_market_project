import { proxyCtpMarket } from "@/lib/server/ctp-market-proxy"
import { requireCshen } from "@/lib/server/require-cshen"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { watcherId?: string; watcher_id?: string }
  const watcherId = String(body.watcherId || body.watcher_id || "").trim()
  if (!watcherId) return NextResponse.json({ ok: true, watchers: 0 })
  return proxyCtpMarket("/api/unwatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watcher_id: watcherId }),
  })
}
