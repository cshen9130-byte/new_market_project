import { createHash } from "crypto"
import { query } from "@/lib/db"
import {
  buildFeePayFormulaConfig,
  encodeTemporaryOpen,
  formatFeePayFormula,
  formatTemporaryOpen,
} from "@/lib/ma/fund-elements-extra"
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import {
  exactBeianWriteKeys,
  loadBasicinfoTrackByBeianKeys,
  loadFundElementExtraFields,
  resolveFundElementsBeianKeys,
} from "@/lib/server/fund-elements-lookup"
import {
  FUND_ELEMENT_BASIC_KEYS,
  FUND_ELEMENT_SUBSCRIPTION_KEYS,
  type ExtractedFundElementTextKey,
  type ExtractedFundElements,
} from "@/lib/server/fund-contract-element-extract"
import {
  isWeakAddAmount,
  isWeakFeeManage,
  isWeakFeePay,
  isWeakFormula,
  isWeakLockPeriod,
  isWeakRiskLevel,
  isWeakShortFee,
  isWeakTemporaryOpen,
  type ShareClassFeeOverrides,
} from "@/lib/server/fund-contract-element-keywords"
import { toIsoDateInputValue } from "@/lib/nav-trading-day"
import { canonicalizeShareClassBeianCode, listFundFamilyProducts } from "@/lib/server/share-class-product"

const ELEMENTS_SOURCE = "ops/fund-elements"

const OPTIONAL_TRACK_COLUMNS = new Set([
  "operation_date",
  "risk_level",
  "lock_period_desc",
  "fee_pay_formula",
  "fee_pay_formula_json",
])

let extraElementColumnsEnsured = false

async function ensureExtraElementColumns(): Promise<void> {
  if (extraElementColumnsEnsured) return
  extraElementColumnsEnsured = true
  const cols = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'basicinfo_bfl_track'
       AND column_name IN ('risk_level', 'lock_period_desc', 'fee_pay_formula', 'fee_pay_formula_json')`,
  ).catch(() => [] as { column_name: string }[])
  if (cols.length >= 4) return
  console.error(
    "[fund-elements-write] extra 要素 columns missing on basicinfo_bfl_track; apply scripts/db/018_basicinfo_bfl_track_extra_elements.sql",
  )
}

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

  const lookupKeys = exactBeianWriteKeys(beian_hao)
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
  await ensureExtraElementColumns()

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
  options?: { exactBeian?: boolean },
): Promise<ExtractedFundElements | null> {
  const raw = beian_hao.trim()
  if (!raw) return null
  const keys = options?.exactBeian
    ? exactBeianWriteKeys(raw)
    : await resolveFundElementsBeianKeys(raw, product_name || null)
  const trackOpts = options?.exactBeian ? { expandFamily: false as const } : undefined

  const [elementRows, extra, pfiRows] = await Promise.all([
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
      trackOpts,
    ).catch(() => [] as BasicinfoTrackRow[]),
    loadFundElementExtraFields(keys, trackOpts),
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
      risk_level: null,
      lock_period_desc: null,
      fee_pay_formula: null,
    }
  }

  const is_temporary_open = formatTemporaryOpen(el?.is_temporary_open)
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
    risk_level: extra.risk_level,
    lock_period_desc: extra.lock_period_desc,
    fee_pay_formula: extra.fee_pay_formula,
  }
}

const WRITE_KEYS = [...FUND_ELEMENT_BASIC_KEYS, ...FUND_ELEMENT_SUBSCRIPTION_KEYS] as const

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function currentNeedsFill(
  key: ExtractedFundElementTextKey,
  current: ExtractedFundElements | null,
): boolean {
  const value = current?.[key] as string | null | undefined
  if (key === "risk_level") return isWeakRiskLevel(value)
  if (key === "lock_period_desc") return isWeakLockPeriod(value)
  if (key === "fee_pay_formula") return isWeakFormula(value)
  if (key === "is_temporary_open") return isWeakTemporaryOpen(value)
  if (key === "fee_manage") return isWeakFeeManage(value)
  if (key === "fee_pay") return isWeakFeePay(value)
  if (key === "add_amount") return isWeakAddAmount(value)
  if (key === "fee_redeem" || key === "closed_period" || key === "fee_trust" || key === "fee_admin_service") {
    return isWeakShortFee(value)
  }
  if (key === "fee_manage_rate") {
    if (!hasText(value)) return true
    const n = parseFloat(String(value).replace(/%/g, ""))
    return !Number.isFinite(n) || n === 0
  }
  return !hasText(value)
}

function textField(extracted: ExtractedFundElements, key: ExtractedFundElementTextKey): string | null {
  const value = extracted[key]
  return typeof value === "string" ? value.trim() || null : null
}

function attachFormulaConfig(
  body: FundElementWriteBody,
  extracted: ExtractedFundElements,
  current: ExtractedFundElements | null,
  mode: "fill-empty" | "overwrite",
) {
  const next = extracted.fee_pay_formula_config
  if (!next) return
  if (mode === "fill-empty" && current?.fee_pay_formula_config && !isWeakFormula(current.fee_pay_formula)) return
  body.fee_pay_formula_config = next
}

/** Build a PATCH-style body that only fills currently empty destination fields. */
export function buildFillEmptyWriteBody(
  beian_hao: string,
  extracted: ExtractedFundElements,
  current: ExtractedFundElements | null,
  options?: { skipKeys?: Array<keyof ExtractedFundElements> },
): FundElementWriteBody | null {
  const skip = new Set(options?.skipKeys ?? [])
  const body: FundElementWriteBody = { beian_hao }
  for (const key of WRITE_KEYS) {
    if (key === "register_number" || skip.has(key)) continue
    const next = textField(extracted, key)
    if (!currentNeedsFill(key, current)) continue
    if (next) {
      body[key] = next
      continue
    }
    const prev = current?.[key]
    if (
      (key === "fee_pay_formula" || key === "fee_manage" || key === "add_amount" || key === "fee_pay")
      && typeof prev === "string"
      && prev.trim().length > 80
    ) {
      body[key] = ""
    } else if (
      (key === "fee_trust" || key === "fee_admin_service")
      && isWeakShortFee(typeof prev === "string" ? prev : null)
      && hasText(typeof prev === "string" ? prev : null)
    ) {
      body[key] = ""
    }
  }
  attachFormulaConfig(body, extracted, current, "fill-empty")
  return Object.keys(body).length > 1 ? body : null
}

export function appliedFieldKeys(body: FundElementWriteBody | null): string[] {
  if (!body) return []
  return Object.keys(body).filter((key) => key !== "beian_hao" && body[key] !== undefined)
}

/** Fill empty 要素 on the matched product and every A/B/C share class with the same extracted rules. */
export async function writeFillEmptyElementsAcrossShareClasses(
  beian_hao: string,
  product_name: string,
  extracted: ExtractedFundElements,
  options?: { shareClassOverrides?: ShareClassFeeOverrides },
): Promise<string[]> {
  return writeExtractedElementsAcrossShareClasses(
    beian_hao,
    product_name,
    extracted,
    "fill-empty",
    options?.shareClassOverrides,
  )
}

export async function writeOverwriteElementsAcrossShareClasses(
  beian_hao: string,
  product_name: string,
  extracted: ExtractedFundElements,
): Promise<string[]> {
  return writeExtractedElementsAcrossShareClasses(beian_hao, product_name, extracted, "overwrite")
}

/** Return the A/B/C share class letter from a beian code, or null if not a share class. */
function shareClassLetterFromBeian(beian: string): "A" | "B" | "C" | null {
  const upper = (beian ?? "").trim().toUpperCase()
  const last = upper.slice(-1)
  if (last === "A" || last === "B" || last === "C") return last
  return null
}

function shareClassLabelCount(s: string | null | undefined): number {
  return new Set(String(s ?? "").match(/[ABC]类/g) ?? []).size
}

/**
 * If the base fee_pay looks like a combined "A...;B..." multi-class string,
 * extract the portion that belongs to `cls`.  Returns null if not applicable.
 */
function splitClassFeePay(feePay: string | null | undefined, cls: string): string | null {
  if (!feePay) return null
  const s = feePay.trim()
  // Only act on values that look like multi-class combined strings (>= 2 class segments)
  if (!/[;；][A-C](?:类|份额|份)/.test(s)) return null
  const parts = s.split(/[;；]/)
  if (parts.length < 2) return null
  const clsPart = parts.find((p) => new RegExp(`^${cls}(?:类|份额|份)`).test(p.trim()))
  return clsPart?.trim() ?? null
}

/** Merge class-specific fee overrides into the extracted object before writing. */
function applyShareClassOverride(
  extracted: ExtractedFundElements,
  overrides: ShareClassFeeOverrides,
  beian: string,
): ExtractedFundElements {
  const cls = shareClassLetterFromBeian(beian)
  if (!cls) return extracted
  const override = overrides[cls] ?? {}
  const combinedPay = typeof extracted.fee_pay === "string" ? extracted.fee_pay : null
  // If the shared 说明 already maps A/B/C, keep it on every share class (same as 管理费).
  const keepCombinedPay = shareClassLabelCount(combinedPay) >= 2
  const fee_pay = keepCombinedPay
    ? combinedPay
    : (override.fee_pay ?? splitClassFeePay(combinedPay, cls))
  if (!Object.keys(override).length && !fee_pay) return extracted
  return {
    ...extracted,
    ...(override.fee_manage_rate !== undefined ? { fee_manage_rate: override.fee_manage_rate } : {}),
    ...(override.fee_manage !== undefined ? { fee_manage: override.fee_manage } : {}),
    ...(fee_pay !== undefined && fee_pay !== null ? { fee_pay } : {}),
  }
}

async function writeExtractedElementsAcrossShareClasses(
  beian_hao: string,
  product_name: string,
  extracted: ExtractedFundElements,
  mode: "fill-empty" | "overwrite",
  shareClassOverrides?: ShareClassFeeOverrides,
): Promise<string[]> {
  const family = await listFundFamilyProducts(beian_hao)
  const targets = family.length ? family : [{ beian_hao, product_name }]
  const primary = beian_hao.trim().toUpperCase()
  const written = new Set<string>()

  for (const target of targets) {
    const isPrimary = target.beian_hao.trim().toUpperCase() === primary
    const current = await loadExtractedElementDisplayValues(target.beian_hao, target.product_name, {
      exactBeian: true,
    })
    const skipKeys: Array<keyof ExtractedFundElements> = isPrimary ? [] : ["fund_name"]
    // Apply per-class overrides if provided
    const effectiveExtracted = shareClassOverrides
      ? applyShareClassOverride(extracted, shareClassOverrides, target.beian_hao)
      : extracted
    const body = mode === "overwrite"
      ? buildOverwriteNonEmptyWriteBody(
          target.beian_hao,
          mergeAmendmentIntoCurrent(effectiveExtracted, current, skipKeys),
          skipKeys,
        )
      : buildFillEmptyWriteBody(target.beian_hao, effectiveExtracted, current, { skipKeys })
    if (body) {
      await writeFundElementsFromBody(body)
      for (const key of appliedFieldKeys(body)) written.add(key)
    }

    // Class-specific overrides are authoritative — write them even when current value is non-empty,
    // provided they are more specific than the current value (not just null/empty).
    if (shareClassOverrides && mode === "fill-empty") {
      const cls = shareClassLetterFromBeian(target.beian_hao)
      const override = cls ? shareClassOverrides[cls] : undefined
      if (override || cls) {
        const overrideBody: FundElementWriteBody = { beian_hao: target.beian_hao }
        const cur = current ?? {}
        // fee_manage_rate: write if override differs from current
        if (
          override?.fee_manage_rate &&
          encodeManageRate(override.fee_manage_rate) !== encodeManageRate(String(cur.fee_manage_rate ?? ""))
        ) {
          overrideBody.fee_manage_rate = override.fee_manage_rate
        }
        // fee_manage: write if override is different from current (class-specific is more precise)
        if (override?.fee_manage && override.fee_manage !== (cur.fee_manage ?? "")) {
          overrideBody.fee_manage = override.fee_manage
        }
        // fee_pay: prefer the full A/B/C map; otherwise the class-specific line.
        const combinedPay = typeof extracted.fee_pay === "string" ? extracted.fee_pay : null
        const splitPay = splitClassFeePay(combinedPay, cls ?? "")
        const targetFeePay =
          shareClassLabelCount(combinedPay) >= 2
            ? combinedPay
            : (override?.fee_pay ?? splitPay)
        if (targetFeePay && targetFeePay !== (cur.fee_pay ?? "")) {
          overrideBody.fee_pay = targetFeePay
        }
        if (appliedFieldKeys(overrideBody).length) {
          await writeFundElementsFromBody(overrideBody)
          for (const key of appliedFieldKeys(overrideBody)) written.add(key)
        }
      }
    }
  }
  return [...written]
}

function mergeAmendmentIntoCurrent(
  extracted: ExtractedFundElements,
  current: ExtractedFundElements | null,
  skipKeys: Array<keyof ExtractedFundElements>,
): ExtractedFundElements {
  if (!current) return extracted
  const skip = new Set(skipKeys)
  const out = { ...extracted }
  const mergeKeys: ExtractedFundElementTextKey[] = [
    "fee_pay",
    "fee_pay_formula",
    "fee_manage",
    "fee_redeem",
    "fee_purchase",
    "closed_period",
    "open_day",
    "add_amount",
    "fee_trust",
    "fee_admin_service",
    "lock_period_desc",
  ]
  for (const key of mergeKeys) {
    if (skip.has(key)) continue
    const add = textField(extracted, key)
    const prev = textField(current, key)
    if (!add || !prev) continue
    if (key === "fee_pay" || key === "fee_pay_formula") {
      const addWeak = key === "fee_pay" ? isWeakFeePay(add) : isWeakFormula(add)
      const prevWeak = key === "fee_pay" ? isWeakFeePay(prev) : isWeakFormula(prev)
      if (shareClassLabelCount(add) > shareClassLabelCount(prev)) {
        out[key] = add
        continue
      }
      if (prevWeak && !addWeak) {
        out[key] = add
        continue
      }
      if (addWeak && !prevWeak) {
        out[key] = prev
        continue
      }
      // Do not glue "基准0%" onto "基准6%/40%" — conflicting 业绩报酬 rules replace, they don't stack.
      out[key] = add
      continue
    }
    if (prev.includes(add) || add.includes(prev)) {
      out[key] = add.length >= prev.length ? add : prev
      continue
    }
    out[key] = `${prev}；${add}`
  }
  if (!out.fee_pay_formula_config && extracted.fee_pay_formula_config) {
    out.fee_pay_formula_config = extracted.fee_pay_formula_config
  }
  return out
}

function buildOverwriteNonEmptyWriteBody(
  beian_hao: string,
  extracted: ExtractedFundElements,
  skipKeys: Array<keyof ExtractedFundElements>,
): FundElementWriteBody | null {
  const skip = new Set(skipKeys)
  const body: FundElementWriteBody = { beian_hao }
  for (const key of WRITE_KEYS) {
    if (key === "register_number" || skip.has(key)) continue
    const next = textField(extracted, key)
    if (!next) continue
    body[key] = next
  }
  attachFormulaConfig(body, extracted, null, "overwrite")
  return Object.keys(body).length > 1 ? body : null
}

const SHARE_CLASS_FANOUT_SKIP = new Set(["beian_hao", "fund_name", "register_number", "fanout_share_classes"])

/** Copy the same PATCH fields onto every A/B/C share class (used by live 要素提取). */
export async function writeFundElementsAcrossShareClasses(body: FundElementWriteBody): Promise<{ beian_hao: string }> {
  const written = await writeFundElementsFromBody(body)
  const family = await listFundFamilyProducts(written.beian_hao)
  const primary = written.beian_hao.trim().toUpperCase()
  for (const target of family) {
    if (target.beian_hao.trim().toUpperCase() === primary) continue
    const sibling: FundElementWriteBody = { beian_hao: target.beian_hao }
    for (const [key, value] of Object.entries(body)) {
      if (SHARE_CLASS_FANOUT_SKIP.has(key)) continue
      sibling[key] = value
    }
    if (Object.keys(sibling).length > 1) {
      await writeFundElementsFromBody(sibling)
    }
  }
  return written
}
