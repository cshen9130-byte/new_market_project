import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import {
  getServerDueDiligenceTable,
  saveServerDueDiligenceTable,
} from "@/lib/server/due-diligence-table"
import type { DueDiligenceTableRow, TableCellFormats } from "@/lib/ma/due-diligence-table"

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

    const snapshot = getServerDueDiligenceTable()
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
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
    const rows = Array.isArray(body?.rows) ? (body.rows as DueDiligenceTableRow[]) : null
    const formats =
      body?.formats && typeof body.formats === "object" && !Array.isArray(body.formats)
        ? (body.formats as TableCellFormats)
        : {}

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "缺少表格数据" }, { status: 400 })
    }

    const snapshot = saveServerDueDiligenceTable(rows, formats, user.name)
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      formats: snapshot.formats,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
