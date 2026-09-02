import { NextResponse } from "next/server"
import { canAccessTraderManage } from "@/lib/permissions"
import { getRequestUser } from "@/lib/server/users"
import {
  deleteFundMomAccount,
  getFundMomAccount,
  listMomSettlementAccounts,
  resolveFundMomAccountLinks,
  upsertFundMomAccount,
} from "@/lib/server/ops-fund-mom-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireTraderManage(req: Request) {
  const user = await getRequestUser(req)
  if (!canAccessTraderManage(user)) {
    return NextResponse.json({ error: "无盘手管理权限" }, { status: 403 })
  }
  return user
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = searchParams.get("product_name")
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  const denied = await requireTraderManage(req)
  if (denied instanceof NextResponse) return denied

  const [row, availableAccounts, linked] = await Promise.all([
    getFundMomAccount(beian_hao).catch(() => null),
    listMomSettlementAccounts(),
    resolveFundMomAccountLinks(beian_hao, product_name),
  ])

  return NextResponse.json({
    ok: true,
    data: row,
    defaultAccount: linked[0]?.account ?? null,
    availableAccounts,
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const beian_hao = String(body?.beian_hao ?? "").trim()
  const account_code = String(body?.account_code ?? "").trim()
  const product_name = String(body?.product_name ?? "").trim()
  const note = String(body?.note ?? "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  if (!account_code) return NextResponse.json({ error: "missing account_code" }, { status: 400 })
  const user = await requireTraderManage(req)
  if (user instanceof NextResponse) return user

  const username = String(body?.user_name ?? "").trim() || user.name || user.email || ""
  const row = await upsertFundMomAccount({
    beianHao: beian_hao,
    productName: product_name,
    accountCode: account_code,
    note,
    updatedBy: username,
  })
  return NextResponse.json({ ok: true, data: row })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
  const denied = await requireTraderManage(req)
  if (denied instanceof NextResponse) return denied
  const removed = await deleteFundMomAccount(beian_hao)
  return NextResponse.json({ ok: true, removed })
}
