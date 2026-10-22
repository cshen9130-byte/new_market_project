import { NextResponse } from "next/server"
import { canAccessTraderManage, canModifyCompareAccount } from "@/lib/permissions"
import { importMissingFundMomAccounts, upsertFundMomAccount } from "@/lib/server/ops-fund-mom-accounts"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type LinkInput = { beian_hao?: unknown; account?: unknown; product_name?: unknown }

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user || (!canModifyCompareAccount(user) && !canAccessTraderManage(user))) {
    return NextResponse.json({ error: "无权限保存对比账户" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const mode = String(body?.mode ?? "fill").trim()
  const updatedBy = user.name || user.email || ""

  if (mode === "set") {
    const beian = String(body?.beian_hao ?? "").trim()
    const account = String(body?.account ?? "").trim()
    const productName = String(body?.product_name ?? "").trim()
    if (!beian || !account) return NextResponse.json({ error: "缺少产品或账户" }, { status: 400 })
    if (account.toLowerCase().startsWith("cfmmc:")) {
      return NextResponse.json({ ok: true, skipped: "single-account" })
    }
    const row = await upsertFundMomAccount({
      beianHao: beian,
      productName,
      accountCode: account,
      updatedBy,
    })
    return NextResponse.json({ ok: true, data: row })
  }

  const raw = Array.isArray(body?.links) ? body.links as LinkInput[] : []
  if (raw.length > 200) return NextResponse.json({ error: "一次最多同步 200 条" }, { status: 400 })
  const inserted = await importMissingFundMomAccounts(
    raw.map((link) => ({
      beianHao: String(link?.beian_hao ?? ""),
      accountCode: String(link?.account ?? ""),
      productName: String(link?.product_name ?? ""),
    })),
    updatedBy,
  )
  return NextResponse.json({ ok: true, inserted })
}
