import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  formatFeePayFormula,
  formatTemporaryOpen,
  parseFeePayFormulaConfig,
  type FeePayFormulaConfig,
} from "@/lib/ma/fund-elements-extra"
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import {
  loadBasicinfoTrackByBeianKeys,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import { writeFundElementsAcrossShareClasses, writeFundElementsFromBody } from "@/lib/server/fund-elements-write"
import { toIsoDateInputValue } from "@/lib/nav-trading-day"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

export const dynamic = "force-dynamic"

type BasicinfoTrackRow = {
  fund_name: string | null
  register_number: string | null
  advisor: string | null
  inception_date: string | null
  puton_date: string | null
  mandator_name: string | null
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
}

type ExtraElementFields = {
  risk_level: string | null
  lock_period_desc: string | null
  fee_pay_formula: string | null
  fee_pay_formula_config: FeePayFormulaConfig | null
}

async function loadBasicinfoTrack(keys: string[]): Promise<BasicinfoTrackRow[]> {
  try {
    return await loadBasicinfoTrackByBeianKeys<BasicinfoTrackRow>(
      keys,
      `SELECT fund_name, register_number, advisor,
              inception_date::text, puton_date::text, mandator_name,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay
       FROM basicinfo_bfl_track`,
    )
  } catch (err) {
    console.error("[ops/fund-elements GET] basicinfo_bfl_track", err)
    return []
  }
}

async function loadOperationDate(keys: string[]): Promise<string | null> {
  try {
    const rows = await loadBasicinfoTrackByBeianKeys<{ operation_date: string | null }>(
      keys,
      `SELECT operation_date::text AS operation_date
       FROM basicinfo_bfl_track`,
    )
    const value = toIsoDateInputValue(rows[0]?.operation_date)
    return value || null
  } catch {
    // operation_date column may not exist until migration 013 is applied
    return null
  }
}

async function loadExtraElementFields(keys: string[]): Promise<ExtraElementFields> {
  const empty: ExtraElementFields = {
    risk_level: null,
    lock_period_desc: null,
    fee_pay_formula: null,
    fee_pay_formula_config: null,
  }
  try {
    const rows = await loadBasicinfoTrackByBeianKeys<{
      risk_level: string | null
      lock_period_desc: string | null
      fee_pay_formula: string | null
      fee_pay_formula_json: unknown
    }>(
      keys,
      `SELECT risk_level, lock_period_desc, fee_pay_formula, fee_pay_formula_json
       FROM basicinfo_bfl_track`,
    )
    const row = rows[0]
    if (!row) return empty
    const config = parseFeePayFormulaConfig(row.fee_pay_formula_json)
    return {
      risk_level: row.risk_level || null,
      lock_period_desc: row.lock_period_desc || null,
      fee_pay_formula: row.fee_pay_formula || formatFeePayFormula(config),
      fee_pay_formula_config: config,
    }
  } catch {
    // columns may not exist until migration 018 is applied
    return empty
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const keys = await resolveFundElementsBeianKeys(beian_hao, product_name || null)

  const [elementsRows, teamRows, pfiRows, bflRows, operation_date, extra] = await Promise.all([
    loadBasicinfoTrack(keys),

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
       WHERE register_number = ANY($1::text[])
       ORDER BY
         CASE WHEN UPPER(BTRIM(register_number)) = UPPER(BTRIM($2)) THEN 0 ELSE 1 END,
         updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [keys, keys[0]]
    ).catch(() => []),

    query<{ manager: string | null; benchmark: string | null }>(
      `SELECT manager, benchmark FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
       LIMIT 1`,
      [keys]
    ).catch(() => []),

    query<{ strategy_confirmed: number | null; benchmark_index: string | null }>(
      `SELECT strategy_confirmed, benchmark_index
       FROM private_fund_info_bfl
       WHERE beian_hao = ANY($1::text[])
       LIMIT 1`,
      [keys]
    ).catch(() => []),

    loadOperationDate(keys),
    loadExtraElementFields(keys),
  ])

  const el = elementsRows[0]
  const team = teamRows[0]
  const pfi = pfiRows[0]
  const benchmark = pfi?.benchmark || bflRows[0]?.benchmark_index || null
  const fund_manager = pfi?.manager || el?.advisor || null

  const is_temporary_open = formatTemporaryOpen(el?.is_temporary_open)

  const fee_manage_rate =
    el?.fee_manage_rate != null
      ? `${(parseFloat(el.fee_manage_rate) * 100).toFixed(2)}%`
      : null

  const custodian =
    el?.mandator_name?.trim() ||
    (await lookupAmacMandatorName(keys[0] || beian_hao))

  return NextResponse.json({
    fund_name: el?.fund_name ?? null,
    register_number: el?.register_number ?? canonicalizeShareClassBeianCode(beian_hao) ?? beian_hao,
    advisor: el?.advisor ?? null,
    fund_manager,
    inception_date: toIsoDateInputValue(el?.inception_date) || null,
    operation_date,
    puton_date: toIsoDateInputValue(el?.puton_date) || null,
    custodian,
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
    risk_level: extra.risk_level,
    precautious_line: el?.precautious_line ?? null,
    closed_period: el?.closed_period ?? null,
    stop_line: el?.stop_line ?? null,
    lock_period_desc: extra.lock_period_desc,
    fee_manage_rate,
    fee_trust: el?.fee_trust ?? null,
    fee_manage: el?.fee_manage ?? null,
    fee_admin_service: el?.fee_admin_service ?? null,
    fee_pay: el?.fee_pay ?? null,
    fee_pay_formula: extra.fee_pay_formula,
    fee_pay_formula_config: extra.fee_pay_formula_config,
  })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  const rawBeian = String(body?.beian_hao ?? "").trim()
  if (!body || !rawBeian) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  try {
    if (body.fanout_share_classes === true) {
      await writeFundElementsAcrossShareClasses(body)
    } else {
      await writeFundElementsFromBody(body)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[ops/fund-elements PATCH]", err)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
