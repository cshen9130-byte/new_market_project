import { createHash } from "crypto"
import { query } from "@/lib/db"
import {
  buildFeePayFormulaConfig,
  formatFeePayFormula,
} from "@/lib/ma/fund-elements-extra"
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import {
  loadBasicinfoTrackByBeianKeys,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import {
  FUND_ELEMENT_BASIC_KEYS,
  FUND_ELEMENT_SUBSCRIPTION_KEYS,
  type ExtractedFundElements,
} from "@/lib/server/fund-contract-element-extract"
import { toIsoDateInputValue } from "@/lib/nav-trading-day"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

const ELEMENTS_SOURCE = "ops/fund-elements"

const TEMP_OPEN_MAP: Record<number, string> = {
  1: "可",
  2: "不可临开",
  3: "可临开回",
}

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

export type FundElementWriteBody = Record<string, unknown> & {
  beian_hao?: string
}

function normalizeDate(value: unknown): string | null {
  const s = toIsoDateInputValue(value)
  return s || null
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

export async function writeFundElementsFromBody(body: FundElementWriteBody): Promise<{ beian_hao: string }> {
  const rawBeian = String(body?.beian_hao ?? "").trim()
  if (!rawBeian) throw new Error("missing beian_hao")
  const beian_hao = canonicalizeShareClassBeianCode(rawBeian) || rawBeian

  const formulaRaw = body.fee_pay_formula_config as
    | { mode?: unknown; gradients?: unknown }
    | undefined
  const formulaConfig =
    formulaRaw !== undefined ||
    body.fee_pay_mode !== undefined ||
    body.fee_pay_gradients !== undefined
      ? buildFeePayFormulaConfig(
          formulaRaw?.mode ?? body.fee_pay_mode,
          formulaRaw?.gradients ?? body.fee_pay_gradients,
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

  await upsertBasicinfoTrackResilient(beian_hao, fieldValues)

  if (fund_manager !== undefined) {
    await query(
      `UPDATE private_fund_info SET manager = $2 WHERE beian_hao = $1`,
      [beian_hao, fund_manager],
    ).catch(() => undefined)
  }

  if (body.advisor !== undefined || body.custodian !== undefined) {
    await query(
      `UPDATE private_fund_info_bfl
       SET investment_advisor = $2,
           custodian = $3
       WHERE beian_hao = $1`,
      [beian_hao, advisor ?? null, custodian ?? null],
    ).catch(() => undefined)
  }

  return { beian_hao }
}

export async function loadExtractedElementDisplayValues(
  beian_hao: string,
  product_name?: string | null,
): Promise<ExtractedFundElements | null> {
  const raw = beian_hao.trim()
  if (!raw) return null
  const keys = await resolveFundElementsBeianKeys(raw, product_name || null)

  const [elementRows, pfiRows] = await Promise.all([
    loadBasicinfoTrackByBeianKeys<BasicinfoTrackRow>(
      keys,
      `SELECT fund_name, register_number, advisor,
              inception_date::text, puton_date::text, mandator_name,
              open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay
       FROM basicinfo_bfl_track`,
    ).catch(() => [] as BasicinfoTrackRow[]),
    query<{ manager: string | null }>(
      `SELECT manager FROM private_fund_info WHERE beian_hao = ANY($1::text[]) LIMIT 1`,
      [keys],
    ).catch(() => [] as { manager: string | null }[]),
  ])

  const el = elementRows[0]
  if (!el && !pfiRows[0]) {
    return {
      fund_name: null,
      register_number: canonicalizeShareClassBeianCode(raw) ?? raw,
      advisor: null,
      fund_manager: null,
      inception_date: null,
      puton_date: null,
      custodian: null,
      open_day: null,
      is_temporary_open: null,
      fee_purchase: null,
      add_amount: null,
      fee_redeem: null,
      precautious_line: null,
      closed_period: null,
      stop_line: null,
      fee_manage_rate: null,
      fee_trust: null,
      fee_manage: null,
      fee_admin_service: null,
      fee_pay: null,
    }
  }

  const is_temporary_open =
    el?.is_temporary_open != null
      ? (TEMP_OPEN_MAP[el.is_temporary_open] ?? String(el.is_temporary_open))
      : null
  const fee_manage_rate =
    el?.fee_manage_rate != null
      ? `${(parseFloat(el.fee_manage_rate) * 100).toFixed(2)}%`
      : null
  const custodian =
    el?.mandator_name?.trim() ||
    (await lookupAmacMandatorName(keys[0] || raw)) ||
    null

  return {
    fund_name: el?.fund_name ?? null,
    register_number: el?.register_number ?? canonicalizeShareClassBeianCode(raw) ?? raw,
    advisor: el?.advisor ?? null,
    fund_manager: pfiRows[0]?.manager || el?.advisor || null,
    inception_date: toIsoDateInputValue(el?.inception_date) || null,
    puton_date: toIsoDateInputValue(el?.puton_date) || null,
    custodian,
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
  }
}

const WRITE_KEYS = [...FUND_ELEMENT_BASIC_KEYS, ...FUND_ELEMENT_SUBSCRIPTION_KEYS] as const

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

/** Build a PATCH-style body that only fills currently empty destination fields. */
export function buildFillEmptyWriteBody(
  beian_hao: string,
  extracted: ExtractedFundElements,
  current: ExtractedFundElements | null,
): FundElementWriteBody | null {
  const body: FundElementWriteBody = { beian_hao }
  for (const key of WRITE_KEYS) {
    if (key === "register_number") continue
    const next = extracted[key]?.trim()
    if (!next) continue
    if (hasText(current?.[key])) continue
    body[key] = next
  }
  return Object.keys(body).length > 1 ? body : null
}

export function appliedFieldKeys(body: FundElementWriteBody | null): string[] {
  if (!body) return []
  return Object.keys(body).filter((key) => key !== "beian_hao" && body[key] !== undefined)
}
