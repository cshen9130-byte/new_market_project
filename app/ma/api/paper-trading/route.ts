import { NextResponse } from "next/server"
import { parsePaperState, type PaperScope } from "@/lib/client/paper-trading"
import {
  readMinePaperState,
  readTeamPaperState,
  writeMinePaperState,
  writeTeamPaperState,
} from "@/lib/server/paper-trading-store"
import { getUserById } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function GET(req: Request) {
  try {
    const user = await getUser(req)
    const team = readTeamPaperState()
    const mine = user ? readMinePaperState(user.id) : parsePaperState({})
    return NextResponse.json({ ok: true, team, mine, userId: user?.id || null })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[paper-trading GET]", message)
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
    const scope = String(body?.scope || "") as PaperScope
    if (scope !== "team" && scope !== "mine") {
      return NextResponse.json({ ok: false, error: "invalid_scope" }, { status: 400 })
    }

    const state = parsePaperState(body?.state)
    const knownIds = Array.isArray(body?.knownIds) ? body.knownIds.map(String) : undefined
    if (scope === "team") writeTeamPaperState(state, user.id, knownIds)
    else writeMinePaperState(state, user.id)

    return NextResponse.json({
      ok: true,
      scope,
      team: readTeamPaperState(),
      mine: readMinePaperState(user.id),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[paper-trading PUT]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
