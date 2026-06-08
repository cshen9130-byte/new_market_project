import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_CATEGORIES = ["fund", "portfolio", "compare", "manager", "note", "material"]

// Ensure the table exists on first use
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_tags (
      id          SERIAL PRIMARY KEY,
      category    VARCHAR(32) NOT NULL DEFAULT 'fund',
      name        VARCHAR(255) NOT NULL,
      created_by  VARCHAR(255) NOT NULL DEFAULT '',
      updated_by  VARCHAR(255) NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

interface TagRow {
  id: number
  category: string
  name: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

function isPersonalCategory(category: string) {
  return category.endsWith("_personal")
}

export async function GET(req: Request) {
  try {
    await ensureTable()
    const { searchParams } = new URL(req.url)
    const category = searchParams.get("category") || "fund"
    const owner = (searchParams.get("owner") || "").trim()
    const rows = await query<TagRow>(
      isPersonalCategory(category)
        ? `SELECT id, category, name, created_by, updated_by, created_at, updated_at
           FROM ops_team_tags
           WHERE category = $1 AND ($2 = '' OR created_by = $2)
           ORDER BY id`
        : `SELECT id, category, name, created_by, updated_by, created_at, updated_at
           FROM ops_team_tags
           WHERE category = $1
           ORDER BY id`,
      isPersonalCategory(category) ? [category, owner] : [category]
    )
    return NextResponse.json(rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()
    const body = await req.json()
    const { category = "fund", name, user_name = "" } = body as Record<string, string>
    if (!name?.trim()) {
      return NextResponse.json({ error: "name_required" }, { status: 400 })
    }
    const rows = await query<TagRow>(
      `INSERT INTO ops_team_tags (category, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING id, category, name, created_by, updated_by, created_at, updated_at`,
      [category, name.trim(), user_name]
    )
    return NextResponse.json(rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
