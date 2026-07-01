import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { renameTeamTagInSources } from "@/lib/server/sync-fund-team-tags"

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

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: idStr } = await context.params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    const body = await req.json()
    const { name, user_name = "" } = body as Record<string, string>
    if (!name?.trim()) {
      return NextResponse.json({ error: "name_required" }, { status: 400 })
    }
    const existing = await query<TagRow>(
      `SELECT id, category, name, created_by, updated_by, created_at, updated_at
       FROM ops_team_tags WHERE id = $1`,
      [id],
    )
    if (existing.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
    const oldName = existing[0].name
    const newName = name.trim()
    const rows = await query<TagRow>(
      `UPDATE ops_team_tags
       SET name = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, category, name, created_by, updated_by, created_at, updated_at`,
      [newName, user_name, id]
    )
    if (oldName !== newName && existing[0].category === "fund") {
      await renameTeamTagInSources(oldName, newName)
    }
    return NextResponse.json(rows[0])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: idStr } = await context.params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })
    await query(`DELETE FROM ops_team_tags WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
