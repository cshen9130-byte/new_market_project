import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  createServerInvestmentNote,
  deleteServerInvestmentNote,
  listServerInvestmentNotes,
  updateServerInvestmentNote,
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
    const scope = searchParams.get("scope") === "mine" ? "mine" : "team"
    const notes = listServerInvestmentNotes(scope, user.id)
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
    const note = createServerInvestmentNote(user.id, user.name, {
      title: body?.title ? String(body.title) : undefined,
      content: body?.content !== undefined ? String(body.content) : undefined,
      teamShared: Boolean(body?.teamShared),
    })
    return NextResponse.json({ ok: true, note })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
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

    const note = updateServerInvestmentNote(id, user.id, user.name, {
      title: body?.title !== undefined ? String(body.title) : undefined,
      content: body?.content !== undefined ? String(body.content) : undefined,
      contentVariant: body?.contentVariant,
      teamShared: body?.teamShared,
      tags: body?.tags,
      associations: body?.associations,
      attachments: body?.attachments,
    })

    if (!note) {
      return NextResponse.json({ ok: false, error: "笔记不存在" }, { status: 404 })
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
    const id = String(searchParams.get("id") || "").trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少笔记 ID" }, { status: 400 })
    }

    const deleted = deleteServerInvestmentNote(id, user.id)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "笔记不存在" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("权限") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
