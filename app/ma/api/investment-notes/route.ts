import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  backfillTeamNotesToKnowledgeBase,
  createServerInvestmentNoteWithKbSync,
  deleteServerInvestmentNoteWithKbSync,
  getServerInvestmentNote,
  listServerInvestmentNotes,
  updateServerInvestmentNoteWithKbSync,
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
      const note = getServerInvestmentNote(id, user.id)
      if (!note) {
        return NextResponse.json({ ok: false, error: "笔记不存在" }, { status: 404 })
      }
      return NextResponse.json({ ok: true, note })
    }

    const scope = searchParams.get("scope") === "mine" ? "mine" : "team"
    const hydrateId = String(searchParams.get("hydrateId") || "").trim()

    // Lazy backfill in background so listing notes stays fast
    if (scope === "team") {
      void backfillTeamNotesToKnowledgeBase({
        id: user.id,
        name: user.name,
        email: user.email,
      }).catch((err) => {
        console.error("[investment-notes] KB backfill failed:", err)
      })
    }

    const notes = listServerInvestmentNotes(scope, user.id, {
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
    const note = await createServerInvestmentNoteWithKbSync(
      user.id,
      user.name,
      { id: user.id, name: user.name, email: user.email },
      {
        title: body?.title ? String(body.title) : undefined,
        content: body?.content !== undefined ? String(body.content) : undefined,
        teamShared: Boolean(body?.teamShared),
        associations: body?.associations,
        roadshowAssociations: body?.roadshowAssociations,
      },
    )
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

    const note = await updateServerInvestmentNoteWithKbSync(
      id,
      user.id,
      user.name,
      { id: user.id, name: user.name, email: user.email },
      {
        title: body?.title !== undefined ? String(body.title) : undefined,
        content: body?.content !== undefined ? String(body.content) : undefined,
        contentVariant: body?.contentVariant,
        teamShared: typeof body?.teamShared === "boolean" ? body.teamShared : undefined,
        tags: body?.tags,
        associations: body?.associations,
        roadshowAssociations: body?.roadshowAssociations,
        attachments: body?.attachments,
      },
    )

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

    const deleted = await deleteServerInvestmentNoteWithKbSync(id, user.id)
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
