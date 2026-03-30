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

export async function GET() {
  try {
    const rows = await query<Record<string, string | null>>(
      `SELECT ${COLS} FROM mom_carry_payments ORDER BY carry_date, account`
    )
    return NextResponse.json({ ok: true, payments: rows.map(mapRow) })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json()
    if (!b.account || !b.carryDate || b.profitPortion === undefined || b.paidChildCarry === undefined) {
      return NextResponse.json({ ok: false, error: "缺少必填字段：account、carryDate、profitPortion、paidChildCarry" }, { status: 400 })
    }
    const rows = await query<Record<string, string | null>>(
      `INSERT INTO mom_carry_payments
         (account, start_date, carry_date, operating_days, balance, total_profit, profit_portion, paid_child_carry, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLS}`,
      [
        b.account,
        b.startDate   || null,
        b.carryDate,
        b.operatingDays ?? null,
        b.balance       ?? null,
        b.totalProfit   ?? null,
        b.profitPortion,
        b.paidChildCarry,
        b.note          ?? null,
      ]
    )
    return NextResponse.json({ ok: true, payment: mapRow(rows[0]) }, { status: 201 })
  } catch (err: unknown) {
    const msg = String(err)
    if (msg.includes("mom_carry_payments_uq")) {
      return NextResponse.json({ ok: false, error: "该账户在该提盈日已有记录" }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
