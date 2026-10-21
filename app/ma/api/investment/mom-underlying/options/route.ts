import { NextResponse } from "next/server"
import type { MomUnderlyingAccountOption } from "@/lib/ma/mom-underlying"
import { canAccessPfInvestmentPool, canAccessTraderManage } from "@/lib/permissions"
import { publicQuery, query } from "@/lib/db"
import { productNameFromClientLabel } from "@/lib/server/account-risk-product-elements"
import { listMomSettlementAccounts } from "@/lib/server/ops-fund-mom-accounts"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function shortCompany(name: string): string {
  return name.replace(/股份有限公司|有限责任公司|有限公司/g, "").trim() || name
}

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user || (!canAccessPfInvestmentPool(user) && !canAccessTraderManage(user))) {
    return NextResponse.json({ error: "无权限修改关联" }, { status: 403 })
  }

  const [momAccounts, advisorRows, singleRes] = await Promise.all([
    listMomSettlementAccounts(),
    query<{ account: string; advisor_name: string | null; company: string | null; sector: string | null }>(
      `SELECT DISTINCT ON (lower(trim(account_code)))
         lower(trim(account_code)) AS account,
         NULLIF(trim(advisor_name), '') AS advisor_name,
         NULLIF(trim(company), '') AS company,
         NULLIF(trim(sector), '') AS sector
       FROM mom_advisor_info
       ORDER BY lower(trim(account_code)), id DESC`,
    ).catch(() => []),
    publicQuery(
      `SELECT DISTINCT ON (trim(account_no))
         trim(account_no) AS account_no,
         NULLIF(trim(client_name), '') AS client_name,
         NULLIF(trim(company_name), '') AS company_name
       FROM public.cfmmc_daily_summary
       WHERE account_no IS NOT NULL AND trim(account_no) <> ''
       ORDER BY trim(account_no), trade_date DESC`,
    ).catch(() => ({ rows: [] as Array<{ account_no: string; client_name: string | null; company_name: string | null }> })),
  ])

  const advisors = new Map(advisorRows.map((row) => [row.account, row]))
  const compare: MomUnderlyingAccountOption[] = momAccounts.map((account) => {
    const info = advisors.get(account)
    const extra = [info?.advisor_name, info?.company, info?.sector].filter(Boolean).join(" · ")
    return { account, label: extra ? `${account} · ${extra}` : account }
  })

  const account: MomUnderlyingAccountOption[] = (singleRes.rows as Array<{
    account_no: string
    client_name: string | null
    company_name: string | null
  }>).map((row) => {
    const product = productNameFromClientLabel(String(row.client_name ?? ""))
    const company = shortCompany(String(row.company_name ?? "").trim())
    const extra = [company, product && product !== row.account_no ? product : ""].filter(Boolean).join(" · ")
    return { account: row.account_no, label: extra ? `${row.account_no} · ${extra}` : row.account_no }
  })

  return NextResponse.json({ ok: true, compare, account })
}
