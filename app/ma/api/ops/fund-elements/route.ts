import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { query } from "@/lib/db"

const ELEMENTS_SOURCE = "ops/fund-elements"

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
    }>(
      `SELECT fund_name, register_number, advisor,
              inception_date::text, puton_date::text, mandator_name,
              open_day, is_temporary_open,
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

    query<{ manager: string | null; benchmark: string | null }>(
      `SELECT manager, benchmark FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
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
  const pfi = pfiRows[0]
  const benchmark = pfi?.benchmark || bflRows[0]?.benchmark_index || null
  const fund_manager = pfi?.manager || el?.advisor || null

  const is_temporary_open =
    el?.is_temporary_open != null
      ? (TEMP_OPEN_MAP[el.is_temporary_open] ?? String(el.is_temporary_open))
      : null

  const fee_manage_rate =
    el?.fee_manage_rate != null
      ? `${(parseFloat(el.fee_manage_rate) * 100).toFixed(2)}%`
      : null

  return NextResponse.json({
    fund_name: el?.fund_name ?? null,
    register_number: el?.register_number ?? beian_hao,
    advisor: el?.advisor ?? null,
    fund_manager,
    inception_date: el?.inception_date ? el.inception_date.slice(0, 10) : null,
    puton_date: el?.puton_date ? el.puton_date.slice(0, 10) : null,
    custodian: el?.mandator_name ?? null,
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

function normalizeDate(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return s.slice(0, 10)
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function encodeTemporaryOpen(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  if (s.includes("不可")) return 2
  if (s.includes("回")) return 3
  if (s.includes("可")) return 1
  return null
}

function encodeManageRate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  const m = s.match(/([\d.]+)\s*%/)
  if (m) {
    const pct = parseFloat(m[1])
    if (Number.isFinite(pct)) return String(pct / 100)
  }
  const num = parseFloat(s)
  if (Number.isFinite(num)) {
    return num > 1 ? String(num / 100) : String(num)
  }
  return null
}

function buildElementRowHash(beian_hao: string): string {
  return createHash("sha256").update(`${ELEMENTS_SOURCE}::${beian_hao}`).digest("hex")
}

function buildElementPayload(
  beian_hao: string,
  fieldValues: Record<string, unknown>,
): Record<string, unknown> {
  const fundsBase: Record<string, unknown> = {}
  for (const key of [
    "open_day",
    "fee_trust",
    "stop_line",
    "add_amount",
    "fee_manage",
    "fee_redeem",
    "fee_purchase",
    "closed_period",
    "fee_manage_rate",
    "precautious_line",
    "fee_admin_service",
    "is_temporary_open",
  ] as const) {
    if (fieldValues[key] !== undefined) fundsBase[key] = fieldValues[key]
  }

  return {
    tag: { company: [] },
    advisor: fieldValues.advisor ?? "",
    advisor2: "",
    managers: [],
    strategy: {
      company: { strategy_one: "", strategy_two: "", strategy_three: "" },
      platform: { strategy_one: "", strategy_two: "", strategy_three: "" },
    },
    FundsBase: fundsBase,
    fund_name: fieldValues.fund_name ?? null,
    fund_type: 2,
    puton_date: fieldValues.puton_date ?? null,
    mandator_name: fieldValues.mandator_name ?? null,
    inception_date: fieldValues.inception_date ?? null,
    fund_short_name: fieldValues.fund_name ?? null,
    register_number: beian_hao,
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  const beian_hao = String(body?.beian_hao ?? "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const fieldValues: Record<string, unknown> = {
    fund_name: normalizeOptionalString(body.fund_name),
    advisor: normalizeOptionalString(body.advisor),
    inception_date: body.inception_date !== undefined ? normalizeDate(body.inception_date) : undefined,
    puton_date: body.puton_date !== undefined ? normalizeDate(body.puton_date) : undefined,
    mandator_name: normalizeOptionalString(body.custodian),
    open_day: normalizeOptionalString(body.open_day),
    is_temporary_open: encodeTemporaryOpen(body.is_temporary_open),
    fee_purchase: normalizeOptionalString(body.fee_purchase),
    add_amount: normalizeOptionalString(body.add_amount),
    fee_redeem: normalizeOptionalString(body.fee_redeem),
    precautious_line: normalizeOptionalString(body.precautious_line),
    closed_period: normalizeOptionalString(body.closed_period),
    stop_line: normalizeOptionalString(body.stop_line),
    fee_manage_rate: encodeManageRate(body.fee_manage_rate),
    fee_trust: normalizeOptionalString(body.fee_trust),
    fee_manage: normalizeOptionalString(body.fee_manage),
    fee_admin_service: normalizeOptionalString(body.fee_admin_service),
    fee_pay: normalizeOptionalString(body.fee_pay),
  }

  const fund_manager = normalizeOptionalString(body.fund_manager)
  const advisor = normalizeOptionalString(body.advisor)
  const custodian = normalizeOptionalString(body.custodian)

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [column, value] of Object.entries(fieldValues)) {
    if (value === undefined) continue
    if (column === "inception_date" || column === "puton_date") {
      setClauses.push(`${column} = $${paramIndex}::date`)
    } else if (column === "fee_manage_rate") {
      setClauses.push(`${column} = $${paramIndex}::numeric`)
    } else {
      setClauses.push(`${column} = $${paramIndex}`)
    }
    values.push(value)
    paramIndex++
  }

  try {
    const existing = await query<{ id: number }>(
      `SELECT id FROM basicinfo_bfl_track
       WHERE register_number = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao]
    )

    if (existing[0]) {
      if (setClauses.length > 0) {
        setClauses.push("updated_at = NOW()")
        values.push(existing[0].id)
        await query(
          `UPDATE basicinfo_bfl_track SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
          values,
        )
      }
    } else if (setClauses.length > 0) {
      const payload = buildElementPayload(beian_hao, fieldValues)
      const rowHash = buildElementRowHash(beian_hao)
      const insertColumns = ["record_key", "payload", "row_hash", "source", "register_number"]
      const insertValues: unknown[] = [beian_hao, payload, rowHash, ELEMENTS_SOURCE, beian_hao]
      const insertPlaceholders: string[] = ["$1", "$2::jsonb", "$3", "$4", "$5"]
      let insertIndex = 6
      for (const [column, value] of Object.entries(fieldValues)) {
        if (value === undefined) continue
        insertColumns.push(column)
        if (column === "inception_date" || column === "puton_date") {
          insertPlaceholders.push(`$${insertIndex}::date`)
        } else if (column === "fee_manage_rate") {
          insertPlaceholders.push(`$${insertIndex}::numeric`)
        } else {
          insertPlaceholders.push(`$${insertIndex}`)
        }
        insertValues.push(value)
        insertIndex++
      }
      insertColumns.push("updated_at")
      insertPlaceholders.push("NOW()")
      await query(
        `INSERT INTO basicinfo_bfl_track (${insertColumns.join(", ")}) VALUES (${insertPlaceholders.join(", ")})`,
        insertValues,
      )
    }

    if (fund_manager !== undefined) {
      await query(
        `UPDATE private_fund_info SET manager = $2 WHERE beian_hao = $1`,
        [beian_hao, fund_manager]
      ).catch(() => undefined)
    }

    if (body.advisor !== undefined || body.custodian !== undefined) {
      await query(
        `UPDATE private_fund_info_bfl
         SET investment_advisor = $2,
             custodian = $3
         WHERE beian_hao = $1`,
        [beian_hao, advisor ?? null, custodian ?? null]
      ).catch(() => undefined)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[ops/fund-elements PATCH]", err)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
