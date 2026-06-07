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

  const [elementsRows, teamRows, pfiRows, bflRows] = await Promise.all([
    query<{
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
    }>(
      `SELECT open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay
       FROM basicinfo_bfl_track
       WHERE register_number = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao]
    ).catch(() => []),

    query<{
      platform_strategy_one: string | null
      platform_strategy_two: string | null
      platform_strategy_three: string | null
      company_strategy_one: string | null
      company_strategy_two: string | null
      company_strategy_three: string | null
    }>(
      `SELECT platform_strategy_one, platform_strategy_two, platform_strategy_three,
              company_strategy_one, company_strategy_two, company_strategy_three
       FROM type6_ops_team_full
       WHERE register_number = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao]
    ).catch(() => []),

    query<{ benchmark: string | null }>(
      `SELECT benchmark FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
      [beian_hao]
    ).catch(() => []),

    query<{ strategy_confirmed: number | null; benchmark_index: string | null }>(
      `SELECT strategy_confirmed, benchmark_index
       FROM private_fund_info_bfl
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao]
    ).catch(() => []),
  ])

  const el = elementsRows[0]
  const team = teamRows[0]
  const benchmark =
    pfiRows[0]?.benchmark ||
    bflRows[0]?.benchmark_index ||
    null

  const is_temporary_open =
    el?.is_temporary_open != null
      ? (TEMP_OPEN_MAP[el.is_temporary_open] ?? String(el.is_temporary_open))
      : null

  const fee_manage_rate =
    el?.fee_manage_rate != null
      ? `${(parseFloat(el.fee_manage_rate) * 100).toFixed(2)}%`
      : null

  return NextResponse.json({
    platform_l1: team?.platform_strategy_one ?? null,
    platform_l2: team?.platform_strategy_two ?? null,
    platform_l3: team?.platform_strategy_three ?? null,
    company_l1: team?.company_strategy_one ?? null,
    company_l2: team?.company_strategy_two ?? null,
    company_l3: team?.company_strategy_three ?? null,
    benchmark,
    strategy_confirmed: bflRows[0]?.strategy_confirmed === 1,
    open_day: el?.open_day ?? null,
    is_temporary_open,
    fee_purchase: el?.fee_purchase ?? null,
    add_amount: el?.add_amount ?? null,
    fee_redeem: el?.fee_redeem ?? null,
    precautious_line: el?.precautious_line ?? null,
    closed_period: el?.closed_period ?? null,
    stop_line: el?.stop_line ?? null,
    fee_manage_rate,
    fee_trust: el?.fee_trust ?? null,
    fee_manage: el?.fee_manage ?? null,
    fee_admin_service: el?.fee_admin_service ?? null,
    fee_pay: el?.fee_pay ?? null,
  })
}
