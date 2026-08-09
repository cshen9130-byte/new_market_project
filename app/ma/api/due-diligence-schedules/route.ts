import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  getServerDueDiligenceSchedules,
  saveServerDueDiligenceSchedules,
} from "@/lib/server/due-diligence-schedules"
import type { DueDiligenceSchedule } from "@/lib/ma/due-diligence-schedules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getActor(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null

  const user = await getUserById(userId)
  if (user) return { id: user.id, name: user.name }

  const rawName = String(req.headers.get("x-market-user-name") || userId).trim()
  let fallbackName = rawName
  try {
    fallbackName = decodeURIComponent(rawName)
  } catch {
    // keep raw if not percent-encoded
  }
  return { id: userId, name: fallbackName }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor(req)
    if (!actor) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const snapshot = await getServerDueDiligenceSchedules()
    return NextResponse.json({
      ok: true,
      schedules: snapshot.schedules,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-schedules GET]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const actor = await getActor(req)
    if (!actor) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const schedules = Array.isArray(body?.schedules)
      ? (body.schedules as DueDiligenceSchedule[])
      : null

    if (!schedules) {
      return NextResponse.json({ ok: false, error: "缺少日历数据" }, { status: 400 })
    }

    const snapshot = await saveServerDueDiligenceSchedules(schedules, actor.name)
    return NextResponse.json({
      ok: true,
      schedules: snapshot.schedules,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-schedules PUT]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
