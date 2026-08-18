import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import { extraFieldsFromTrackRow, loadBasicinfoTrackByBeianKeys, resolveFundElementsBeianKeys } from "@/lib/server/fund-elements-lookup"
import { formatTemporaryOpen } from "@/lib/ma/fund-elements-extra"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const keys = await resolveFundElementsBeianKeys(beian_hao, product_name || null)

  type TrackRow = {
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
    risk_level?: string | null
    lock_period_desc?: string | null
    fee_pay_formula?: string | null
    fee_pay_formula_json?: unknown
  }

  const baseSelect = `SELECT fund_name, fund_short_name, register_number,
              advisor, advisor2, inception_date::text, puton_date::text,
              mandator_name, manager_names,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay,
              updated_at::text
       FROM basicinfo_bfl_track`
  const extraSelect = `SELECT fund_name, fund_short_name, register_number,
              advisor, advisor2, inception_date::text, puton_date::text,
              mandator_name, manager_names,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay,
              updated_at::text,
              risk_level, lock_period_desc, fee_pay_formula, fee_pay_formula_json
       FROM basicinfo_bfl_track`

  const [rows, pfiRows] = await Promise.all([
    loadBasicinfoTrackByBeianKeys<TrackRow>(keys, extraSelect).catch(
      () => loadBasicinfoTrackByBeianKeys<TrackRow>(keys, baseSelect),
    ),
    query<{ manager: string | null }>(
      `SELECT manager FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
       LIMIT 1`,
      [keys],
    ).catch(() => [] as { manager: string | null }[]),
  ])
  const extra = extraFieldsFromTrackRow(rows[0])

  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const row = rows[0]
  const resolvedBeian = (row.register_number || keys[0] || beian_hao).trim()

  const is_temporary_open_text = formatTemporaryOpen(row.is_temporary_open)

  const custodian =
    row.mandator_name?.trim() ||
    (await lookupAmacMandatorName(resolvedBeian || beian_hao))

  return NextResponse.json({
    fund_name: row.fund_name,
    fund_short_name: row.fund_short_name,
    register_number: row.register_number ?? resolvedBeian,
    advisor: row.advisor || null,
    fund_manager: pfiRows[0]?.manager || row.advisor || null,
    inception_date: row.inception_date ? row.inception_date.slice(0, 10) : null,
    puton_date: row.puton_date ? row.puton_date.slice(0, 10) : null,
    custodian,
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
    risk_level: extra.risk_level,
    lock_period_desc: extra.lock_period_desc,
    fee_pay_formula: extra.fee_pay_formula,
    updated_at: row.updated_at ? row.updated_at.slice(0, 10) : null,
  })
}
