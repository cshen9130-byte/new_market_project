import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TABLE = "mom_carry_mother_payments"

const COLS = `id, client_name, client_type, direction,
  confirm_date::text, paid_carry::text, note`

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

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const b = await req.json()
    const rows = await query<Record<string, string | null>>(
      `UPDATE ${TABLE} SET
         client_name  = COALESCE($1, client_name),
         client_type  = COALESCE($2, client_type),
         direction    = COALESCE($3, direction),
         confirm_date = COALESCE($4::date, confirm_date),
         paid_carry   = COALESCE($5, paid_carry),
         note         = COALESCE($6, note)
       WHERE id = $7
       RETURNING ${COLS}`,
      [
        b.clientName  ?? null,
        b.clientType  ?? null,
        b.direction   ?? null,
        b.confirmDate ?? null,
        b.paidCarry   ?? null,
        b.note        ?? null,
        parseInt(id, 10),
      ]
    )
    if (!rows.length) return NextResponse.json({ ok: false, error: "记录不存在" }, { status: 404 })
    return NextResponse.json({ ok: true, payment: mapRow(rows[0]) })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const rows = await query<{ id: string }>(
      `DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`,
      [parseInt(id, 10)]
    )
    if (!rows.length) return NextResponse.json({ ok: false, error: "记录不存在" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
