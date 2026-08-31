import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { parseRecentPagesPayload } from "@/lib/client/recent-pages"
import { readRecentPages, writeRecentPages } from "@/lib/server/recent-pages-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null
  return getUserById(userId)
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
    }
    return NextResponse.json({ ok: true, pages: readRecentPages(user.id) })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 })
    }
    const body = await req.json().catch(() => ({}))
    const incoming = parseRecentPagesPayload(body?.pages)
    const pages = writeRecentPages(user.id, incoming)
    return NextResponse.json({ ok: true, pages })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
