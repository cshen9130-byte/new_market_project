import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface TagRow {
  id: number
  category: string
  name: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    const body = await req.json()
    const { name, user_name = "" } = body as Record<string, string>
    if (!name?.trim()) {
      return NextResponse.json({ error: "name_required" }, { status: 400 })
    }
    const rows = await query<TagRow>(
      `UPDATE ops_team_tags
       SET name = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, category, name, created_by, updated_by, created_at, updated_at`,
      [name.trim(), user_name, id]
    )
    if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    await query(`DELETE FROM ops_team_tags WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
