import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_CATEGORIES = ["文本", "数字", "百分数", "日期", "单选", "多选", "附件", "人员"]

interface FieldRow {
  id: number
  name: string
  category: string
  sort_order: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: idStr } = await context.params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    const body = await req.json()
    const { name, category, user_name = "" } = body as Record<string, string>
    if (!name?.trim()) {
      return NextResponse.json({ error: "name_required" }, { status: 400 })
    }
    const cat = category && VALID_CATEGORIES.includes(category) ? category : undefined
    const rows = await query<FieldRow>(
      cat
        ? `UPDATE ops_team_fields
           SET name = $1, category = $2, updated_by = $3, updated_at = NOW()
           WHERE id = $4
           RETURNING id, name, category, sort_order, created_by, updated_by, created_at, updated_at`
        : `UPDATE ops_team_fields
           SET name = $1, updated_by = $2, updated_at = NOW()
           WHERE id = $3
           RETURNING id, name, category, sort_order, created_by, updated_by, created_at, updated_at`,
      cat ? [name.trim(), cat, user_name, id] : [name.trim(), user_name, id]
    )
    if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: idStr } = await context.params
    const id = parseInt(idStr)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    await query(`DELETE FROM ops_team_fields WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
