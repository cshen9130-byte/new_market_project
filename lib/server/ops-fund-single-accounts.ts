import { query } from "@/lib/db"

export type FundSingleAccountRow = {
  beian_hao: string
  product_name: string
  account_no: string
  note: string
  updated_by: string
  updated_at: string
}

export async function ensureFundSingleAccountTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_single_accounts (
      account_no   VARCHAR(64) PRIMARY KEY,
      beian_hao    VARCHAR(64) NOT NULL,
      product_name VARCHAR(255) NOT NULL DEFAULT '',
      note         VARCHAR(255) NOT NULL DEFAULT '',
      updated_by   VARCHAR(255) NOT NULL DEFAULT '',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function listFundSingleAccounts(): Promise<FundSingleAccountRow[]> {
  await ensureFundSingleAccountTable()
  return query<FundSingleAccountRow>(
    `SELECT beian_hao, product_name, account_no, note, updated_by, updated_at::text
     FROM ops_fund_single_accounts
     ORDER BY product_name, account_no`,
  )
}

export async function upsertFundSingleAccount(input: {
  beianHao: string
  productName?: string
  accountNo: string
  note?: string
  updatedBy?: string
}): Promise<FundSingleAccountRow> {
  await ensureFundSingleAccountTable()
  const rows = await query<FundSingleAccountRow>(
    `INSERT INTO ops_fund_single_accounts (account_no, beian_hao, product_name, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (account_no) DO UPDATE SET
       beian_hao = EXCLUDED.beian_hao,
       product_name = EXCLUDED.product_name,
       note = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING beian_hao, product_name, account_no, note, updated_by, updated_at::text`,
    [
      input.accountNo.trim(),
      input.beianHao.trim().toUpperCase(),
      (input.productName ?? "").trim(),
      (input.note ?? "").trim().slice(0, 255),
      (input.updatedBy ?? "").trim(),
    ],
  )
  return rows[0]
}

export async function deleteFundSingleAccount(accountNo: string): Promise<boolean> {
  const code = accountNo.trim()
  if (!code) return false
  await ensureFundSingleAccountTable()
  const rows = await query<{ account_no: string }>(
    `DELETE FROM ops_fund_single_accounts
     WHERE account_no = $1
     RETURNING account_no`,
    [code],
  )
  return rows.length > 0
}
