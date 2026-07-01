import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { authService } from "@/lib/auth"
import { syncFundTeamTagsToSource } from "@/lib/server/sync-fund-team-tags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_tags (
      id         SERIAL PRIMARY KEY,
      beian_hao  VARCHAR(64) NOT NULL,
      tag_name   VARCHAR(255) NOT NULL,
      created_by VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, tag_name)
    )
  `)
}

// GET /ma/api/tracking-funds/fund-tags?beian_hao=XXX
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  await ensureTable()
  const rows = await query<{ tag_name: string }>(
    `SELECT tag_name FROM ops_fund_tags WHERE beian_hao = $1 ORDER BY created_at ASC`,
    [beian_hao]
  )
  return NextResponse.json(rows.map((r) => r.tag_name))
}

// PUT /ma/api/tracking-funds/fund-tags  { beian_hao, tags: string[] }
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || !body.beian_hao) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const beian_hao: string = body.beian_hao
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : []

  let username = ""
  try {
    const session = await authService.getSession(req as never)
    username = session?.user?.name ?? session?.user?.email ?? ""
  } catch { /* ignore */ }

  await ensureTable()

  // Delete removed tags
  await query(
    tags.length > 0
      ? `DELETE FROM ops_fund_tags WHERE beian_hao = $1 AND tag_name <> ALL($2::text[])`
      : `DELETE FROM ops_fund_tags WHERE beian_hao = $1`,
    tags.length > 0 ? [beian_hao, tags] : [beian_hao]
  )

  // Insert new tags
  for (const tag of tags) {
    await query(
      `INSERT INTO ops_fund_tags (beian_hao, tag_name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (beian_hao, tag_name) DO NOTHING`,
      [beian_hao, tag, username]
    )
  }

  await syncFundTeamTagsToSource(beian_hao)

  return NextResponse.json({ ok: true })
}
