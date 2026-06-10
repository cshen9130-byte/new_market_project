import { NextResponse } from "next/server"
import {
  createTaAccountManual,
  listTaAccounts,
  matchFofForCustomerName,
  updateTaAccount,
} from "@/lib/server/ta-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get("q") ?? ""
    return NextResponse.json(listTaAccounts(q))
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { customerName, taAccount } = body as { customerName?: string; taAccount?: string }
    if (!customerName?.trim()) {
      return NextResponse.json({ error: "客户名称不能为空" }, { status: 400 })
    }
    let row = createTaAccountManual({
      customerName,
      taAccount: taAccount ?? "",
    })
    const match = await matchFofForCustomerName(customerName)
    if (match) {
      const linked = updateTaAccount(row.id, {
        linkType: "fof",
        fofRegisterNumber: match.register_number,
        fofProductName: match.product_name,
      })
      if (linked) row = linked
    }
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "创建失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
