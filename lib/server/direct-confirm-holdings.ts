/**
 * Roll up 交易确认单 申赎 into investor holding shares for 直投产品.
 * Scoped by crawl mailbox so FOF/company TA confirms are not treated as 直投 holdings.
 */

import { query } from "@/lib/db"
import { ensureEmailConfirmTable } from "@/lib/server/email-confirm-pg"

export type DirectConfirmHolding = {
  fundCode: string
  fundName: string
  holdingShares: number
}

const SIGNED_SHARES_SQL = `
  CASE
    WHEN COALESCE(c.confirmed_shares, 0) = 0 THEN 0
    WHEN COALESCE(c.business_type, '') ~ '转换' THEN 0
    WHEN COALESCE(c.business_type, '') ~ '强制赎回'
      OR (
        COALESCE(c.business_type, '') ~ '赎回'
        AND COALESCE(c.business_type, '') !~ '申购|认购'
      )
      THEN -ABS(c.confirmed_shares)
    ELSE ABS(c.confirmed_shares)
  END
`

export async function listDirectConfirmHoldings(opts: {
  crawlEmails: string[]
  cutoffDate?: string | null
}): Promise<DirectConfirmHolding[]> {
  const emails = Array.from(
    new Set(opts.crawlEmails.map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@"))),
  )
  if (emails.length === 0) return []

  await ensureEmailConfirmTable()
  const cutoff = String(opts.cutoffDate ?? "").trim().slice(0, 10)
  const params: unknown[] = [emails]
  const dateFilter = cutoff
    ? `AND (COALESCE(c.confirm_date, c.apply_date) IS NULL OR COALESCE(c.confirm_date, c.apply_date) <= $2::date)`
    : ""
  if (cutoff) params.push(cutoff)

  const rows = await query<{
    fund_code: string | null
    fund_name: string | null
    holding_shares: string | null
  }>(
    `SELECT
       UPPER(BTRIM(COALESCE(c.fund_code, ''))) AS fund_code,
       BTRIM(COALESCE(c.fund_name, '')) AS fund_name,
       SUM(${SIGNED_SHARES_SQL})::text AS holding_shares
     FROM ops_email_confirm_records c
     WHERE c.confirmed_shares IS NOT NULL
       AND COALESCE(c.confirmed_shares, 0) <> 0
       AND lower(BTRIM(c.crawl_email_account)) = ANY($1::text[])
       ${dateFilter}
     GROUP BY 1, 2`,
    params,
  )

  const byCode = new Map<string, DirectConfirmHolding>()
  const byName = new Map<string, DirectConfirmHolding>()
  for (const row of rows) {
    const shares = Number(row.holding_shares)
    if (!Number.isFinite(shares) || shares <= 0) continue
    const fundCode = String(row.fund_code || "").trim().toUpperCase()
    const fundName = String(row.fund_name || "").trim()
    if (fundCode) {
      const prev = byCode.get(fundCode)
      byCode.set(fundCode, {
        fundCode,
        fundName: prev?.fundName || fundName,
        holdingShares: (prev?.holdingShares ?? 0) + shares,
      })
      continue
    }
    if (!fundName) continue
    const key = fundName.replace(/\s+/g, "").toLowerCase()
    const prev = byName.get(key)
    byName.set(key, {
      fundCode: "",
      fundName,
      holdingShares: (prev?.holdingShares ?? 0) + shares,
    })
  }
  return [...byCode.values(), ...byName.values()]
}
