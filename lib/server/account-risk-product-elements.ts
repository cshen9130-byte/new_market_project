import { publicQuery, query } from "@/lib/db"
import { loadExtractedElementDisplayValues } from "@/lib/server/fund-elements-write"
import { resolveFundElementsBeianKeys } from "@/lib/server/fund-elements-lookup"
import { lookupManagedProductOverride, resolveManagedProductBeian } from "@/lib/server/managed-product-beian"
import { scopeWhere } from "@/lib/server/account-risk-scope"

export type AccountRiskProductElements = {
  productName: string
  accountNo: string
  openDate: string
  shareClass: string
  feeStructure: string
  redemptionFee: string
}

const EMPTY: AccountRiskProductElements = {
  productName: "",
  accountNo: "",
  openDate: "",
  shareClass: "",
  feeStructure: "",
  redemptionFee: "",
}

function clean(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  if (!s || s === "—" || s === "-" || s === "无") return ""
  return s
}

function shareClassFromName(name: string): string {
  const m = name.match(/([ABC]类)/u)
  return m?.[1] ?? ""
}

function looksLikeFundName(name: string): boolean {
  return /基金|私募|资管计划|信托计划/.test(name)
}

/** CFMMC 客户名称 is often `管理人全称` + `产品全称` with no separator. */
const COMPANY_PREFIX_RE =
  /^.+?(?:私募基金管理有限公司|基金管理有限公司|资产管理有限公司|股份有限公司|有限责任公司|有限公司)/u

export function productNameFromClientLabel(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  const afterCompany = s.replace(COMPANY_PREFIX_RE, "").trim()
  if (afterCompany && looksLikeFundName(afterCompany) && afterCompany !== s) return afterCompany
  const numbered = s.match(/([\u4e00-\u9fffA-Za-z0-9]+号(?:私募)?(?:证券)?投资?基金(?:[ABC]类)?)/u)
  if (numbered?.[1] && numbered[1] !== s) return numbered[1]
  return afterCompany && looksLikeFundName(afterCompany) ? afterCompany : s
}

function formatFeeStructure(el: {
  fee_manage?: string | null
  fee_manage_rate?: string | null
  fee_pay?: string | null
  fee_pay_formula?: string | null
}): string {
  const manage = clean(el.fee_manage) || (clean(el.fee_manage_rate) ? `管理费${clean(el.fee_manage_rate)}` : "")
  const perf = clean(el.fee_pay) || (clean(el.fee_pay_formula) && clean(el.fee_pay_formula) !== "无"
    ? clean(el.fee_pay_formula)
    : "")
  return [manage, perf].filter(Boolean).join(" + ")
}

async function findBeianForName(name: string): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  try {
    const rows = await query<{ register_number: string | null }>(
      `SELECT register_number
       FROM basicinfo_bfl_track
       WHERE fund_name = $1 OR fund_short_name = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [trimmed],
    )
    const exact = clean(rows[0]?.register_number)
    if (exact) return exact
  } catch {
    // table may be missing
  }
  if (!looksLikeFundName(trimmed)) return null
  try {
    const keys = await resolveFundElementsBeianKeys("", trimmed)
    return keys.find((k) => k && k !== trimmed) || keys[0] || null
  } catch {
    return null
  }
}

async function findBeianForAccountNo(accountNo: string): Promise<string | null> {
  const acc = accountNo.trim()
  if (!acc || acc.length < 6) return null
  const tables: { sql: string }[] = [
    {
      sql: `SELECT register_number
            FROM type6_ops_team_full
            WHERE register_number = $1
               OR fund_short_name = $1
               OR fund_name = $1
            LIMIT 1`,
    },
    {
      sql: `SELECT beian_hao AS register_number
            FROM private_fund_info
            WHERE beian_hao = $1
               OR product_name = $1
            LIMIT 1`,
    },
  ]
  for (const { sql } of tables) {
    try {
      const rows = await query<{ register_number: string | null }>(sql, [acc])
      const found = clean(rows[0]?.register_number)
      if (found) return found
    } catch {
      // table or column may not exist
    }
  }
  return null
}

export async function loadAccountRiskProductElements(): Promise<AccountRiskProductElements> {
  const params: unknown[] = []
  const rows = await publicQuery<{
    account_no: string
    client_name: string | null
  }>(
    `SELECT DISTINCT account_no, NULLIF(TRIM(client_name), '') AS client_name
     FROM public.cfmmc_daily_summary
     WHERE ${scopeWhere(params)}
     ORDER BY account_no`,
    params,
  ).catch(() => ({ rows: [] as { account_no: string; client_name: string | null }[] }))

  const accounts = [...new Set(rows.rows.map((r) => String(r.account_no ?? "").trim()).filter(Boolean))]
  const names = [...new Set(rows.rows.map((r) => clean(r.client_name)).filter(Boolean))]

  if (accounts.length === 0) return EMPTY
  if (accounts.length > 1 && names.length !== 1) return EMPTY

  const clientName = names[0] ?? ""
  const productName = productNameFromClientLabel(clientName)
  const accountNo = accounts.length === 1 ? accounts[0] : ""

  let beian = accountNo ? await findBeianForAccountNo(accountNo) : null
  if (!beian && productName) {
    beian =
      lookupManagedProductOverride(productName)?.beian_hao
      ?? resolveManagedProductBeian(productName)
      ?? await findBeianForName(productName)
  }
  if (!beian && clientName && clientName !== productName) {
    beian = await findBeianForName(clientName)
  }

  if (!beian) {
    return {
      ...EMPTY,
      productName,
      accountNo,
      shareClass: shareClassFromName(productName),
    }
  }

  const el = await loadExtractedElementDisplayValues(beian, productName || clientName || null).catch(() => null)
  const fundName = productNameFromClientLabel(clean(el?.fund_name) || productName || clientName)
  return {
    productName: fundName,
    accountNo,
    openDate: clean(el?.open_day),
    shareClass: shareClassFromName(fundName) || shareClassFromName(productName),
    feeStructure: el ? formatFeeStructure(el) : "",
    redemptionFee: clean(el?.fee_redeem) || clean(el?.lock_period_desc) || clean(el?.closed_period),
  }
}
