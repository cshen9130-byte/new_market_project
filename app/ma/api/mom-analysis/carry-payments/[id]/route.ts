import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COLS = `id, account, start_date::text, carry_date::text,
  operating_days, balance::text, total_profit::text,
  profit_portion::text, paid_child_carry::text, note`

function mapRow(r: Record<string, string | null>) {
  return {
    id:             parseInt(r.id as string, 10),
    account:        r.account as string,
    startDate:      r.start_date as string,
    carryDate:      r.carry_date as string,
    operatingDays:  r.operating_days ? parseInt(r.operating_days, 10) : null,
    balance:        r.balance        ? parseFloat(r.balance)         : null,
    totalProfit:    r.total_profit   ? parseFloat(r.total_profit)    : null,
    profitPortion:  parseFloat(r.profit_portion as string),
    paidChildCarry: parseFloat(r.paid_child_carry as string),
    note:           r.note ?? null,
  }
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const b = await req.json()

    const rows = await query<Record<string, string | null>>(
      `UPDATE mom_carry_payments SET
         account         = COALESCE($1, account),
         start_date      = COALESCE($2::date, start_date),
         carry_date      = COALESCE($3::date, carry_date),
         operating_days  = COALESCE($4, operating_days),
         balance         = COALESCE($5, balance),
         total_profit    = COALESCE($6, total_profit),
         profit_portion  = COALESCE($7, profit_portion),
         paid_child_carry= COALESCE($8, paid_child_carry),
         note            = COALESCE($9, note)
       WHERE id = $10
       RETURNING ${COLS}`,
      [
        b.account       ?? null,
        b.startDate     ?? null,
        b.carryDate     ?? null,
        b.operatingDays ?? null,
        b.balance       ?? null,
        b.totalProfit   ?? null,
        b.profitPortion ?? null,
        b.paidChildCarry ?? null,
        b.note          ?? null,
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
      `DELETE FROM mom_carry_payments WHERE id = $1 RETURNING id`,
      [parseInt(id, 10)]
    )
    if (!rows.length) return NextResponse.json({ ok: false, error: "记录不存在" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
