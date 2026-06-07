import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { authService } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_note_entries (
      id         SERIAL PRIMARY KEY,
      beian_hao  VARCHAR(64) NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      updated_by VARCHAR(255) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function currentUser(req: Request) {
  try {
    const session = await authService.getSession(req as never)
    return session?.user?.name ?? session?.user?.email ?? ""
  } catch {
    return ""
  }
}

export async function GET(req: Request) {
  const beian_hao = (new URL(req.url).searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  await ensureTable()
  const rows = await query<{
    id: number
    note: string
    updated_by: string
    updated_at: string
  }>(
    `SELECT id, note, updated_by, updated_at::text
     FROM ops_fund_note_entries
     WHERE beian_hao = $1
     ORDER BY updated_at DESC, id DESC`,
    [beian_hao]
  )

  if (rows.length === 0) {
    try {
      const legacy = await query<{ note: string; updated_by: string; updated_at: string }>(
        `SELECT note, updated_by, updated_at::text FROM ops_fund_notes WHERE beian_hao = $1 AND note <> ''`,
        [beian_hao]
      )
      if (legacy[0]) {
        const inserted = await query<{ id: number; note: string; updated_by: string; updated_at: string }>(
          `INSERT INTO ops_fund_note_entries (beian_hao, note, updated_by, updated_at)
           VALUES ($1, $2, $3, $4::timestamptz)
           RETURNING id, note, updated_by, updated_at::text`,
          [beian_hao, legacy[0].note, legacy[0].updated_by, legacy[0].updated_at]
        )
        return NextResponse.json({ data: inserted })
      }
    } catch { /* legacy table may not exist */ }
  }

  return NextResponse.json({ data: rows })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.beian_hao) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const beian_hao = String(body.beian_hao).trim()
  const note = String(body.note ?? "").trim().slice(0, 250)
  if (!note) return NextResponse.json({ error: "empty note" }, { status: 400 })

  const username = await currentUser(req)
  await ensureTable()
  const rows = await query<{ id: number; note: string; updated_by: string; updated_at: string }>(
    `INSERT INTO ops_fund_note_entries (beian_hao, note, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, note, updated_by, updated_at::text`,
    [beian_hao, note, username]
  )
  return NextResponse.json({ ok: true, record: rows[0] })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const id = Number(body.id)
  const note = String(body.note ?? "").trim().slice(0, 250)
  if (!note) return NextResponse.json({ error: "empty note" }, { status: 400 })

  const username = await currentUser(req)
  await ensureTable()
  const rows = await query<{ id: number; note: string; updated_by: string; updated_at: string }>(
    `UPDATE ops_fund_note_entries
     SET note = $2, updated_by = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING id, note, updated_by, updated_at::text`,
    [id, note, username]
  )
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ ok: true, record: rows[0] })
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"))
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })

  await ensureTable()
  await query(`DELETE FROM ops_fund_note_entries WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
