import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { listConversations, createConversation } from "@/lib/server/chat-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const conversations = listConversations(user.id)
    return NextResponse.json({ ok: true, conversations })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const title = String(body?.title || "新对话").slice(0, 200)
    const scope = String(body?.scope ?? "")
    const scopeType: "folder" | "file" = body?.scopeType === "file" ? "file" : "folder"

    const conversation = createConversation(user.id, title, scope, scopeType)
    return NextResponse.json({ ok: true, conversation })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
