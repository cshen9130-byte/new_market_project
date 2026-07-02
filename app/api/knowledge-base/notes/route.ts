import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  deleteKnowledgeNote,
  getKnowledgeNote,
  listKnowledgeNotes,
  saveKnowledgeNote,
} from "@/lib/server/knowledge-notes"

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

    const { searchParams } = new URL(req.url)
    if (searchParams.get("list") === "1") {
      const notes = listKnowledgeNotes(user.id)
      return NextResponse.json({ ok: true, notes })
    }

    const noteId = String(searchParams.get("id") || "").trim()
    if (!noteId) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const note = getKnowledgeNote(user.id, noteId)
    if (!note) {
      return NextResponse.json({ ok: false, error: "笔记不存在" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, note })
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
    const title = String(body?.title || "").trim()
    if (!title) {
      return NextResponse.json({ ok: false, error: "请输入笔记标题" }, { status: 400 })
    }

    const note = saveKnowledgeNote(user.id, {
      id: body?.id ? String(body.id) : null,
      title,
      content: String(body?.content ?? ""),
    })

    return NextResponse.json({ ok: true, note })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const noteId = String(searchParams.get("id") || "").trim()
    if (!noteId) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const deleted = deleteKnowledgeNote(user.id, noteId)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "笔记不存在" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
