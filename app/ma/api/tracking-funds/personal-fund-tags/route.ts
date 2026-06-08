import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_personal_fund_tags (
      id         SERIAL PRIMARY KEY,
      beian_hao  VARCHAR(64) NOT NULL,
      tag_name   VARCHAR(255) NOT NULL,
      user_key   VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, tag_name, user_key)
    )
  `)
}

function currentUserKey(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

// GET /ma/api/tracking-funds/personal-fund-tags?beian_hao=XXX
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const userKey = currentUserKey(req)
  if (!userKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  await ensureTable()
  const rows = await query<{ tag_name: string }>(
    `SELECT tag_name FROM ops_personal_fund_tags
     WHERE beian_hao = $1 AND user_key = $2
     ORDER BY created_at ASC`,
    [beian_hao, userKey]
  )
  return NextResponse.json(rows.map((r) => r.tag_name))
}

// PUT /ma/api/tracking-funds/personal-fund-tags  { beian_hao, tags: string[] }
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || !body.beian_hao) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const userKey = currentUserKey(req)
  if (!userKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const beian_hao: string = body.beian_hao
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : []

  await ensureTable()

  await query(
    tags.length > 0
      ? `DELETE FROM ops_personal_fund_tags WHERE beian_hao = $1 AND user_key = $2 AND tag_name <> ALL($3::text[])`
      : `DELETE FROM ops_personal_fund_tags WHERE beian_hao = $1 AND user_key = $2`,
    tags.length > 0 ? [beian_hao, userKey, tags] : [beian_hao, userKey]
  )

  for (const tag of tags) {
    await query(
      `INSERT INTO ops_personal_fund_tags (beian_hao, tag_name, user_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (beian_hao, tag_name, user_key) DO NOTHING`,
      [beian_hao, tag, userKey]
    )
  }

  return NextResponse.json({ ok: true })
}
