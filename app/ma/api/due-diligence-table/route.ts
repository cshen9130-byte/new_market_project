import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  getServerDueDiligenceTable,
  saveServerDueDiligenceTable,
} from "@/lib/server/due-diligence-table"
import type { DueDiligenceTableRow, TableCellFormats } from "@/lib/ma/due-diligence-table"

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

    const snapshot = await getServerDueDiligenceTable()
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table GET]", message)
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
    const rows = Array.isArray(body?.rows) ? (body.rows as DueDiligenceTableRow[]) : null
    const formats =
      body?.formats && typeof body.formats === "object" && !Array.isArray(body.formats)
        ? (body.formats as TableCellFormats)
        : {}

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "缺少表格数据" }, { status: 400 })
    }

    const snapshot = await saveServerDueDiligenceTable(rows, formats, actor.name)
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[due-diligence-table PUT]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
