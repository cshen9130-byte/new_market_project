import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_personal_fund_notes (
      id         SERIAL PRIMARY KEY,
      beian_hao  VARCHAR(64) NOT NULL,
      user_key   VARCHAR(255) NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (beian_hao, user_key)
    )
  `)
}

function currentUserKey(req: Request): string {
  return String(req.headers.get("x-market-user-id") || "").trim()
}

// GET /ma/api/tracking-funds/personal-fund-note?beian_hao=XXX
// GET /ma/api/tracking-funds/personal-fund-note?beian_haos=A,B,C
export async function GET(req: Request) {
  const userKey = currentUserKey(req)
  if (!userKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const beian_haos_raw = (searchParams.get("beian_haos") || "").trim()
  await ensureTable()

  if (beian_haos_raw) {
    const ids = beian_haos_raw.split(",").map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({})
    const rows = await query<{ beian_hao: string; note: string; updated_at: string }>(
      `SELECT beian_hao, note, updated_at::text
       FROM ops_personal_fund_notes
       WHERE user_key = $1 AND beian_hao = ANY($2) AND note <> ''`,
      [userKey, ids]
    )
    const result: Record<string, { note: string; updated_by: string; updated_at: string }> = {}
    for (const r of rows) {
      result[r.beian_hao] = { note: r.note, updated_by: "", updated_at: r.updated_at }
    }
    return NextResponse.json(result)
  }

  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  const rows = await query<{ note: string; updated_at: string }>(
    `SELECT note, updated_at::text FROM ops_personal_fund_notes WHERE beian_hao = $1 AND user_key = $2`,
    [beian_hao, userKey]
  )
  return NextResponse.json({
    note: rows[0]?.note ?? "",
    updated_by: "",
    updated_at: rows[0]?.updated_at ?? null,
  })
}

// PUT /ma/api/tracking-funds/personal-fund-note  { beian_hao, note }
export async function PUT(req: Request) {
  const userKey = currentUserKey(req)
  if (!userKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || !body.beian_hao) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const beian_hao: string = body.beian_hao
  const note: string = String(body.note ?? "").slice(0, 250)

  await ensureTable()

  if (!note.trim()) {
    await query(`DELETE FROM ops_personal_fund_notes WHERE beian_hao = $1 AND user_key = $2`, [beian_hao, userKey])
    return NextResponse.json({ ok: true, record: null })
  }

  await query(
    `INSERT INTO ops_personal_fund_notes (beian_hao, user_key, note, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (beian_hao, user_key) DO UPDATE SET note = $3, updated_at = NOW()`,
    [beian_hao, userKey, note]
  )

  const rows = await query<{ note: string; updated_at: string }>(
    `SELECT note, updated_at::text FROM ops_personal_fund_notes WHERE beian_hao = $1 AND user_key = $2`,
    [beian_hao, userKey]
  )
  return NextResponse.json({
    ok: true,
    record: rows[0] ? { note: rows[0].note, updated_by: "", updated_at: rows[0].updated_at } : null,
  })
}

// DELETE /ma/api/tracking-funds/personal-fund-note?beian_hao=XXX
export async function DELETE(req: Request) {
  const userKey = currentUserKey(req)
  if (!userKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const beian_hao = (new URL(req.url).searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  await ensureTable()
  await query(`DELETE FROM ops_personal_fund_notes WHERE beian_hao = $1 AND user_key = $2`, [beian_hao, userKey])
  return NextResponse.json({ ok: true })
}
