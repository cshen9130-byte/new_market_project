import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  listDueDiligenceTableBackups,
  restoreDueDiligenceTableBackup,
} from "@/lib/server/due-diligence-table"

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

    const { searchParams } = new URL(req.url)
    const limit = Number(searchParams.get("limit") || "20")
    const backups = await listDueDiligenceTableBackups(Number.isFinite(limit) ? limit : 20)
    return NextResponse.json({ ok: true, backups })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table backups GET]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor(req)
    if (!actor) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const backupId = Number(body?.backupId)
    if (!Number.isFinite(backupId) || backupId <= 0) {
      return NextResponse.json({ ok: false, error: "缺少 backupId" }, { status: 400 })
    }

    const snapshot = await restoreDueDiligenceTableBackup(backupId, actor.name)
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
      backupId,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table backups POST]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
