import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  emptyServerInvestmentNoteTrash,
  getServerTrashedInvestmentNote,
  listServerTrashedInvestmentNotes,
  purgeServerInvestmentNote,
  restoreServerInvestmentNoteWithKbSync,
} from "@/lib/server/investment-notes"

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
    const id = String(searchParams.get("id") || "").trim()
    if (id) {
      const note = getServerTrashedInvestmentNote(id, user.id)
      if (!note) {
        return NextResponse.json({ ok: false, error: "回收站中没有该笔记" }, { status: 404 })
      }
      return NextResponse.json({ ok: true, note })
    }

    const hydrateId = String(searchParams.get("hydrateId") || "").trim()
    const notes = listServerTrashedInvestmentNotes(user.id, {
      hydrateId: hydrateId || undefined,
    })
    return NextResponse.json({ ok: true, notes })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const id = String(body?.id || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const note = await restoreServerInvestmentNoteWithKbSync(id, user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
    })
    if (!note) {
      return NextResponse.json({ ok: false, error: "回收站中没有该笔记" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, note })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("权限") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get("empty") === "1") {
      const deleted = emptyServerInvestmentNoteTrash(user.id)
      return NextResponse.json({ ok: true, deleted })
    }

    const id = String(searchParams.get("id") || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const purged = purgeServerInvestmentNote(id, user.id)
    if (!purged) {
      return NextResponse.json({ ok: false, error: "回收站中没有该笔记" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("权限") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
