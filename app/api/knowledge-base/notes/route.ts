import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { getKnowledgeNote, saveKnowledgeNote } from "@/lib/server/knowledge-notes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const note = getKnowledgeNote(user.id)
    return NextResponse.json({
      ok: true,
      note: {
        content: note?.content || "",
        updatedAt: note?.updatedAt || null,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const content = String(body?.content ?? "")
    const note = saveKnowledgeNote(user.id, content)

    return NextResponse.json({
      ok: true,
      note: {
        content: note.content,
        updatedAt: note.updatedAt,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
