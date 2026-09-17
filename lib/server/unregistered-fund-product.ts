import { query } from "@/lib/db"
import { preferAmacOfficialName, sqlFundNameMatch } from "@/lib/server/fund-name-match"
import { fundNameCore, normalizeRegisterCode } from "@/lib/server/fund-picker-search"
import {
  loadExtractedElementDisplayValues,
  writeFillEmptyElementsAcrossShareClasses,
} from "@/lib/server/fund-elements-write"
import {
  addFundToTrackingPool,
  invalidateTrackingPoolListCaches,
} from "@/lib/server/tracking-pool-membership"
import { updateElementExtractJob, type ElementExtractJobRow } from "@/lib/server/fund-element-extract-jobs"
import type { ExtractedFundElements } from "@/lib/server/fund-contract-element-extract"

export const UNREGISTERED_PENDING_NOTE = "未备案临时产品，待协会同步后并入正式产品"

export type UnregisteredProductRow = {
  id: number
  extract_job_id: number
  temp_beian_hao: string
  product_name: string
  expected_register_number: string | null
  created_by: string
  created_at: string
  status: "pending" | "promoted" | "skipped"
  promoted_beian_hao: string | null
  promoted_at: string | null
  skip_reason: string | null
}

export type UnregisteredPromoteResult = {
  pending: number
  promoted: number
  skipped: number
  failed: number
}

const TEMP_BEIAN_RE = /^TMP\d{5}$/
const BEIAN_IN_TEXT_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9]{4,7}[A-Z]?)(?![A-Z0-9])/g

let tableReady: Promise<void> | null = null

export function isTempBeianCode(code: string | null | undefined): boolean {
  return TEMP_BEIAN_RE.test(String(code ?? "").trim().toUpperCase())
}

export function unregisteredPromotedNote(beianHao: string): string {
  return `已并入正式产品 ${beianHao}`
}

export function isUnregisteredPendingNote(message: string | null | undefined): boolean {
  return (message ?? "").includes("未备案临时产品")
}

export async function ensureUnregisteredProductsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_unregistered_products (
          id                       BIGSERIAL PRIMARY KEY,
          extract_job_id           BIGINT NOT NULL,
          temp_beian_hao           VARCHAR(64) NOT NULL,
          product_name             TEXT NOT NULL,
          expected_register_number VARCHAR(64),
          created_by               VARCHAR(255) NOT NULL DEFAULT '',
          created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status                   VARCHAR(32) NOT NULL DEFAULT 'pending',
          promoted_beian_hao       VARCHAR(64),
          promoted_at              TIMESTAMPTZ,
          skip_reason              TEXT
        )
      `)
      await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_unregistered_products_job
          ON ops_unregistered_products (extract_job_id)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_unregistered_products_status
          ON ops_unregistered_products (status, created_at DESC)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_unregistered_products_temp_beian
          ON ops_unregistered_products (temp_beian_hao)
      `)
    })().catch((err) => {
      tableReady = null
      throw err
    })
  }
  await tableReady
}

function extractRegisterCodesFromText(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.toUpperCase().matchAll(BEIAN_IN_TEXT_RE)) {
    const code = normalizeRegisterCode(match[1])
    if (code && !isTempBeianCode(code)) out.add(code)
  }
  return Array.from(out)
}

export function guessUnregisteredRegisterNumber(input: {
  extracted?: ExtractedFundElements | null
  fileName?: string | null
  contractText?: string | null
  override?: string | null
}): string | null {
  const fromOverride = normalizeRegisterCode(input.override)
  if (fromOverride && !isTempBeianCode(fromOverride)) return fromOverride
  const fromExtracted = normalizeRegisterCode(input.extracted?.register_number)
  if (fromExtracted && !isTempBeianCode(fromExtracted)) return fromExtracted
  for (const source of [input.fileName, input.contractText]) {
    const codes = extractRegisterCodesFromText(source ?? "")
    if (codes[0]) return codes[0]
  }
  return null
}

export function resolveUnregisteredProductName(input: {
  extracted?: ExtractedFundElements | null
  fileName?: string | null
  override?: string | null
}): string {
  const override = input.override?.trim()
  if (override) return override
  const fromExtracted = input.extracted?.fund_name?.trim()
  if (fromExtracted) return fromExtracted
  const fileName = (input.fileName ?? "").replace(/\.[^.]+$/, "")
  const cleaned = fileName
    .replace(/^【\d+】/, "")
    .replace(/私募基金合同.*$/u, "")
    .replace(/基金合同.*$/u, "")
    .replace(/_V[\d.]+$/i, "")
    .replace(/^[A-Z][A-Z0-9]{4,7}[A-Z]?/, "")
    .trim()
  return cleaned || "未备案产品"
}

function namesAgree(a: string, b: string): boolean {
  const left = fundNameCore(a).replace(/\s+/g, "")
  const right = fundNameCore(b).replace(/\s+/g, "")
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function buildTempBeian(jobId: number): string {
  return `TMP${String(Math.max(0, jobId)).padStart(5, "0").slice(-5)}`
}

async function fundBeianExists(beianHao: string): Promise<boolean> {
  const code = beianHao.trim()
  if (!code) return false
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM (
       SELECT beian_hao FROM private_fund_info_bfl WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
       UNION ALL
       SELECT beian_hao FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
     ) t
     LIMIT 1`,
    [code],
  ).catch(() => [] as { ok: number }[])
  return Boolean(rows[0]?.ok)
}

async function findExistingProductByRegister(code: string): Promise<{
  beian_hao: string
  product_name: string
} | null> {
  const rows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM (
       SELECT beian_hao, product_name FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = $1
       UNION ALL
       SELECT beian_hao, product_name FROM private_fund_info_bfl WHERE UPPER(BTRIM(beian_hao)) = $1
     ) t
     LIMIT 1`,
    [code.toUpperCase()],
  ).catch(() => [] as { beian_hao: string; product_name: string }[])
  return rows[0] ?? null
}

async function findExistingProductByName(productName: string): Promise<{
  beian_hao: string
  product_name: string
} | null> {
  const rows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM (
       SELECT beian_hao, product_name FROM private_fund_info
       WHERE ${sqlFundNameMatch("product_name", "$1")}
       UNION ALL
       SELECT beian_hao, product_name FROM private_fund_info_bfl
       WHERE ${sqlFundNameMatch("product_name", "$1")}
         AND beian_hao NOT LIKE 'TMP%'
     ) t
     LIMIT 5`,
    [productName],
  ).catch(() => [] as { beian_hao: string; product_name: string }[])
  const agreed = rows.filter((row) => namesAgree(row.product_name, productName))
  const unique = new Map<string, { beian_hao: string; product_name: string }>()
  for (const row of agreed) unique.set(row.beian_hao.trim().toUpperCase(), row)
  if (unique.size !== 1) return null
  return Array.from(unique.values())[0] ?? null
}

export async function getUnregisteredProductByJobId(
  jobId: number,
): Promise<UnregisteredProductRow | null> {
  try {
    await ensureUnregisteredProductsTable()
    const rows = await query<UnregisteredProductRow>(
      `SELECT id, extract_job_id, temp_beian_hao, product_name, expected_register_number,
              created_by, created_at::text, status, promoted_beian_hao, promoted_at::text, skip_reason
       FROM ops_unregistered_products
       WHERE extract_job_id = $1
       LIMIT 1`,
      [jobId],
    )
    return rows[0] ?? null
  } catch (err) {
    console.error("[unregistered-product] lookup failed", err)
    return null
  }
}

/**
 * Materialize a temporary BFL product so 未备案合同 can be written now.
 * If AMAC / BFL already has a unique match, reuse that product instead.
 */
export async function createUnregisteredProductForExtractJob(input: {
  job: ElementExtractJobRow
  product_name?: string | null
  register_number?: string | null
  created_by?: string
}): Promise<{
  beian_hao: string
  product_name: string
  reused_existing: boolean
}> {
  await ensureUnregisteredProductsTable()

  const existingPending = await getUnregisteredProductByJobId(input.job.id)
  if (existingPending?.status === "pending") {
    return {
      beian_hao: existingPending.temp_beian_hao,
      product_name: existingPending.product_name,
      reused_existing: false,
    }
  }
  if (existingPending?.status === "promoted" && existingPending.promoted_beian_hao) {
    return {
      beian_hao: existingPending.promoted_beian_hao,
      product_name: existingPending.product_name,
      reused_existing: true,
    }
  }

  const productName = resolveUnregisteredProductName({
    extracted: input.job.extracted_json,
    fileName: input.job.original_filename,
    override: input.product_name,
  })
  if (!productName.trim()) throw new Error("请填写产品名称后再确认为未备案产品")

  const expectedRegister = guessUnregisteredRegisterNumber({
    extracted: input.job.extracted_json,
    fileName: input.job.original_filename,
    contractText: input.job.text_preview,
    override: input.register_number,
  })

  if (expectedRegister) {
    const byRegister = await findExistingProductByRegister(expectedRegister)
    if (byRegister && namesAgree(byRegister.product_name, productName)) {
      return { ...byRegister, reused_existing: true }
    }
    if (byRegister && !namesAgree(byRegister.product_name, productName)) {
      throw new Error(
        `备案号 ${expectedRegister} 已存在产品「${byRegister.product_name}」，与合同名称不一致，请人工选择产品`,
      )
    }
  }

  const byName = await findExistingProductByName(productName)
  if (byName && (!expectedRegister || byName.beian_hao.toUpperCase() === expectedRegister)) {
    return { ...byName, reused_existing: true }
  }

  let beianHao = expectedRegister
  if (!beianHao) {
    beianHao = buildTempBeian(input.job.id)
    if (await fundBeianExists(beianHao)) {
      beianHao = `TMP${String((input.job.id * 7 + 13) % 100000).padStart(5, "0")}`
    }
  }
  if (await fundBeianExists(beianHao) && !expectedRegister) {
    throw new Error("临时产品编号冲突，请稍后重试")
  }

  await addFundToTrackingPool("bfl", beianHao, productName)
  invalidateTrackingPoolListCaches(["bfl"])

  await query(
    `INSERT INTO ops_unregistered_products
       (extract_job_id, temp_beian_hao, product_name, expected_register_number, created_by, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (extract_job_id) DO UPDATE SET
       temp_beian_hao = EXCLUDED.temp_beian_hao,
       product_name = EXCLUDED.product_name,
       expected_register_number = EXCLUDED.expected_register_number,
       status = 'pending',
       promoted_beian_hao = NULL,
       promoted_at = NULL,
       skip_reason = NULL`,
    [input.job.id, beianHao, productName, expectedRegister, input.created_by?.trim() || ""],
  )

  return { beian_hao: beianHao, product_name: productName, reused_existing: false }
}

async function findAmacMatch(row: UnregisteredProductRow): Promise<{
  beian_hao: string
  product_name: string
  manager: string | null
  inception_date: string | null
  puton_date: string | null
  custodian: string | null
} | null> {
  const candidates: string[] = []
  const expected = normalizeRegisterCode(row.expected_register_number)
  const temp = normalizeRegisterCode(row.temp_beian_hao)
  if (expected && !isTempBeianCode(expected)) candidates.push(expected)
  if (temp && !isTempBeianCode(temp) && !candidates.includes(temp)) candidates.push(temp)

  for (const code of candidates) {
    const rows = await query<{
      beian_hao: string
      product_name: string
      manager: string | null
      inception_date: string | null
      puton_date: string | null
      custodian: string | null
    }>(
      `SELECT a.fund_no AS beian_hao,
              a.fund_name AS product_name,
              a.manager_name AS manager,
              a.establish_date::text AS inception_date,
              a.put_on_record_date::text AS puton_date,
              NULLIF(BTRIM(a.mandator_name), '') AS custodian
       FROM amac_private_funds a
       WHERE UPPER(BTRIM(a.fund_no)) = $1
       LIMIT 1`,
      [code],
    ).catch(() => [])
    const hit = rows[0]
    if (hit && namesAgree(hit.product_name, row.product_name)) return hit
    if (hit && !namesAgree(hit.product_name, row.product_name)) {
      return null
    }
  }

  const nameRows = await query<{
    beian_hao: string
    product_name: string
    manager: string | null
    inception_date: string | null
    puton_date: string | null
    custodian: string | null
  }>(
    `SELECT a.fund_no AS beian_hao,
            a.fund_name AS product_name,
            a.manager_name AS manager,
            a.establish_date::text AS inception_date,
            a.put_on_record_date::text AS puton_date,
            NULLIF(BTRIM(a.mandator_name), '') AS custodian
     FROM amac_private_funds a
     WHERE ${sqlFundNameMatch("a.fund_name", "$1")}
     LIMIT 8`,
    [row.product_name],
  ).catch(() => [])
  const agreed = nameRows.filter((item) => namesAgree(item.product_name, row.product_name))
  const unique = new Map<string, (typeof agreed)[number]>()
  for (const item of agreed) unique.set(item.beian_hao.trim().toUpperCase(), item)
  if (unique.size === 1) return Array.from(unique.values())[0] ?? null
  return null
}

async function rekeyOperationDate(from: string, to: string) {
  if (from.toUpperCase() === to.toUpperCase()) return
  await query(
    `INSERT INTO ops_fund_operation_dates (beian_hao, operation_date, updated_at)
     SELECT $2, operation_date, NOW()
     FROM ops_fund_operation_dates
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
     ON CONFLICT (beian_hao) DO UPDATE
       SET operation_date = COALESCE(ops_fund_operation_dates.operation_date, EXCLUDED.operation_date),
           updated_at = NOW()`,
    [from, to],
  ).catch(() => undefined)
  await query(
    `DELETE FROM ops_fund_operation_dates WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
    [from],
  ).catch(() => undefined)
}

async function rekeyTrackRow(from: string, to: string, productName: string) {
  if (from.toUpperCase() === to.toUpperCase()) return
  const source = await loadExtractedElementDisplayValues(from, productName, { exactBeian: true })
  if (source) {
    await writeFillEmptyElementsAcrossShareClasses(to, productName, source)
  }
  await query(
    `DELETE FROM basicinfo_bfl_track
     WHERE UPPER(BTRIM(COALESCE(register_number, record_key))) = UPPER(BTRIM($1))
       AND UPPER(BTRIM(COALESCE(register_number, record_key))) <> UPPER(BTRIM($2))`,
    [from, to],
  ).catch(() => undefined)
}

async function rekeyBflProduct(from: string, to: string, productName: string) {
  if (from.toUpperCase() === to.toUpperCase()) {
    await query(
      `UPDATE private_fund_info_bfl
       SET product_name = $2, updated_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
         AND product_name IS DISTINCT FROM $2`,
      [to, productName],
    ).catch(() => undefined)
    return
  }
  const dest = await query<{ beian_hao: string }>(
    `SELECT beian_hao FROM private_fund_info_bfl WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1)) LIMIT 1`,
    [to],
  ).catch(() => [] as { beian_hao: string }[])
  if (dest[0]) {
    await query(
      `DELETE FROM private_fund_info_bfl WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
      [from],
    ).catch(() => undefined)
    return
  }
  await query(
    `UPDATE private_fund_info_bfl
     SET beian_hao = $2, product_name = $3, updated_at = NOW()
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
    [from, to, productName],
  )
}

async function rekeyExtractArtifacts(from: string, to: string, productName: string) {
  await query(
    `UPDATE ops_fund_contract_materials
     SET beian_hao = $2
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
    [from, to],
  ).catch(() => undefined)
  await query(
    `UPDATE ops_element_extract_jobs
     SET beian_hao = $2,
         product_name = COALESCE(NULLIF(BTRIM($3), ''), product_name),
         extracted_json = CASE
           WHEN extracted_json IS NULL THEN extracted_json
           ELSE jsonb_set(extracted_json, '{register_number}', to_jsonb($2::text), true)
         END
     WHERE UPPER(BTRIM(COALESCE(beian_hao, ''))) = UPPER(BTRIM($1))`,
    [from, to, productName],
  ).catch(() => undefined)
}

async function fillAmacFieldsOnProduct(
  beianHao: string,
  productName: string,
  amac: {
    manager: string | null
    inception_date: string | null
    puton_date: string | null
    custodian: string | null
  },
) {
  await writeFillEmptyElementsAcrossShareClasses(beianHao, productName, {
    fund_name: productName,
    register_number: beianHao,
    advisor: null,
    fund_manager: amac.manager,
    inception_date: amac.inception_date,
    puton_date: amac.puton_date,
    custodian: amac.custodian,
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
  })
  if (amac.manager?.trim()) {
    await query(
      `UPDATE private_fund_info
       SET manager = COALESCE(NULLIF(BTRIM(manager), ''), $2)
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
      [beianHao, amac.manager.trim()],
    ).catch(() => undefined)
  }
}

async function promoteOne(row: UnregisteredProductRow): Promise<"promoted" | "skipped" | "pending"> {
  const amac = await findAmacMatch(row)
  if (!amac) return "pending"

  const officialName = preferAmacOfficialName(row.product_name, amac.product_name) || amac.product_name
  const from = row.temp_beian_hao.trim()
  const to = amac.beian_hao.trim()

  await rekeyBflProduct(from, to, officialName)
  await rekeyTrackRow(from, to, officialName)
  await rekeyExtractArtifacts(from, to, officialName)
  await rekeyOperationDate(from, to)
  await fillAmacFieldsOnProduct(to, officialName, amac)

  await query(
    `UPDATE ops_unregistered_products
     SET status = 'promoted',
         promoted_beian_hao = $2,
         promoted_at = NOW(),
         product_name = $3,
         skip_reason = NULL
     WHERE id = $1`,
    [row.id, to, officialName],
  )
  await query(
    `UPDATE ops_element_extract_jobs
     SET error_message = $2,
         beian_hao = COALESCE(beian_hao, $3),
         product_name = COALESCE(NULLIF(BTRIM($4), ''), product_name)
     WHERE id = $1`,
    [row.extract_job_id, unregisteredPromotedNote(to), to, officialName],
  ).catch(() => undefined)

  invalidateTrackingPoolListCaches(["bfl"])
  return "promoted"
}

export async function promoteUnregisteredProducts(): Promise<UnregisteredPromoteResult> {
  await ensureUnregisteredProductsTable()
  const pending = await query<UnregisteredProductRow>(
    `SELECT id, extract_job_id, temp_beian_hao, product_name, expected_register_number,
            created_by, created_at::text, status, promoted_beian_hao, promoted_at::text, skip_reason
     FROM ops_unregistered_products
     WHERE status = 'pending'
     ORDER BY id ASC`,
  )
  const result: UnregisteredPromoteResult = {
    pending: pending.length,
    promoted: 0,
    skipped: 0,
    failed: 0,
  }
  for (const row of pending) {
    try {
      const outcome = await promoteOne(row)
      if (outcome === "promoted") result.promoted += 1
    } catch (err) {
      result.failed += 1
      const message = err instanceof Error ? err.message : "并入正式产品失败"
      console.error(`[unregistered-product] promote ${row.temp_beian_hao} failed:`, err)
      await query(
        `UPDATE ops_unregistered_products SET skip_reason = $2 WHERE id = $1`,
        [row.id, message],
      ).catch(() => undefined)
    }
  }
  result.pending = Math.max(0, result.pending - result.promoted - result.failed)
  return result
}

export async function markExtractJobUnregisteredPending(
  jobId: number,
  beianHao: string,
  productName: string,
): Promise<void> {
  await updateElementExtractJob(jobId, {
    beian_hao: beianHao,
    product_name: productName,
    error_message: UNREGISTERED_PENDING_NOTE,
  })
}
