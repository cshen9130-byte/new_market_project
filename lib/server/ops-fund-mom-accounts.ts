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

function momCompareLinkKey(beianHao: string, accountCode: string): { beian: string; account: string } | null {
  const beian = beianHao.trim().toUpperCase()
  const account = accountCode.trim().toLowerCase()
  if (!/^[A-Z0-9]{4,32}$/.test(beian)) return null
  if (!account || account.startsWith("cfmmc:")) return null
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(account)) return null
  return { beian, account }
}

/** Insert product ↔ MOM links that are not already saved. Does not replace an existing account. */
export async function importMissingFundMomAccounts(
  links: Array<{ beianHao: string; accountCode: string; productName?: string }>,
  updatedBy: string,
): Promise<string[]> {
  const byBeian = new Map<string, { beian: string; account: string; productName: string }>()
  for (const link of links) {
    const key = momCompareLinkKey(link.beianHao, link.accountCode)
    if (!key) continue
    byBeian.set(key.beian, {
      ...key,
      productName: (link.productName ?? "").trim().slice(0, 255),
    })
  }
  const rows = [...byBeian.values()]
  if (rows.length === 0) return []
  await ensureFundMomAccountTable()
  const inserted = await query<{ beian_hao: string }>(
    `INSERT INTO ops_fund_mom_accounts (beian_hao, product_name, account_code, note, updated_by, updated_at)
     SELECT s.beian,
            COALESCE(NULLIF(s.product_name, ''), NULLIF(trim(p.product_name), ''), ''),
            s.account,
            '',
            $4,
            NOW()
     FROM unnest($1::text[], $2::text[], $3::text[]) AS s(beian, account, product_name)
     LEFT JOIN LATERAL (
       SELECT product_name
       FROM private_fund_info
       WHERE upper(trim(beian_hao)) = s.beian
       LIMIT 1
     ) p ON true
     WHERE NOT EXISTS (
       SELECT 1 FROM ops_fund_mom_accounts e
       WHERE upper(trim(e.beian_hao)) = s.beian
         AND NULLIF(trim(e.account_code), '') IS NOT NULL
     )
     RETURNING beian_hao`,
    [
      rows.map((row) => row.beian),
      rows.map((row) => row.account),
      rows.map((row) => row.productName),
      updatedBy.trim().slice(0, 255),
    ],
  )
  return inserted.map((row) => row.beian_hao)
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
