import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  buildFeePayFormulaConfig,
  formatFeePayFormula,
  parseFeePayFormulaConfig,
  type FeePayFormulaConfig,
} from "@/lib/ma/fund-elements-extra"
import {
  loadBasicinfoTrackByBeianKeys,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

const ELEMENTS_SOURCE = "ops/fund-elements"

export const dynamic = "force-dynamic"

const TEMP_OPEN_MAP: Record<number, string> = {
  1: "可",
  2: "不可临开",
  3: "可临开回",
}

/** Columns added by migrations 013 / 018 — strip and retry if not applied yet. */
const OPTIONAL_TRACK_COLUMNS = new Set([
  "operation_date",
  "risk_level",
  "lock_period_desc",
  "fee_pay_formula",
  "fee_pay_formula_json",
])

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
    const value = rows[0]?.operation_date
    return value ? value.slice(0, 10) : null
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
    register_number: el?.register_number ?? canonicalizeShareClassBeianCode(beian_hao) ?? beian_hao,
    advisor: el?.advisor ?? null,
    fund_manager,
    inception_date: el?.inception_date ? el.inception_date.slice(0, 10) : null,
    operation_date,
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

function missingOptionalColumn(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "")
  if (!/(does not exist|undefined_column)/i.test(msg)) return null
  const quoted = msg.match(/column "([^"]+)"/i)
  if (quoted && OPTIONAL_TRACK_COLUMNS.has(quoted[1])) return quoted[1]
  for (const col of OPTIONAL_TRACK_COLUMNS) {
    if (new RegExp(`\\b${col}\\b`, "i").test(msg)) return col
  }
  return null
}

function sqlCastForColumn(column: string): string {
  if (column === "inception_date" || column === "operation_date" || column === "puton_date") return "::date"
  if (column === "fee_manage_rate") return "::numeric"
  if (column === "fee_pay_formula_json") return "::jsonb"
  return ""
}

async function upsertBasicinfoTrack(
  beian_hao: string,
  fieldValues: Record<string, unknown>,
): Promise<void> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [column, value] of Object.entries(fieldValues)) {
    if (value === undefined) continue
    const cast = sqlCastForColumn(column)
    setClauses.push(`${column} = $${paramIndex}${cast}`)
    values.push(column === "fee_pay_formula_json" ? JSON.stringify(value) : value)
    paramIndex++
  }

  if (setClauses.length === 0) return

  const lookupKeys = await resolveFundElementsBeianKeys(beian_hao)
  const existing = await query<{ id: number }>(
    `SELECT id FROM basicinfo_bfl_track
     WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
     ORDER BY
       CASE
         WHEN UPPER(BTRIM(register_number)) = UPPER(BTRIM($2)) THEN 0
         WHEN UPPER(BTRIM(record_key)) = UPPER(BTRIM($2)) THEN 1
         ELSE 2
       END,
       updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [lookupKeys, lookupKeys[0] ?? beian_hao],
  )

  if (existing[0]) {
    setClauses.push("updated_at = NOW()")
    values.push(existing[0].id)
    await query(
      `UPDATE basicinfo_bfl_track SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
      values,
    )
    return
  }

  const payload = buildElementPayload(beian_hao, fieldValues)
  const rowHash = buildElementRowHash(beian_hao)
  const insertColumns = ["record_key", "payload", "row_hash", "source", "register_number"]
  const insertValues: unknown[] = [beian_hao, payload, rowHash, ELEMENTS_SOURCE, beian_hao]
  const insertPlaceholders: string[] = ["$1", "$2::jsonb", "$3", "$4", "$5"]
  let insertIndex = 6
  for (const [column, value] of Object.entries(fieldValues)) {
    if (value === undefined) continue
    insertColumns.push(column)
    insertPlaceholders.push(`$${insertIndex}${sqlCastForColumn(column)}`)
    insertValues.push(column === "fee_pay_formula_json" ? JSON.stringify(value) : value)
    insertIndex++
  }
  insertColumns.push("updated_at")
  insertPlaceholders.push("NOW()")
  await query(
    `INSERT INTO basicinfo_bfl_track (${insertColumns.join(", ")}) VALUES (${insertPlaceholders.join(", ")})`,
    insertValues,
  )
}

async function upsertBasicinfoTrackResilient(
  beian_hao: string,
  fieldValues: Record<string, unknown>,
): Promise<void> {
  let current = { ...fieldValues }
  for (let attempt = 0; attempt < OPTIONAL_TRACK_COLUMNS.size + 1; attempt++) {
    try {
      await upsertBasicinfoTrack(beian_hao, current)
      return
    } catch (err) {
      const missing = missingOptionalColumn(err)
      if (!missing || !(missing in current) || current[missing] === undefined) throw err
      const { [missing]: _omit, ...rest } = current
      current = rest
    }
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  const rawBeian = String(body?.beian_hao ?? "").trim()
  if (!rawBeian) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  // Persist under canonical share-class code (BTH74B) rather than mistaken SBTH74B.
  const beian_hao = canonicalizeShareClassBeianCode(rawBeian) || rawBeian

  const formulaConfig =
    body?.fee_pay_formula_config !== undefined ||
    body?.fee_pay_mode !== undefined ||
    body?.fee_pay_gradients !== undefined
      ? buildFeePayFormulaConfig(
          body?.fee_pay_formula_config?.mode ?? body?.fee_pay_mode,
          body?.fee_pay_formula_config?.gradients ?? body?.fee_pay_gradients,
        )
      : undefined
  const feePayFormula =
    body?.fee_pay_formula !== undefined
      ? normalizeOptionalString(body.fee_pay_formula)
      : formulaConfig !== undefined
        ? formatFeePayFormula(formulaConfig)
        : undefined

  const fieldValues: Record<string, unknown> = {
    fund_name: normalizeOptionalString(body.fund_name),
    advisor: normalizeOptionalString(body.advisor),
    inception_date: body.inception_date !== undefined ? normalizeDate(body.inception_date) : undefined,
    operation_date: body.operation_date !== undefined ? normalizeDate(body.operation_date) : undefined,
    puton_date: body.puton_date !== undefined ? normalizeDate(body.puton_date) : undefined,
    mandator_name: normalizeOptionalString(body.custodian),
    open_day: normalizeOptionalString(body.open_day),
    is_temporary_open: encodeTemporaryOpen(body.is_temporary_open),
    fee_purchase: normalizeOptionalString(body.fee_purchase),
    add_amount: normalizeOptionalString(body.add_amount),
    fee_redeem: normalizeOptionalString(body.fee_redeem),
    risk_level: normalizeOptionalString(body.risk_level),
    precautious_line: normalizeOptionalString(body.precautious_line),
    closed_period: normalizeOptionalString(body.closed_period),
    stop_line: normalizeOptionalString(body.stop_line),
    lock_period_desc: normalizeOptionalString(body.lock_period_desc),
    fee_manage_rate: encodeManageRate(body.fee_manage_rate),
    fee_trust: normalizeOptionalString(body.fee_trust),
    fee_manage: normalizeOptionalString(body.fee_manage),
    fee_admin_service: normalizeOptionalString(body.fee_admin_service),
    fee_pay: normalizeOptionalString(body.fee_pay),
    fee_pay_formula: feePayFormula,
    fee_pay_formula_json: formulaConfig === undefined ? undefined : formulaConfig,
  }

  const fund_manager = normalizeOptionalString(body.fund_manager)
  const advisor = normalizeOptionalString(body.advisor)
  const custodian = normalizeOptionalString(body.custodian)

  try {
    await upsertBasicinfoTrackResilient(beian_hao, fieldValues)

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
