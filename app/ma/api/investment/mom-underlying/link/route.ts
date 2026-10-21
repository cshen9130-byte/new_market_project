import { NextResponse } from "next/server"
import type { MomUnderlyingKind, MomUnderlyingLinkSource } from "@/lib/ma/mom-underlying"
import { canAccessPfInvestmentPool, canAccessTraderManage } from "@/lib/permissions"
import { deleteFundMomAccount, upsertFundMomAccount } from "@/lib/server/ops-fund-mom-accounts"
import { deleteFundSingleAccount, upsertFundSingleAccount } from "@/lib/server/ops-fund-single-accounts"
import { getRequestUser } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireEditor(req: Request) {
  const user = await getRequestUser(req)
  if (!user || (!canAccessPfInvestmentPool(user) && !canAccessTraderManage(user))) {
    return NextResponse.json({ error: "无权限修改关联" }, { status: 403 })
  }
  return user
}

function isKind(value: string): value is MomUnderlyingKind {
  return value === "compare" || value === "account"
}

export async function POST(req: Request) {
  const user = await requireEditor(req)
  if (user instanceof NextResponse) return user

  const body = await req.json().catch(() => null)
  const kind = String(body?.kind ?? "").trim()
  const beian = String(body?.beian_hao ?? "").trim().toUpperCase()
  const productName = String(body?.product_name ?? "").trim()
  const account = String(body?.account ?? "").trim()
  const note = String(body?.note ?? "").trim()
  const previous = body?.previous as {
    kind?: string
    beian_hao?: string
    account?: string
    link_source?: MomUnderlyingLinkSource
  } | null
  if (!isKind(kind)) return NextResponse.json({ error: "账户类型无效" }, { status: 400 })
  if (!beian) return NextResponse.json({ error: "请选择产品" }, { status: 400 })
  if (!account) return NextResponse.json({ error: "请选择账户" }, { status: 400 })

  const updatedBy = user.name || user.email || ""
  const prevKind = String(previous?.kind ?? "")
  const prevBeian = String(previous?.beian_hao ?? "").trim().toUpperCase()
  const prevAccount = String(previous?.account ?? "").trim()
  const prevSaved = previous?.link_source === "saved"

  if (prevSaved && prevKind === "compare" && prevBeian && (prevKind !== kind || prevBeian !== beian)) {
    await deleteFundMomAccount(prevBeian)
  }
  if (prevSaved && prevKind === "account" && prevAccount && (prevKind !== kind || prevAccount !== account)) {
    await deleteFundSingleAccount(prevAccount)
  }

  if (kind === "compare") {
    const row = await upsertFundMomAccount({
      beianHao: beian,
      productName,
      accountCode: account.toLowerCase(),
      note,
      updatedBy,
    })
    return NextResponse.json({ ok: true, data: row })
  }

  const row = await upsertFundSingleAccount({
    beianHao: beian,
    productName,
    accountNo: account,
    note,
    updatedBy,
  })
  return NextResponse.json({ ok: true, data: row })
}

export async function DELETE(req: Request) {
  const user = await requireEditor(req)
  if (user instanceof NextResponse) return user
  const { searchParams } = new URL(req.url)
  const kind = (searchParams.get("kind") || "").trim()
  const beian = (searchParams.get("beian_hao") || "").trim()
  const account = (searchParams.get("account") || "").trim()
  if (!isKind(kind)) return NextResponse.json({ error: "账户类型无效" }, { status: 400 })
  if (kind === "compare") {
    if (!beian) return NextResponse.json({ error: "缺少备案号" }, { status: 400 })
    const removed = await deleteFundMomAccount(beian)
    return NextResponse.json({ ok: true, removed })
  }
  if (!account) return NextResponse.json({ error: "缺少账户" }, { status: 400 })
  const removed = await deleteFundSingleAccount(account)
  return NextResponse.json({ ok: true, removed })
}
