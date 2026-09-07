import { query } from "@/lib/db"
import { toIsoDateInputValue } from "@/lib/nav-trading-day"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

async function ensureOperationDatesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_operation_dates (
      beian_hao VARCHAR(64) PRIMARY KEY,
      operation_date DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

function normalizeBeian(beianHao: string): string {
  const raw = String(beianHao ?? "").trim()
  return canonicalizeShareClassBeianCode(raw) || raw
}

export async function loadOperationDate(keys: string[]): Promise<string | null> {
  if (!keys.length) return null
  await ensureOperationDatesTable()
  const rows = await query<{ operation_date: string | null }>(
    `SELECT operation_date::text AS operation_date
     FROM ops_fund_operation_dates
     WHERE beian_hao = ANY($1::text[])
     ORDER BY
       CASE WHEN UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($2)) THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 1`,
    [keys, keys[0]],
  )
  return toIsoDateInputValue(rows[0]?.operation_date) || null
}

export async function upsertOperationDate(beianHao: string, operationDate: string | null) {
  const code = normalizeBeian(beianHao)
  if (!code) return
  await ensureOperationDatesTable()
  const value = toIsoDateInputValue(operationDate) || null
  if (!value) {
    await query(`DELETE FROM ops_fund_operation_dates WHERE beian_hao = $1`, [code])
    return
  }
  await query(
    `INSERT INTO ops_fund_operation_dates (beian_hao, operation_date, updated_at)
     VALUES ($1, $2::date, NOW())
     ON CONFLICT (beian_hao) DO UPDATE
     SET operation_date = EXCLUDED.operation_date, updated_at = NOW()`,
    [code, value],
  )
}

export async function loadOperationDatesByCodes(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (codes.length === 0) return out
  await ensureOperationDatesTable()
  const rows = await query<{ beian_hao: string; operation_date: string | null }>(
    `SELECT beian_hao, operation_date::text AS operation_date
     FROM ops_fund_operation_dates
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  ).catch(() => [] as Array<{ beian_hao: string; operation_date: string | null }>)
  for (const row of rows) {
    const day = toIsoDateInputValue(row.operation_date)
    const code = String(row.beian_hao ?? "").trim().toUpperCase()
    if (!code || !day) continue
    out.set(code, day)
  }
  return out
}
