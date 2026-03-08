import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getConversation, getMessages, deleteConversation, updateConversationTitle } from "@/lib/server/chat-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const { id } = await params
    const conversation = getConversation(id, user.id)
    if (!conversation) return NextResponse.json({ ok: false, error: "对话不存在" }, { status: 404 })

    const messages = getMessages(id, user.id)
    return NextResponse.json({ ok: true, conversation, messages })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const title = String(body?.title || "").slice(0, 200)
    if (!title) return NextResponse.json({ ok: false, error: "标题不能为空" }, { status: 400 })

    updateConversationTitle(id, user.id, title)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const { id } = await params
    deleteConversation(id, user.id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
