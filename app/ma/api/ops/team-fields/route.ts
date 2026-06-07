import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_CATEGORIES = ["文本", "数字", "百分数", "日期", "单选", "多选", "附件", "人员"]

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_team_fields (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      category    VARCHAR(64) NOT NULL DEFAULT '文本',
      sort_order  INT NOT NULL DEFAULT 0,
      created_by  VARCHAR(255) NOT NULL DEFAULT '',
      updated_by  VARCHAR(255) NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

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

export async function GET() {
  try {
    await ensureTable()
    const rows = await query<FieldRow>(
      `SELECT id, name, category, sort_order, created_by, updated_by, created_at, updated_at
       FROM ops_team_fields
       ORDER BY sort_order, id`
    )
    return NextResponse.json(rows)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()
    const body = await req.json()
    const { name, category = "文本", user_name = "" } = body as Record<string, string>
    if (!name?.trim()) {
      return NextResponse.json({ error: "name_required" }, { status: 400 })
    }
    const cat = VALID_CATEGORIES.includes(category) ? category : "文本"
    const rows = await query<FieldRow>(
      `INSERT INTO ops_team_fields (name, category, created_by, updated_by, sort_order)
       VALUES ($1, $2, $3, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ops_team_fields))
       RETURNING id, name, category, sort_order, created_by, updated_by, created_at, updated_at`,
      [name.trim(), cat, user_name]
    )
    return NextResponse.json(rows[0])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
