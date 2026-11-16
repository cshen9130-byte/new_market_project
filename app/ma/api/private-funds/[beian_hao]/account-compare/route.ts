import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { canModifyCompareAccount } from "@/lib/permissions"
import { loadMomAccountCompareSeries, type AccountComparePoint } from "@/lib/server/account-compare-series"
import {
  listCfmmcCompareAccounts,
  loadCfmmcCompareSeries,
  parseCfmmcCompareId,
  resolveLinkedCfmmcCompareIds,
  type CfmmcCompareAccount,
} from "@/lib/server/account-risk-compare"
import { resolveFundMomAccountLinks } from "@/lib/server/ops-fund-mom-accounts"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type { AccountComparePoint }

type CompareAccountOption = {
  id: string
  source: "mom" | "cfmmc"
  label: string
}

function momOption(account: string): CompareAccountOption {
  const id = account.trim().toLowerCase()
  return { id, source: "mom", label: id }
}

function cfmmcOption(row: CfmmcCompareAccount): CompareAccountOption {
  return { id: row.id, source: "cfmmc", label: row.label }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao } = await params
  const { searchParams } = new URL(req.url)
  const productName = searchParams.get("product_name")
  const linked = await resolveFundMomAccountLinks(beian_hao, productName)
  const momFallback = linked[0]?.account ?? null
  const singleIds = await resolveLinkedCfmmcCompareIds(beian_hao).catch(() => [] as string[])
  const fallbackAccount = momFallback || singleIds[0] || null
  const requestUser = await getRequestUser(req)
  const canPickAccount = canModifyCompareAccount(requestUser)
  const requested = ((canPickAccount ? searchParams.get("account") : null) || "").trim()
  const account = (requested || fallbackAccount || "").trim()
  const cfmmcAccountNo = parseCfmmcCompareId(account)
  const from = searchParams.get("from") || ""
  const to = searchParams.get("to") || ""

  let accountOptions: CompareAccountOption[] = linked
    .map((row) => row.account)
    .filter((code) => code.trim())
    .map(momOption)
  try {
    const accRes = await publicQuery(
      `SELECT DISTINCT LOWER(TRIM("账户"::text)) AS account
       FROM public.mom_daily_reports
       WHERE "账户" IS NOT NULL AND TRIM("账户"::text) <> ''
       ORDER BY 1`,
    )
    const seen = new Set(accountOptions.map((option) => option.id))
    for (const row of accRes.rows as Array<{ account: string }>) {
      const acc = String(row.account || "").toLowerCase()
      if (!acc || seen.has(acc)) continue
      seen.add(acc)
      accountOptions.push(momOption(acc))
    }
  } catch {
    // keep linked accounts only
  }
  let cfmmcAccounts: CfmmcCompareAccount[] = []
  try {
    cfmmcAccounts = await listCfmmcCompareAccounts()
  } catch {
    cfmmcAccounts = []
  }
  const linkedSingleOptions = singleIds.map((id) => {
    const hit = cfmmcAccounts.find((row) => row.id === id)
    return hit ? cfmmcOption(hit) : { id, source: "cfmmc" as const, label: parseCfmmcCompareId(id) || id }
  })
  if (canPickAccount) {
    const seen = new Set(accountOptions.map((option) => option.id))
    for (const option of [...linkedSingleOptions, ...cfmmcAccounts.map(cfmmcOption)]) {
      if (seen.has(option.id)) continue
      seen.add(option.id)
      accountOptions.push(option)
    }
  } else {
    accountOptions = [
      ...(momFallback ? [momOption(momFallback)] : []),
      ...linkedSingleOptions,
    ]
  }

  const listed = {
    defaultAccount: fallbackAccount,
    linkedAccounts: linked,
    availableAccounts: accountOptions.map((option) => option.id),
    accountOptions,
  }

  if (!account) {
    return NextResponse.json({
      ok: true,
      account: null,
      source: null,
      fundName: null,
      company: null,
      ...listed,
      advisor: null,
      series: [],
      message: "请选择要对比的账户",
    })
  }

  if (cfmmcAccountNo) {
    try {
      const loaded = await loadCfmmcCompareSeries(cfmmcAccountNo, from, to)
      const label = loaded.fundName || cfmmcAccountNo
      return NextResponse.json({
        ok: true,
        account,
        source: "cfmmc",
        fundName: loaded.fundName || null,
        company: loaded.company || null,
        ...listed,
        advisor: null,
        series: loaded.series,
        message: loaded.series.length ? null : `账户 ${label} 暂无单账户结算数据`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("does not exist") || msg.includes("cfmmc_daily_summary")) {
        return NextResponse.json({
          ok: true,
          account,
          source: "cfmmc",
          fundName: null,
          company: null,
          ...listed,
          advisor: null,
          series: [],
          message: "单账户结算数据尚未导入",
        })
      }
      return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }
  }

  try {
    const loaded = await loadMomAccountCompareSeries(account, from, to)
    const { advisor, series } = loaded

    return NextResponse.json({
      ok: true,
      account: account.toLowerCase(),
      source: "mom",
      fundName: null,
      company: advisor?.company ?? null,
      ...listed,
      advisor,
      series,
      message: series.length ? null : `账户 ${account.toLowerCase()} 暂无 MOM 结算数据`,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist") || msg.includes("mom_daily_reports")) {
      return NextResponse.json({
        ok: true,
        account: account.toLowerCase(),
        source: "mom",
        fundName: null,
        company: null,
        ...listed,
        advisor: null,
        series: [],
        message: "MOM 结算数据尚未导入",
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
