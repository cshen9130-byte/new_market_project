/**
 * Read-only 单账户 series for 产品页「账户对比」.
 * Queries public.cfmmc_daily_summary only. Does not read or write public.mom_*.
 */
import { publicQuery } from "@/lib/db"
import { productNameFromClientLabel } from "@/lib/server/account-risk-product-elements"
import { aggregateEquityByDate, compoundAccountRiskNav } from "@/lib/server/account-risk-nav"
import { listFundSingleAccounts } from "@/lib/server/ops-fund-single-accounts"

export const CFMMC_COMPARE_PREFIX = "cfmmc:"

export type CfmmcCompareAccount = {
  id: string
  accountNo: string
  label: string
  fundName: string
  company: string
}

export type CfmmcComparePoint = {
  date: string
  nav: number
  dailyReturn: number
  pnl: number
  equity: number
}

function shortCompanyName(raw: string): string {
  return raw
    .replace(/股份有限公司$/, "")
    .replace(/有限责任公司$/, "")
    .replace(/有限公司$/, "")
    .trim()
}

export function cfmmcCompareId(accountNo: string): string {
  return `${CFMMC_COMPARE_PREFIX}${accountNo}`
}

/** `cfmmc:<资金账号>` selects 单账户. Anything else stays a MOM account code. */
export function parseCfmmcCompareId(raw: string): string | null {
  const text = raw.trim()
  if (!text.toLowerCase().startsWith(CFMMC_COMPARE_PREFIX)) return null
  const accountNo = text.slice(CFMMC_COMPARE_PREFIX.length).trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountNo)) return null
  return accountNo
}

function accountLabel(fundName: string, accountNo: string, company: string): string {
  const name = fundName && fundName !== accountNo ? fundName : accountNo
  const tail = [company, name === accountNo ? "" : accountNo].filter(Boolean).join(" · ")
  return tail ? `${name}（${tail}）` : name
}

/**
 * 单账户 ids linked to one private fund, explicit mapping first, then
 * settlement client-name matches. Ids use the `cfmmc:` prefix.
 */
export async function resolveLinkedCfmmcCompareIds(
  beianHao: string,
  productName?: string | null,
): Promise<string[]> {
  const beian = beianHao.trim().toUpperCase()
  const name = (productName ?? "").trim()
  if (!beian && name.length < 8) return []

  const explicit = beian
    ? (await listFundSingleAccounts().catch(() => []))
        .filter((row) => row.beian_hao.trim().toUpperCase() === beian)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .map((row) => row.account_no.trim())
        .filter(Boolean)
    : []

  const params: unknown[] = []
  const match: string[] = []
  if (beian) {
    params.push(beian)
    match.push(`upper(trim(p.beian_hao)) = $${params.length}`)
  }
  if (name.length >= 8) {
    params.push(name)
    match.push(`strpos(l.client_name, $${params.length}) > 0`)
  }
  const matched = await publicQuery(
    `WITH latest AS (
       SELECT DISTINCT ON (trim(account_no::text))
         trim(account_no::text) AS account_no,
         NULLIF(trim(client_name), '') AS client_name,
         client_equity
       FROM public.cfmmc_daily_summary
       WHERE account_no IS NOT NULL AND trim(account_no::text) <> ''
       ORDER BY trim(account_no::text), trade_date DESC
     )
     SELECT l.account_no, max(l.client_equity) AS equity
     FROM latest l
     JOIN private_fund_info p
       ON l.client_name IS NOT NULL
      AND char_length(p.product_name) >= 8
      AND strpos(l.client_name, p.product_name) > 0
      AND (${match.join(" OR ")})
     GROUP BY l.account_no
     ORDER BY max(l.client_equity) DESC NULLS LAST, l.account_no`,
    params,
  ).then((res) => (res.rows as Array<{ account_no: string }>).map((row) => String(row.account_no || "").trim()).filter(Boolean))
    .catch(() => [] as string[])

  const seen = new Set<string>()
  const ids: string[] = []
  for (const accountNo of [...explicit, ...matched]) {
    if (seen.has(accountNo)) continue
    seen.add(accountNo)
    ids.push(cfmmcCompareId(accountNo))
  }
  return ids
}

export async function listCfmmcCompareAccounts(): Promise<CfmmcCompareAccount[]> {
  const res = await publicQuery(
    `SELECT DISTINCT ON (TRIM(account_no::text))
       TRIM(account_no::text) AS account_no,
       client_name,
       company_name
     FROM public.cfmmc_daily_summary
     WHERE account_no IS NOT NULL AND TRIM(account_no::text) <> ''
     ORDER BY TRIM(account_no::text), trade_date DESC`,
  )
  const rows = (res.rows as Array<{
    account_no: string | null
    client_name: string | null
    company_name: string | null
  }>).flatMap((row) => {
    const accountNo = String(row.account_no || "").trim()
    if (!accountNo) return []
    const fundName = productNameFromClientLabel(String(row.client_name || "").trim())
    const company = shortCompanyName(String(row.company_name || "").trim())
    return [{
      id: cfmmcCompareId(accountNo),
      accountNo,
      label: accountLabel(fundName, accountNo, company),
      fundName,
      company,
    }]
  })
  rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
  return rows
}

export async function loadCfmmcCompareSeries(
  accountNo: string,
  from: string,
  to: string,
): Promise<{ fundName: string; company: string; series: CfmmcComparePoint[] }> {
  const params: unknown[] = [accountNo]
  const filters = [`TRIM(account_no::text) = $1`]
  if (to) {
    params.push(to)
    filters.push(`trade_date <= $${params.length}::date`)
  }
  const res = await publicQuery(
    `SELECT
       trade_date::text AS date,
       client_equity,
       daily_pnl,
       deposit_wd,
       balance_bf,
       balance_cf,
       realized_pl,
       commission,
       client_name,
       company_name
     FROM public.cfmmc_daily_summary
     WHERE ${filters.join(" AND ")}
     ORDER BY trade_date ASC`,
    params,
  )
  const rows = res.rows as Array<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
    balance_bf: unknown
    balance_cf: unknown
    realized_pl: unknown
    commission: unknown
    client_name: string | null
    company_name: string | null
  }>
  if (!rows.length) return { fundName: "", company: "", series: [] }

  const latest = rows[rows.length - 1]
  const fundName = productNameFromClientLabel(String(latest.client_name || "").trim())
  const company = shortCompanyName(String(latest.company_name || "").trim())
  const series = compoundAccountRiskNav(aggregateEquityByDate(rows))
    .filter((point) => !from || point.date >= from)
    .map((point) => ({
      date: point.date,
      nav: point.nav,
      dailyReturn: point.dailyReturn,
      pnl: point.pnl,
      equity: point.cumCapital,
    }))
  return { fundName, company, series }
}
