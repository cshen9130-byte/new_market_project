import { publicQuery, query } from "@/lib/db"
import { resolveLinkedMomAccounts, type FundMomAccountLink } from "@/lib/ma/fund-mom-account-map"

export type FundMomAccountRow = {
  beian_hao: string
  product_name: string
  account_code: string
  note: string
  updated_by: string
  updated_at: string
}

export async function ensureFundMomAccountTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_mom_accounts (
      beian_hao    VARCHAR(64) PRIMARY KEY,
      product_name VARCHAR(255) NOT NULL DEFAULT '',
      account_code VARCHAR(64) NOT NULL,
      note         VARCHAR(255) NOT NULL DEFAULT '',
      updated_by   VARCHAR(255) NOT NULL DEFAULT '',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function getFundMomAccount(beianHao: string): Promise<FundMomAccountRow | null> {
  const code = beianHao.trim()
  if (!code) return null
  await ensureFundMomAccountTable()
  const rows = await query<FundMomAccountRow>(
    `SELECT beian_hao, product_name, account_code, note, updated_by, updated_at::text
     FROM ops_fund_mom_accounts
     WHERE UPPER(TRIM(beian_hao)) = UPPER(TRIM($1))
     LIMIT 1`,
    [code],
  )
  return rows[0] ?? null
}

export async function upsertFundMomAccount(input: {
  beianHao: string
  productName?: string
  accountCode: string
  note?: string
  updatedBy?: string
}): Promise<FundMomAccountRow> {
  await ensureFundMomAccountTable()
  const rows = await query<FundMomAccountRow>(
    `INSERT INTO ops_fund_mom_accounts (beian_hao, product_name, account_code, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (beian_hao) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       account_code = EXCLUDED.account_code,
       note = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING beian_hao, product_name, account_code, note, updated_by, updated_at::text`,
    [
      input.beianHao.trim(),
      (input.productName ?? "").trim(),
      input.accountCode.trim().toLowerCase(),
      (input.note ?? "").trim().slice(0, 255),
      (input.updatedBy ?? "").trim(),
    ],
  )
  return rows[0]
}

export async function deleteFundMomAccount(beianHao: string): Promise<boolean> {
  const code = beianHao.trim()
  if (!code) return false
  await ensureFundMomAccountTable()
  const rows = await query<{ beian_hao: string }>(
    `DELETE FROM ops_fund_mom_accounts
     WHERE UPPER(TRIM(beian_hao)) = UPPER(TRIM($1))
     RETURNING beian_hao`,
    [code],
  )
  return rows.length > 0
}

export async function listMomSettlementAccounts(): Promise<string[]> {
  try {
    const res = await publicQuery(
      `SELECT DISTINCT LOWER(TRIM("账户"::text)) AS account
       FROM public.mom_daily_reports
       WHERE "账户" IS NOT NULL AND TRIM("账户"::text) <> ''
       ORDER BY 1`,
    )
    return (res.rows as Array<{ account: string }>)
      .map((row) => String(row.account || "").toLowerCase())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** DB link first, then the static fallback (e.g. 淳德行稳致远 → rx348). */
export async function resolveFundMomAccountLinks(
  beianHao: string,
  productName?: string | null,
): Promise<FundMomAccountLink[]> {
  try {
    const row = await getFundMomAccount(beianHao)
    if (row?.account_code) {
      return [{ account: row.account_code.toLowerCase(), note: row.note || undefined }]
    }
  } catch {
    // table may not be reachable
  }
  return resolveLinkedMomAccounts(beianHao, productName)
}
