import { NextResponse } from "next/server"
import { deleteTaAccount, updateTaAccount } from "@/lib/server/ta-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { linkType, fofRegisterNumber, fofProductName, investorName } = body as {
      linkType?: "fof" | "investor" | null
      fofRegisterNumber?: string | null
      fofProductName?: string | null
      investorName?: string | null
    }

    const row = updateTaAccount(id, {
      linkType,
      fofRegisterNumber,
      fofProductName,
      investorName,
    })
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    return NextResponse.json(row)
  } catch (e) {
    const message = e instanceof Error ? e.message : "更新失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const ok = deleteTaAccount(id)
    if (!ok) {
      return NextResponse.json({ error: "仅可删除手动添加的记录" }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "删除失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
