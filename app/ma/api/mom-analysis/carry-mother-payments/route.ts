import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TABLE = "mom_carry_mother_payments"

const COLS = `id, client_name, client_type, direction,
  confirm_date::text, paid_carry::text, note`

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id           SERIAL PRIMARY KEY,
      client_name  TEXT NOT NULL,
      client_type  TEXT,
      direction    TEXT,
      confirm_date DATE NOT NULL,
      paid_carry   NUMERIC NOT NULL DEFAULT 0,
      note         TEXT
    )`)
}

function mapRow(r: Record<string, string | null>) {
  return {
    id:          parseInt(r.id as string, 10),
    clientName:  r.client_name as string,
    clientType:  r.client_type ?? null,
    direction:   r.direction   ?? null,
    confirmDate: r.confirm_date as string,
    paidCarry:   parseFloat(r.paid_carry as string),
    note:        r.note ?? null,
  }
}

export async function GET() {
  try {
    await ensureTable()
    const rows = await query<Record<string, string | null>>(
      `SELECT ${COLS} FROM ${TABLE} ORDER BY confirm_date, client_name`
    )
    return NextResponse.json({ ok: true, payments: rows.map(mapRow) })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable()
    const b = await req.json()
    if (!b.clientName || !b.confirmDate || b.paidCarry === undefined) {
      return NextResponse.json({ ok: false, error: "缺少必填字段：clientName、confirmDate、paidCarry" }, { status: 400 })
    }
    const rows = await query<Record<string, string | null>>(
      `INSERT INTO ${TABLE}
         (client_name, client_type, direction, confirm_date, paid_carry, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLS}`,
      [
        b.clientName,
        b.clientType  || null,
        b.direction   || null,
        b.confirmDate,
        b.paidCarry,
        b.note        ?? null,
      ]
    )
    return NextResponse.json({ ok: true, payment: mapRow(rows[0]) }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
