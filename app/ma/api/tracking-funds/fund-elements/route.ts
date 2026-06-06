import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

const TEMP_OPEN_MAP: Record<number, string> = {
  1: "可",
  2: "不可临开",
  3: "可临开回",
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const rows = await query<{
    fund_name: string | null
    fund_short_name: string | null
    register_number: string | null
    advisor: string | null
    advisor2: string | null
    inception_date: string | null
    puton_date: string | null
    mandator_name: string | null
    manager_names: string | null
    open_day: string | null
    is_temporary_open: number | null
    fee_purchase: string | null
    add_amount: string | null
    fee_redeem: string | null
    precautious_line: string | null
    closed_period: string | null
    stop_line: string | null
    fee_manage_rate: string | null
    fee_trust: string | null
    fee_manage: string | null
    fee_admin_service: string | null
    fee_pay: string | null
    updated_at: string | null
  }>(
    `SELECT fund_name, fund_short_name, register_number,
            advisor, advisor2, inception_date::text, puton_date::text,
            mandator_name, manager_names,
            open_day, is_temporary_open,
            fee_purchase, add_amount, fee_redeem,
            precautious_line, closed_period, stop_line,
            fee_manage_rate::text, fee_trust, fee_manage,
            fee_admin_service, fee_pay,
            updated_at::text
     FROM basicinfo_bfl_track
     WHERE register_number = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [beian_hao]
  )

  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const row = rows[0]

  // Try to get fund manager from private_fund_info
  const pfiRows = await query<{ manager: string | null }>(
    `SELECT manager FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao]
  ).catch(() => [] as { manager: string | null }[])

  const is_temporary_open_text =
    row.is_temporary_open != null
      ? (TEMP_OPEN_MAP[row.is_temporary_open] ?? String(row.is_temporary_open))
      : null

  return NextResponse.json({
    fund_name: row.fund_name,
    fund_short_name: row.fund_short_name,
    register_number: row.register_number,
    advisor: row.advisor || null,
    fund_manager: pfiRows[0]?.manager || row.advisor || null,
    inception_date: row.inception_date ? row.inception_date.slice(0, 10) : null,
    puton_date: row.puton_date ? row.puton_date.slice(0, 10) : null,
    custodian: row.mandator_name || null,
    open_day: row.open_day || null,
    is_temporary_open: is_temporary_open_text,
    fee_purchase: row.fee_purchase || null,
    add_amount: row.add_amount || null,
    fee_redeem: row.fee_redeem || null,
    precautious_line: row.precautious_line || null,
    closed_period: row.closed_period || null,
    stop_line: row.stop_line || null,
    fee_manage_rate: row.fee_manage_rate ? `${(parseFloat(row.fee_manage_rate) * 100).toFixed(2)}%` : null,
    fee_trust: row.fee_trust || null,
    fee_manage: row.fee_manage || null,
    fee_admin_service: row.fee_admin_service || null,
    fee_pay: row.fee_pay || null,
    updated_at: row.updated_at ? row.updated_at.slice(0, 10) : null,
  })
}
